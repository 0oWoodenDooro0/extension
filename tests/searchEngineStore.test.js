import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngineStore, MemoryStorageAdapter } from '../searchEngineStore.js';
import { BrowserTabAdapter, MemoryTabAdapter } from '../tabAdapter.js';
import { performSearch } from '../utils.js';

describe('SearchEngineStore & Context-Menu Search', () => {
  let adapter;
  let store;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    store = new SearchEngineStore(adapter);
    await store.load();
  });

  describe('Search Engine CRUD & Validation', () => {
    it('creates, updates, and deletes a Search Engine while persisting to storage', async () => {
      const created = await store.saveEngine({
        title: 'Google',
        urlTemplate: 'https://www.google.com/search?q={query}',
        queryRegex: '(\\w+)',
        queryReplacement: '$1'
      });

      assert.ok(created.id.startsWith('engine-'));
      assert.strictEqual(created.title, 'Google');
      assert.strictEqual(store.getEngineById(created.id)?.urlTemplate, 'https://www.google.com/search?q={query}');

      const updated = await store.saveEngine({
        id: created.id,
        title: 'Google Modified',
        urlTemplate: 'https://www.google.com/search?q={id}&fresh=1',
        queryRegex: '   ',
        queryReplacement: ''
      });

      assert.strictEqual(updated.id, created.id);
      assert.strictEqual(updated.title, 'Google Modified');
      assert.strictEqual(updated.queryRegex, null);
      assert.strictEqual(updated.queryReplacement, null);
      assert.strictEqual(store.getEngines().length, 1);

      const deleted = await store.deleteEngine(created.id);
      assert.strictEqual(deleted, true);
      assert.strictEqual(store.getEngines().length, 0);
      assert.strictEqual(await store.deleteEngine('non-existent-id'), false);
    });

    it('rejects saving a Search Engine when title or urlTemplate is missing', async () => {
      await assert.rejects(
        () => store.saveEngine({ title: '', urlTemplate: 'https://example.com?q={query}' }),
        /required/i
      );
      await assert.rejects(
        () => store.saveEngine({ title: 'Valid Title', urlTemplate: '   ' }),
        /required/i
      );
    });
  });

  describe('Query Formatting & Search URL Compilation', () => {
    it('extracts and transforms matched regex substring while discarding surrounding text', () => {
      const engine = {
        title: 'Ticket Extractor',
        urlTemplate: 'https://jira.example.com/browse/{id}',
        queryRegex: '([A-Z]{3}-\\d+)',
        queryReplacement: '$1'
      };

      assert.strictEqual(store.formatQuery('Found in commit PRJ-1234 on Friday', engine), 'PRJ-1234');
      assert.strictEqual(
        store.buildSearchUrl('Found in commit PRJ-1234 on Friday', engine),
        'https://jira.example.com/browse/PRJ-1234'
      );
    });

    it('falls back to the raw query when regex does not match or is malformed', () => {
      const nonMatchingEngine = {
        title: 'Extractor',
        urlTemplate: 'https://test.com?q={query}',
        queryRegex: 'ABC-(\\d+)',
        queryReplacement: '$1'
      };
      assert.strictEqual(store.formatQuery('XYZ-999', nonMatchingEngine), 'XYZ-999');

      const brokenRegexEngine = {
        title: 'Broken Regex',
        urlTemplate: 'https://test.com?q={query}',
        queryRegex: '[invalid(',
        queryReplacement: '$1'
      };
      const origConsoleError = console.error;
      console.error = () => {};
      try {
        assert.strictEqual(store.formatQuery('test input', brokenRegexEngine), 'test input');
      } finally {
        console.error = origConsoleError;
      }
    });

    it('URI-encodes the processed query into {query} or {id} placeholders by engine object or ID', async () => {
      const saved = await store.saveEngine({
        title: 'Lookup Engine',
        urlTemplate: 'https://lookup.com/search?q={query}'
      });

      assert.strictEqual(
        store.buildSearchUrl('hello world & more', saved.id),
        'https://lookup.com/search?q=hello%20world%20%26%20more'
      );
    });
  });

  describe('performSearch Navigation Integration', () => {
    it('compiles the Search Engine URL and opens it in an adjacent active tab', async () => {
      const engine = await store.saveEngine({
        title: 'Issue Tracker',
        urlTemplate: 'https://issues.example.com/{id}',
        queryRegex: 'BUG-(\\d+)',
        queryReplacement: '$1'
      });

      const memoryTabs = new MemoryTabAdapter();
      const navigationAdapter = new BrowserTabAdapter(memoryTabs);
      const sourceTab = { id: 42, index: 2, url: 'https://current.example.com' };

      performSearch('See BUG-789 for details', engine.id, sourceTab, store, navigationAdapter);

      // Wait microtask for openAdjacent
      await new Promise(resolve => setImmediate(resolve));

      assert.strictEqual(memoryTabs.createdTabs.length, 1);
      assert.strictEqual(memoryTabs.createdTabs[0].url, 'https://issues.example.com/789');
      assert.strictEqual(memoryTabs.createdTabs[0].index, 3);
      assert.strictEqual(memoryTabs.createdTabs[0].openerTabId, 42);
      assert.strictEqual(memoryTabs.createdTabs[0].active, true);
    });

    it('does not open a tab when the Search Engine ID does not exist', async () => {
      const memoryTabs = new MemoryTabAdapter();
      const navigationAdapter = new BrowserTabAdapter(memoryTabs);

      performSearch('some text', 'unknown-engine', { id: 1, index: 0 }, store, navigationAdapter);
      await new Promise(resolve => setImmediate(resolve));

      assert.strictEqual(memoryTabs.createdTabs.length, 0);
    });
  });

  describe('Cross-Window Synchronization & Subscriptions', () => {
    it('notifies subscribers on local mutations and external storage changes without self-echo', async () => {
      const events = [];
      const unsubscribe = store.subscribe((event) => events.push(event));

      await store.saveEngine({
        title: 'Local Engine',
        urlTemplate: 'https://local.com?q={query}'
      });
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'engineSaved');

      // Simulate another extension context (e.g. Popup or Sync) updating shared storage directly
      await adapter.set({
        searchEngines: [
          { id: 'ext-1', title: 'External Engine', urlTemplate: 'https://ext.com?q={query}' }
        ]
      });

      assert.strictEqual(events.length, 2);
      assert.deepStrictEqual(events[1], { type: 'sync', source: 'external' });
      assert.strictEqual(store.getEngines().length, 1);
      assert.strictEqual(store.getEngines()[0].id, 'ext-1');

      unsubscribe();
      await store.deleteEngine('ext-1');
      assert.strictEqual(events.length, 2);
    });
  });

  describe('Popup UI Elements (popup/popup.html)', () => {
    it('defines navigation tabs and form containers for both Search Shortcuts and Identifier Rules', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const htmlPath = path.resolve(process.cwd(), 'popup/popup.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Tabs Header
      assert.ok(htmlContent.includes('id="tabShortcutsBtn"'));
      assert.ok(htmlContent.includes('id="tabRulesBtn"'));

      // Search Shortcuts Section
      assert.ok(htmlContent.includes('id="shortcutsSection"'));
      assert.ok(htmlContent.includes('id="shortcutsList"'));
      assert.ok(htmlContent.includes('id="engineTitle"'));
      assert.ok(htmlContent.includes('id="engineUrl"'));
      assert.ok(htmlContent.includes('id="engineRegex"'));
      assert.ok(htmlContent.includes('id="engineReplacement"'));

      // Identifier Rules Section
      assert.ok(htmlContent.includes('id="rulesSection"'));
      assert.ok(htmlContent.includes('id="ruleList"'));
      assert.ok(htmlContent.includes('id="ruleName"'));
      assert.ok(htmlContent.includes('id="rulePattern"'));
      assert.ok(htmlContent.includes('id="ruleRegex"'));
      assert.ok(htmlContent.includes('id="ruleReplacement"'));
      assert.ok(htmlContent.includes('id="ruleTestUrl"'));
      assert.ok(htmlContent.includes('id="ruleTestPreview"'));
    });
  });
});
