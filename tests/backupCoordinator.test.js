import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter as CollectionMemoryAdapter } from '../sidebar/store.js';
import { SearchEngineStore, MemoryStorageAdapter as SearchEngineMemoryAdapter } from '../searchEngineStore.js';
import { MemoryTabAdapter } from '../tabAdapter.js';
import {
  createUnifiedBackup,
  validateBackupPayload,
  restoreUnifiedBackup,
  exportBackupFile
} from '../sidebar/backupCoordinator.js';

describe('Unified Backup Coordinator', () => {
  let collectionStore;
  let searchEngineStore;
  let tabAdapter;

  beforeEach(() => {
    collectionStore = new CollectionStore(new CollectionMemoryAdapter());
    searchEngineStore = new SearchEngineStore(new SearchEngineMemoryAdapter());
    tabAdapter = new MemoryTabAdapter();
  });

  describe('validateBackupPayload', () => {
    it('accepts valid Unified Backups (with or without optional searchEngines)', () => {
      assert.strictEqual(
        validateBackupPayload({
          version: 1,
          items: [{ id: 'item-1', title: 'Example', url: 'https://example.com', tags: ['News'] }],
          tags: ['News'],
          searchEngines: [{ id: 'se-1', title: 'Google', urlTemplate: 'https://google.com/search?q={query}' }]
        }).valid,
        true
      );

      assert.strictEqual(
        validateBackupPayload({
          items: [{ id: 'item-1', title: 'Legacy', url: 'https://legacy.com', tags: [] }],
          tags: []
        }).valid,
        true
      );
    });

    it('rejects non-objects or Unified Backups with malformed items, tags, or searchEngines arrays', () => {
      assert.strictEqual(validateBackupPayload(null).valid, false);
      assert.strictEqual(validateBackupPayload([]).valid, false);
      assert.strictEqual(validateBackupPayload({ tags: [] }).valid, false);
      assert.strictEqual(validateBackupPayload({ items: [] }).valid, false);

      const invalidEngines = validateBackupPayload({
        items: [],
        tags: [],
        searchEngines: 'not-an-array'
      });
      assert.strictEqual(invalidEngines.valid, false);
      assert.match(invalidEngines.error, /searchEngines/i);
    });
  });

  describe('createUnifiedBackup', () => {
    it('reloads fresh state from storage and returns a deep-copied Unified Backup', async () => {
      await collectionStore.addTag('Tech');
      await collectionStore.saveItem({
        title: 'Antigravity Doc',
        url: 'https://example.com/doc',
        tags: ['Tech'],
        actors: ['Vincent'],
        identifier: 'AG-DOC-01'
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
      assert.strictEqual(backup.items[0].identifier, 'AG-DOC-01');
      assert.deepStrictEqual(backup.tags, ['Tech']);
      assert.strictEqual(backup.searchEngines.length, 1);
      assert.strictEqual(backup.searchEngines[0].title, 'GitHub Search');

      // Mutating the returned backup must not mutate store state
      backup.tags.push('MutatedTag');
      backup.searchEngines[0].title = 'Mutated Title';
      assert.deepStrictEqual(collectionStore.getTags(), ['Tech']);
      assert.strictEqual(searchEngineStore.getEngines()[0].title, 'GitHub Search');
    });
  });

  describe('restoreUnifiedBackup', () => {
    it('restores Collection Items, Tags, and Search Engines and notifies both stores', async () => {
      const fullBackup = {
        version: 1,
        items: [
          {
            id: 'item-101',
            title: 'Restored Item',
            url: 'https://restored.com',
            tags: ['RestoredTag'],
            addDate: 1700000000000,
            actors: ['Hero'],
            identifier: 'REST-001'
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
      assert.deepStrictEqual(result.restored, {
        itemsCount: 1,
        tagsCount: 1,
        searchEnginesCount: 1
      });
      assert.strictEqual(collectionStore.getItemById('item-101')?.title, 'Restored Item');
      assert.strictEqual(collectionStore.getItemById('item-101')?.identifier, 'REST-001');
      assert.strictEqual(searchEngineStore.getEngineById('engine-101')?.title, 'Restored Engine');
      assert.strictEqual(collectionNotified, true);
      assert.strictEqual(searchEngineNotified, true);
    });

    it('preserves existing Search Engines when restoring a legacy backup without searchEngines, but overwrites when searchEngines is explicitly empty', async () => {
      await searchEngineStore.saveEngine({
        id: 'existing-engine',
        title: 'Preserved Engine',
        urlTemplate: 'https://preserved.com?q={query}'
      });

      const legacyResult = await restoreUnifiedBackup(
        {
          items: [{ id: 'legacy-item', title: 'Legacy Item', url: 'https://legacy.com', tags: ['LegacyTag'] }],
          tags: ['LegacyTag']
        },
        { collectionStore, searchEngineStore }
      );

      assert.strictEqual(legacyResult.success, true);
      assert.strictEqual(legacyResult.restored.searchEnginesCount, null);
      assert.strictEqual(searchEngineStore.getEngines().length, 1);

      const explicitEmptyResult = await restoreUnifiedBackup(
        { items: [], tags: [], searchEngines: [] },
        { collectionStore, searchEngineStore }
      );
      assert.strictEqual(explicitEmptyResult.success, true);
      assert.strictEqual(explicitEmptyResult.restored.searchEnginesCount, 0);
      assert.strictEqual(searchEngineStore.getEngines().length, 0);
    });

    it('leaves both stores untouched when given an invalid Unified Backup', async () => {
      await collectionStore.addTag('ExistingTag');
      await searchEngineStore.saveEngine({ title: 'Keep', urlTemplate: 'https://keep.com?q={query}' });

      const result = await restoreUnifiedBackup({ items: 'invalid', tags: [] }, { collectionStore, searchEngineStore });

      assert.strictEqual(result.success, false);
      assert.deepStrictEqual(collectionStore.getTags(), ['ExistingTag']);
      assert.strictEqual(searchEngineStore.getEngines().length, 1);
    });
  });

  describe('exportBackupFile', () => {
    it('exports Unified Backup JSON via tabAdapter with custom or default date-stamped filename', async () => {
      await collectionStore.addTag('ExportTag');
      await searchEngineStore.saveEngine({
        title: 'DownloadEngine',
        urlTemplate: 'https://dl.com?q={query}'
      });

      const customRes = await exportBackupFile(collectionStore, searchEngineStore, tabAdapter, 'custom_backup.json');
      assert.strictEqual(customRes.success, true);
      assert.strictEqual(customRes.filename, 'custom_backup.json');
      assert.deepStrictEqual(tabAdapter.downloads[0].data.tags, ['ExportTag']);
      assert.strictEqual(tabAdapter.downloads[0].data.searchEngines.length, 1);

      const todayStr = new Date().toISOString().split('T')[0];
      const defaultRes = await exportBackupFile(collectionStore, searchEngineStore, tabAdapter);
      assert.strictEqual(defaultRes.filename, `collection_backup_${todayStr}.json`);
    });
  });
});
