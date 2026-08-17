import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngineStore, MemoryStorageAdapter } from '../searchEngineStore.js';

describe('SearchEngineStore (Deep Module)', () => {
  let adapter;
  let store;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    store = new SearchEngineStore(adapter);
    await store.load();
  });

  describe('Engine CRUD Operations', () => {
    it('creates a new engine with auto-generated id', async () => {
      const engine = await store.saveEngine({
        title: 'Google',
        urlTemplate: 'https://www.google.com/search?q={query}',
        queryRegex: '(\\w+)',
        queryReplacement: '$1'
      });

      assert.ok(engine.id.startsWith('engine-'));
      assert.strictEqual(engine.title, 'Google');
      assert.strictEqual(engine.urlTemplate, 'https://www.google.com/search?q={query}');
      assert.strictEqual(engine.queryRegex, '(\\w+)');
      assert.strictEqual(engine.queryReplacement, '$1');

      // Verify in-memory retrieval
      const engines = store.getEngines();
      assert.strictEqual(engines.length, 1);
      assert.strictEqual(store.getEngineById(engine.id)?.title, 'Google');

      // Verify persisted in adapter
      const persisted = await adapter.get('searchEngines');
      assert.strictEqual(persisted.searchEngines.length, 1);
      assert.strictEqual(persisted.searchEngines[0].id, engine.id);
    });

    it('updates an existing engine when saving with an existing id', async () => {
      const created = await store.saveEngine({
        title: 'Bing',
        urlTemplate: 'https://www.bing.com/search?q={query}'
      });

      const updated = await store.saveEngine({
        id: created.id,
        title: 'Bing Modified',
        urlTemplate: 'https://www.bing.com/search?q={id}&fresh=1',
        queryRegex: '(.*)',
        queryReplacement: '$1'
      });

      assert.strictEqual(updated.id, created.id);
      assert.strictEqual(updated.title, 'Bing Modified');
      assert.strictEqual(updated.urlTemplate, 'https://www.bing.com/search?q={id}&fresh=1');
      assert.strictEqual(updated.queryRegex, '(.*)');
      assert.strictEqual(store.getEngines().length, 1);
    });

    it('deletes an engine by id and persists', async () => {
      const engine = await store.saveEngine({
        title: 'DuckDuckGo',
        urlTemplate: 'https://duckduckgo.com/?q={query}'
      });

      assert.strictEqual(store.getEngines().length, 1);
      const deleted = await store.deleteEngine(engine.id);
      assert.strictEqual(deleted, true);
      assert.strictEqual(store.getEngines().length, 0);

      const persisted = await adapter.get('searchEngines');
      assert.strictEqual(persisted.searchEngines.length, 0);
    });

    it('returns false when deleting a non-existent engine id', async () => {
      const deleted = await store.deleteEngine('non-existent-id');
      assert.strictEqual(deleted, false);
    });
  });

  describe('Validation & Edge Cases', () => {
    it('throws or rejects when saving without a title', async () => {
      await assert.rejects(
        async () => {
          await store.saveEngine({ title: '', urlTemplate: 'https://example.com?q={query}' });
        },
        /required/i
      );
    });

    it('throws or rejects when saving without a urlTemplate', async () => {
      await assert.rejects(
        async () => {
          await store.saveEngine({ title: 'Test', urlTemplate: '   ' });
        },
        /required/i
      );
    });

    it('sanitizes null or empty regex fields gracefully', async () => {
      const engine = await store.saveEngine({
        title: 'Clean Engine',
        urlTemplate: 'https://example.com/search?q={query}',
        queryRegex: '   ',
        queryReplacement: ''
      });

      assert.strictEqual(engine.queryRegex, null);
      assert.strictEqual(engine.queryReplacement, null);
    });
  });

  describe('Query Formatting (Regex Transformation)', () => {
    it('returns the raw query if no regex or replacement is configured', () => {
      const engine = { title: 'Raw', urlTemplate: 'https://test.com?q={query}' };
      const formatted = store.formatQuery('hello world', engine);
      assert.strictEqual(formatted, 'hello world');
    });

    it('applies regex replacement correctly on matched text', () => {
      const engine = {
        title: 'ID Extractor',
        urlTemplate: 'https://test.com?q={query}',
        queryRegex: 'ISSUE-(\\d+)',
        queryReplacement: '$1'
      };

      const formatted = store.formatQuery('ISSUE-456', engine);
      assert.strictEqual(formatted, '456');
    });

    it('discards surrounding unneeded text when extracting matched regex portion', () => {
      const engine = {
        title: 'Extractor',
        urlTemplate: 'https://test.com?q={query}',
        queryRegex: '([A-Z]{3}-\\d+)',
        queryReplacement: '$1'
      };

      const formatted = store.formatQuery('Found in commit PRJ-1234 on Friday', engine);
      assert.strictEqual(formatted, 'PRJ-1234');
    });

    it('returns the raw query if regex does not match input', () => {
      const engine = {
        title: 'Extractor',
        urlTemplate: 'https://test.com?q={query}',
        queryRegex: 'ABC-(\\d+)',
        queryReplacement: '$1'
      };

      const formatted = store.formatQuery('XYZ-999', engine);
      assert.strictEqual(formatted, 'XYZ-999');
    });

    it('handles malformed regex pattern safely without crashing', () => {
      const engine = {
        title: 'Broken Regex',
        urlTemplate: 'https://test.com?q={query}',
        queryRegex: '[invalid(',
        queryReplacement: '$1'
      };

      const formatted = store.formatQuery('test input', engine);
      assert.strictEqual(formatted, 'test input');
    });
  });

  describe('Search URL Compilation', () => {
    it('replaces {query} placeholder with URI-encoded processed query', () => {
      const engine = {
        id: 'engine-1',
        title: 'Google',
        urlTemplate: 'https://www.google.com/search?q={query}'
      };

      const url = store.buildSearchUrl('hello world & more', engine);
      assert.strictEqual(url, 'https://www.google.com/search?q=hello%20world%20%26%20more');
    });

    it('replaces {id} placeholder with URI-encoded processed query', () => {
      const engine = {
        id: 'engine-2',
        title: 'Jira',
        urlTemplate: 'https://jira.example.com/browse/{id}',
        queryRegex: '([A-Z]+-\\d+)',
        queryReplacement: '$1'
      };

      const url = store.buildSearchUrl('Ticket ABC-1002 closed', engine);
      assert.strictEqual(url, 'https://jira.example.com/browse/ABC-1002');
    });

    it('supports looking up engine by ID for URL building', async () => {
      const engine = await store.saveEngine({
        title: 'Engine By ID',
        urlTemplate: 'https://lookup.com?q={query}'
      });

      const url = store.buildSearchUrl('search term', engine.id);
      assert.strictEqual(url, 'https://lookup.com?q=search%20term');
    });
  });

  describe('Pub-Sub & Multi-window Synchronization', () => {
    it('notifies subscribers when engines are saved or deleted', async () => {
      const events = [];
      const unsubscribe = store.subscribe((event) => {
        events.push(event);
      });

      const engine = await store.saveEngine({
        title: 'Sub Test',
        urlTemplate: 'https://test.com?q={query}'
      });

      await store.deleteEngine(engine.id);

      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].type, 'engineSaved');
      assert.strictEqual(events[0].engine.id, engine.id);
      assert.strictEqual(events[1].type, 'engineDeleted');
      assert.strictEqual(events[1].id, engine.id);

      unsubscribe();
      await store.saveEngine({
        title: 'Another',
        urlTemplate: 'https://test2.com?q={query}'
      });
      assert.strictEqual(events.length, 2); // No new notifications after unsubscribe
    });
  });

  describe('Import & Export Portability', () => {
    it('exports clean snapshot and imports valid datasets', async () => {
      await store.saveEngine({
        title: 'Engine 1',
        urlTemplate: 'https://1.com?q={query}'
      });

      const exported = store.exportData();
      assert.strictEqual(exported.searchEngines.length, 1);

      const newStore = new SearchEngineStore(new MemoryStorageAdapter());
      await newStore.load();
      const importSuccess = await newStore.importData(exported);
      assert.strictEqual(importSuccess, true);
      assert.strictEqual(newStore.getEngines().length, 1);
      assert.strictEqual(newStore.getEngines()[0].title, 'Engine 1');
    });

    it('rejects invalid import payloads', async () => {
      assert.strictEqual(await store.importData(null), false);
      assert.strictEqual(await store.importData({}), false);
      assert.strictEqual(await store.importData('string'), false);
    });
  });
});
