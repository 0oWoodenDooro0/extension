import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CollectionStore, MemoryStorageAdapter as CollectionMemoryAdapter } from '../sidebar/store.js';
import { SearchEngineStore, MemoryStorageAdapter as SearchEngineMemoryAdapter } from '../searchEngineStore.js';
import { MemoryTabAdapter } from '../tabAdapter.js';
import {
  createUnifiedBackup,
  validateBackupPayload,
  restoreUnifiedBackup,
  exportBackupFile
} from '../sidebar/backupCoordinator.js';

describe('Unified Backup Coordinator (Deep Module)', () => {
  let collectionStore;
  let searchEngineStore;
  let tabAdapter;

  beforeEach(() => {
    collectionStore = new CollectionStore(new CollectionMemoryAdapter());
    searchEngineStore = new SearchEngineStore(new SearchEngineMemoryAdapter());
    tabAdapter = new MemoryTabAdapter();
  });

  describe('validateBackupPayload', () => {
    it('validates a complete unified backup payload with search engines', () => {
      const payload = {
        version: 1,
        items: [{ id: 'item-1', title: 'Example', url: 'https://example.com', tags: ['News'] }],
        tags: ['News'],
        searchEngines: [{ id: 'se-1', title: 'Google', urlTemplate: 'https://google.com/search?q={query}' }]
      };

      const result = validateBackupPayload(payload);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, null);
    });

    it('validates a legacy backup payload without searchEngines field', () => {
      const legacyPayload = {
        items: [{ id: 'item-1', title: 'Legacy', url: 'https://legacy.com', tags: [] }],
        tags: []
      };

      const result = validateBackupPayload(legacyPayload);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, null);
    });

    it('rejects null, undefined, primitives, and arrays', () => {
      assert.strictEqual(validateBackupPayload(null).valid, false);
      assert.strictEqual(validateBackupPayload(undefined).valid, false);
      assert.strictEqual(validateBackupPayload('string').valid, false);
      assert.strictEqual(validateBackupPayload(123).valid, false);
      assert.strictEqual(validateBackupPayload([]).valid, false);
    });

    it('rejects payloads missing items or tags arrays', () => {
      assert.strictEqual(validateBackupPayload({ tags: [] }).valid, false);
      assert.strictEqual(validateBackupPayload({ items: [] }).valid, false);
      assert.strictEqual(validateBackupPayload({ items: 'not-array', tags: [] }).valid, false);
      assert.strictEqual(validateBackupPayload({ items: [], tags: 'not-array' }).valid, false);
    });

    it('rejects payloads where searchEngines is present but not an array', () => {
      const invalidPayload = {
        items: [],
        tags: [],
        searchEngines: 'not-an-array'
      };
      const result = validateBackupPayload(invalidPayload);
      assert.strictEqual(result.valid, false);
      assert.match(result.error, /searchEngines/i);
    });
  });

  describe('createUnifiedBackup', () => {
    it('creates a unified backup snapshot with items, tags, and search engines', async () => {
      await collectionStore.addTag('Tech');
      await collectionStore.saveItem({
        title: 'Antigravity Doc',
        url: 'https://example.com/doc',
        tags: ['Tech'],
        actors: ['Vincent']
      });

      await searchEngineStore.saveEngine({
        title: 'GitHub Search',
        urlTemplate: 'https://github.com/search?q={query}',
        queryRegex: 'GH-(\\d+)',
        queryReplacement: '$1'
      });

      const backup = await createUnifiedBackup(collectionStore, searchEngineStore);

      assert.strictEqual(backup.version, 1);
      assert.strictEqual(backup.items.length, 1);
      assert.strictEqual(backup.items[0].title, 'Antigravity Doc');
      assert.deepStrictEqual(backup.tags, ['Tech']);
      assert.strictEqual(backup.searchEngines.length, 1);
      assert.strictEqual(backup.searchEngines[0].title, 'GitHub Search');
      assert.strictEqual(backup.searchEngines[0].queryRegex, 'GH-(\\d+)');
    });

    it('creates deep copies preventing outside mutation of store state', async () => {
      await collectionStore.addTag('OriginalTag');
      await searchEngineStore.saveEngine({
        title: 'Original Engine',
        urlTemplate: 'https://example.com?q={query}'
      });

      const backup = await createUnifiedBackup(collectionStore, searchEngineStore);
      backup.tags.push('MutatedTag');
      backup.searchEngines[0].title = 'Mutated Title';

      assert.deepStrictEqual(collectionStore.getTags(), ['OriginalTag']);
      assert.strictEqual(searchEngineStore.getEngines()[0].title, 'Original Engine');
    });

    it('handles empty stores cleanly', async () => {
      const backup = await createUnifiedBackup(collectionStore, searchEngineStore);

      assert.strictEqual(backup.version, 1);
      assert.deepStrictEqual(backup.items, []);
      assert.deepStrictEqual(backup.tags, []);
      assert.deepStrictEqual(backup.searchEngines, []);
    });
  });

  describe('restoreUnifiedBackup', () => {
    it('restores full dataset updating both CollectionStore and SearchEngineStore', async () => {
      const fullBackup = {
        version: 1,
        items: [
          {
            id: 'item-101',
            title: 'Restored Item',
            url: 'https://restored.com',
            tags: ['RestoredTag'],
            addDate: 1700000000000,
            actors: ['Hero']
          }
        ],
        tags: ['RestoredTag'],
        searchEngines: [
          {
            id: 'engine-101',
            title: 'Restored Engine',
            urlTemplate: 'https://restored-search.com?q={query}',
            queryRegex: null,
            queryReplacement: null
          }
        ]
      };

      let collectionNotified = false;
      let searchEngineNotified = false;

      collectionStore.subscribe(() => { collectionNotified = true; });
      searchEngineStore.subscribe(() => { searchEngineNotified = true; });

      const result = await restoreUnifiedBackup(fullBackup, { collectionStore, searchEngineStore });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.restored.itemsCount, 1);
      assert.strictEqual(result.restored.tagsCount, 1);
      assert.strictEqual(result.restored.searchEnginesCount, 1);

      assert.strictEqual(collectionStore.getItems().length, 1);
      assert.strictEqual(collectionStore.getItemById('item-101')?.title, 'Restored Item');
      assert.deepStrictEqual(collectionStore.getTags(), ['RestoredTag']);

      assert.strictEqual(searchEngineStore.getEngines().length, 1);
      assert.strictEqual(searchEngineStore.getEngineById('engine-101')?.title, 'Restored Engine');

      assert.strictEqual(collectionNotified, true);
      assert.strictEqual(searchEngineNotified, true);
    });

    it('backward compatibility: restores legacy backup and preserves existing search shortcuts when searchEngines is absent', async () => {
      await searchEngineStore.saveEngine({
        id: 'existing-engine',
        title: 'Preserved Engine',
        urlTemplate: 'https://preserved.com?q={query}'
      });

      const legacyBackup = {
        items: [
          {
            id: 'legacy-item',
            title: 'Legacy Item',
            url: 'https://legacy.com',
            tags: ['LegacyTag']
          }
        ],
        tags: ['LegacyTag']
      };

      const result = await restoreUnifiedBackup(legacyBackup, { collectionStore, searchEngineStore });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.restored.itemsCount, 1);
      assert.strictEqual(result.restored.searchEnginesCount, null); // Indicated not overwritten

      // Collection is restored
      assert.strictEqual(collectionStore.getItems().length, 1);
      assert.strictEqual(collectionStore.getItemById('legacy-item')?.title, 'Legacy Item');

      // Existing search engines are preserved
      assert.strictEqual(searchEngineStore.getEngines().length, 1);
      assert.strictEqual(searchEngineStore.getEngineById('existing-engine')?.title, 'Preserved Engine');
    });

    it('overwrites search engines when searchEngines array is explicitly provided (even if empty)', async () => {
      await searchEngineStore.saveEngine({
        title: 'Old Engine',
        urlTemplate: 'https://old.com?q={query}'
      });

      const backupWithEmptyEngines = {
        items: [],
        tags: [],
        searchEngines: []
      };

      const result = await restoreUnifiedBackup(backupWithEmptyEngines, { collectionStore, searchEngineStore });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.restored.searchEnginesCount, 0);
      assert.strictEqual(searchEngineStore.getEngines().length, 0);
    });

    it('rejects invalid payload format and leaves stores unmodified', async () => {
      await collectionStore.addTag('ExistingTag');
      await searchEngineStore.saveEngine({ title: 'Keep', urlTemplate: 'https://keep.com' });

      const invalidPayload = { items: 'invalid', tags: [] };
      const result = await restoreUnifiedBackup(invalidPayload, { collectionStore, searchEngineStore });

      assert.strictEqual(result.success, false);
      assert.strictEqual(collectionStore.getTags().length, 1);
      assert.strictEqual(searchEngineStore.getEngines().length, 1);
    });
  });

  describe('exportBackupFile', () => {
    it('generates unified backup and triggers download via tabAdapter', async () => {
      await collectionStore.addTag('ExportTag');
      await searchEngineStore.saveEngine({
        title: 'DownloadEngine',
        urlTemplate: 'https://dl.com?q={query}'
      });

      const result = await exportBackupFile(collectionStore, searchEngineStore, tabAdapter, 'custom_backup.json');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.filename, 'custom_backup.json');
      assert.strictEqual(tabAdapter.downloads.length, 1);
      assert.strictEqual(tabAdapter.downloads[0].filename, 'custom_backup.json');
      assert.strictEqual(tabAdapter.downloads[0].data.items.length, 0);
      assert.deepStrictEqual(tabAdapter.downloads[0].data.tags, ['ExportTag']);
      assert.strictEqual(tabAdapter.downloads[0].data.searchEngines.length, 1);
    });

    it('uses default formatted date filename when filename is not specified', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const result = await exportBackupFile(collectionStore, searchEngineStore, tabAdapter);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.filename, `collection_backup_${todayStr}.json`);
    });
  });
});
