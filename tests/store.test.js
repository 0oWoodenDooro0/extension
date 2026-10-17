import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter, ChromeStorageAdapter, UNTAGGED_TAG } from '../sidebar/store.js';
import { SearchEngineStore } from '../searchEngineStore.js';
import { MemoryTabAdapter, BrowserTabAdapter } from '../tabAdapter.js';

describe('CollectionStore (Deep Module)', () => {
  let adapter;
  let store;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    store = new CollectionStore(adapter);
    await store.load();
  });

  describe('Item Operations', () => {
    it('creates a new item with auto-generated id and addDate', async () => {
      const item = await store.saveItem({
        title: 'Example Page',
        url: 'https://example.com',
        tags: ['Tech', 'News'],
        actors: ['Alice'],
        imageUrl: 'https://example.com/cover.jpg'
      });

      assert.ok(item.id.startsWith('item-'));
      assert.strictEqual(item.title, 'Example Page');
      assert.strictEqual(item.url, 'https://example.com');
      assert.deepStrictEqual(item.tags, ['Tech', 'News']);
      assert.deepStrictEqual(item.actors, ['Alice']);
      assert.ok(typeof item.addDate === 'number');

      // Verify retrieval from store
      assert.strictEqual(store.getItems().length, 1);
      assert.strictEqual(store.getItemById(item.id)?.title, 'Example Page');
      assert.strictEqual(store.getItemByUrl('https://example.com')?.id, item.id);

      // Verify persisted in adapter
      const persisted = await adapter.get(['items', 'tags']);
      assert.strictEqual(persisted.items.length, 1);
      assert.strictEqual(persisted.items[0].id, item.id);
    });

    it('updates an existing item when saving with an existing id', async () => {
      const created = await store.saveItem({
        title: 'Initial Title',
        url: 'https://example.com/1',
        tags: ['Tag1']
      });

      const updated = await store.saveItem({
        id: created.id,
        title: 'Updated Title',
        url: 'https://example.com/1-modified',
        tags: ['Tag1', 'Tag2'],
        actors: ['Bob']
      });

      assert.strictEqual(updated.id, created.id);
      assert.strictEqual(updated.title, 'Updated Title');
      assert.strictEqual(updated.url, 'https://example.com/1-modified');
      assert.deepStrictEqual(updated.tags, ['Tag1', 'Tag2']);
      assert.strictEqual(store.getItems().length, 1);
    });

    it('updates existing item if url matches even if id is omitted', async () => {
      await store.saveItem({
        title: 'First Save',
        url: 'https://example.com/page',
        tags: ['A']
      });

      const updated = await store.saveItem({
        title: 'Second Save with same URL',
        url: 'https://example.com/page',
        tags: ['A', 'B']
      });

      assert.strictEqual(store.getItems().length, 1);
      assert.strictEqual(updated.title, 'Second Save with same URL');
      assert.deepStrictEqual(updated.tags, ['A', 'B']);
    });

    it('deletes an item and persists', async () => {
      const item = await store.saveItem({
        title: 'To Delete',
        url: 'https://example.com/delete'
      });

      assert.strictEqual(store.getItems().length, 1);
      const deleted = await store.deleteItem(item.id);
      assert.strictEqual(deleted, true);
      assert.strictEqual(store.getItems().length, 0);

      const persisted = await adapter.get(['items', 'tags']);
      assert.strictEqual(persisted.items.length, 0);
    });

    it('returns all unique actors sorted alphabetically', async () => {
      await store.saveItem({
        title: 'Page 1',
        url: 'https://example.com/1',
        actors: ['Charlie', 'Alice']
      });
      await store.saveItem({
        title: 'Page 2',
        url: 'https://example.com/2',
        actors: ['Bob', 'Alice']
      });

      assert.deepStrictEqual(store.getAllActors(), ['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('Tag Operations & Cascades', () => {
    it('adds unique tags and ignores duplicates', async () => {
      const res1 = await store.addTag('Design');
      assert.strictEqual(res1, true);
      assert.deepStrictEqual(store.getTags(), ['Design']);

      const res2 = await store.addTag('Design');
      assert.strictEqual(res2, false);
      assert.deepStrictEqual(store.getTags(), ['Design']);
    });

    it('renames a tag and cascades the change to all items containing that tag', async () => {
      await store.addTag('OldTag');
      await store.addTag('OtherTag');

      const item1 = await store.saveItem({
        title: 'Item 1',
        url: 'https://example.com/1',
        tags: ['OldTag', 'OtherTag']
      });
      const item2 = await store.saveItem({
        title: 'Item 2',
        url: 'https://example.com/2',
        tags: ['OldTag']
      });
      const item3 = await store.saveItem({
        title: 'Item 3',
        url: 'https://example.com/3',
        tags: ['OtherTag']
      });

      const renamed = await store.renameTag('OldTag', 'NewTag');
      assert.strictEqual(renamed, true);

      // Verify tag list updated
      assert.deepStrictEqual(store.getTags(), ['NewTag', 'OtherTag']);

      // Verify cascade to items
      assert.deepStrictEqual(store.getItemById(item1.id)?.tags, ['NewTag', 'OtherTag']);
      assert.deepStrictEqual(store.getItemById(item2.id)?.tags, ['NewTag']);
      assert.deepStrictEqual(store.getItemById(item3.id)?.tags, ['OtherTag']);

      // Verify persisted in adapter
      const persisted = await adapter.get(['items', 'tags']);
      assert.deepStrictEqual(persisted.tags, ['NewTag', 'OtherTag']);
      assert.deepStrictEqual(persisted.items.find(i => i.id === item1.id)?.tags, ['NewTag', 'OtherTag']);
    });

    it('prevents renaming to an existing tag name', async () => {
      await store.addTag('Tag1');
      await store.addTag('Tag2');

      const renamed = await store.renameTag('Tag1', 'Tag2');
      assert.strictEqual(renamed, false);
      assert.deepStrictEqual(store.getTags(), ['Tag1', 'Tag2']);
    });

    it('deletes a tag and cascades removal from all items containing that tag', async () => {
      await store.addTag('TagToDelete');
      await store.addTag('KeepTag');

      const item1 = await store.saveItem({
        title: 'Item 1',
        url: 'https://example.com/1',
        tags: ['TagToDelete', 'KeepTag']
      });
      const item2 = await store.saveItem({
        title: 'Item 2',
        url: 'https://example.com/2',
        tags: ['TagToDelete']
      });

      const deleted = await store.deleteTag('TagToDelete');
      assert.strictEqual(deleted, true);

      // Verify tag list
      assert.deepStrictEqual(store.getTags(), ['KeepTag']);

      // Verify cascade removal from items
      assert.deepStrictEqual(store.getItemById(item1.id)?.tags, ['KeepTag']);
      assert.deepStrictEqual(store.getItemById(item2.id)?.tags, []);

      // Verify persistence
      const persisted = await adapter.get(['items', 'tags']);
      assert.deepStrictEqual(persisted.tags, ['KeepTag']);
      assert.deepStrictEqual(persisted.items.find(i => i.id === item1.id)?.tags, ['KeepTag']);
      assert.deepStrictEqual(persisted.items.find(i => i.id === item2.id)?.tags, []);
    });

    it('reorders tags', async () => {
      await store.addTag('A');
      await store.addTag('B');
      await store.addTag('C');

      await store.reorderTags(0, 2); // Move 'A' to index 2
      assert.deepStrictEqual(store.getTags(), ['B', 'C', 'A']);

      const persisted = await adapter.get(['items', 'tags']);
      assert.deepStrictEqual(persisted.tags, ['B', 'C', 'A']);
    });
  });

  describe('Query Interface (queryItems & getRandomItem)', () => {
    beforeEach(async () => {
      // Seed rich collection data for querying
      const item1 = await store.saveItem({
        title: 'React Documentation & Tutorial',
        url: 'https://react.dev',
        tags: ['Frontend', 'JavaScript'],
        actors: ['Dan Abramov']
      });
      item1.addDate = 1000; // Explicitly set orderable timestamps

      const item2 = await store.saveItem({
        title: 'Node.js Backend Guide',
        url: 'https://nodejs.org/guide',
        tags: ['Backend', 'JavaScript'],
        actors: ['Ryan Dahl', 'Dan Abramov']
      });
      item2.addDate = 2000;

      const item3 = await store.saveItem({
        title: 'Python Machine Learning',
        url: 'https://python.org',
        tags: ['AI', 'Python'],
        actors: ['Guido van Rossum']
      });
      item3.addDate = 3000;

      const item4 = await store.saveItem({
        title: 'Untagged Article',
        url: 'https://example.com/untagged',
        tags: [],
        actors: ['Anonymous']
      });
      item4.addDate = 4000;
    });

    it('returns all items sorted by addDate descending by default', () => {
      const results = store.queryItems();
      assert.strictEqual(results.length, 4);
      assert.strictEqual(results[0].title, 'Untagged Article'); // addDate: 4000
      assert.strictEqual(results[1].title, 'Python Machine Learning'); // addDate: 3000
      assert.strictEqual(results[2].title, 'Node.js Backend Guide'); // addDate: 2000
      assert.strictEqual(results[3].title, 'React Documentation & Tutorial'); // addDate: 1000
    });

    it('filters items by a single tag', () => {
      const results = store.queryItems({ tags: ['Frontend'] });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].title, 'React Documentation & Tutorial');
    });

    it('filters items by multiple tags using intersection logic', () => {
      const jsResults = store.queryItems({ tags: ['JavaScript'] });
      assert.strictEqual(jsResults.length, 2);

      const intersectionResults = store.queryItems({ tags: ['JavaScript', 'Backend'] });
      assert.strictEqual(intersectionResults.length, 1);
      assert.strictEqual(intersectionResults[0].title, 'Node.js Backend Guide');
    });

    it('filters untagged items with untagged boolean flag and UNTAGGED_TAG', () => {
      const byFlag = store.queryItems({ untagged: true });
      assert.strictEqual(byFlag.length, 1);
      assert.strictEqual(byFlag[0].title, 'Untagged Article');

      const byTagConstant = store.queryItems({ tags: [UNTAGGED_TAG] });
      assert.strictEqual(byTagConstant.length, 1);
      assert.strictEqual(byTagConstant[0].title, 'Untagged Article');
    });

    it('filters items by actor name with case-insensitive substring matching', () => {
      const results = store.queryItems({ actor: 'dan' });
      assert.strictEqual(results.length, 2);
      assert.ok(results.some(i => i.title === 'React Documentation & Tutorial'));
      assert.ok(results.some(i => i.title === 'Node.js Backend Guide'));

      const noMatch = store.queryItems({ actor: 'nobody' });
      assert.strictEqual(noMatch.length, 0);
    });

    it('filters items by multiple actors using intersection logic', () => {
      // Single actor in array
      const danResults = store.queryItems({ actors: ['Dan Abramov'] });
      assert.strictEqual(danResults.length, 2);
      assert.ok(danResults.some(i => i.title === 'React Documentation & Tutorial'));
      assert.ok(danResults.some(i => i.title === 'Node.js Backend Guide'));

      // Multiple actors - intersection: must contain all specified actors
      const bothResults = store.queryItems({ actors: ['Dan Abramov', 'Ryan Dahl'] });
      assert.strictEqual(bothResults.length, 1);
      assert.strictEqual(bothResults[0].title, 'Node.js Backend Guide');

      // Case-insensitive substring matching across multiple actors
      const subResults = store.queryItems({ actors: ['dan', 'ryan'] });
      assert.strictEqual(subResults.length, 1);
      assert.strictEqual(subResults[0].title, 'Node.js Backend Guide');

      // Mutually exclusive actors return empty
      const noIntersection = store.queryItems({ actors: ['Dan Abramov', 'Guido van Rossum'] });
      assert.strictEqual(noIntersection.length, 0);
    });

    it('handles edge cases in actors filtering (empty array, null/whitespace items, non-existent actors)', () => {
      // Empty actors array returns all items
      const emptyResults = store.queryItems({ actors: [] });
      assert.strictEqual(emptyResults.length, 4);

      // Whitespace and falsy items are safely filtered out
      const whitespaceResults = store.queryItems({ actors: ['  ', null, undefined] });
      assert.strictEqual(whitespaceResults.length, 4);

      // Mixed valid and whitespace actors
      const mixedResults = store.queryItems({ actors: ['Dan', '   '] });
      assert.strictEqual(mixedResults.length, 2);

      // Non-existent actor
      const noMatch = store.queryItems({ actors: ['non-existent-actor'] });
      assert.strictEqual(noMatch.length, 0);
    });

    it('performs fulltext search matching across title, url, and actor names', () => {
      // Match by title
      const titleMatch = store.queryItems({ search: 'machine' });
      assert.strictEqual(titleMatch.length, 1);
      assert.strictEqual(titleMatch[0].title, 'Python Machine Learning');

      // Match by url
      const urlMatch = store.queryItems({ search: 'nodejs.org' });
      assert.strictEqual(urlMatch.length, 1);
      assert.strictEqual(urlMatch[0].title, 'Node.js Backend Guide');

      // Match by actor
      const actorMatch = store.queryItems({ search: 'guido' });
      assert.strictEqual(actorMatch.length, 1);
      assert.strictEqual(actorMatch[0].title, 'Python Machine Learning');
    });

    it('combines tags, actor, and search criteria simultaneously', () => {
      const results = store.queryItems({
        tags: ['JavaScript'],
        actor: 'Dan',
        search: 'backend'
      });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].title, 'Node.js Backend Guide');
    });

    it('combines tags, multiple actors, and search criteria simultaneously', () => {
      const results = store.queryItems({
        tags: ['JavaScript'],
        actors: ['Dan', 'Ryan'],
        search: 'guide'
      });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].title, 'Node.js Backend Guide');

      // Tag mismatch with multiple actors
      const mismatch = store.queryItems({
        tags: ['Frontend'],
        actors: ['Dan', 'Ryan']
      });
      assert.strictEqual(mismatch.length, 0);
    });

    it('supports custom sorting order (asc vs desc)', () => {
      const ascResults = store.queryItems({ sortBy: 'addDate', sortOrder: 'asc' });
      assert.strictEqual(ascResults[0].title, 'React Documentation & Tutorial'); // addDate: 1000
      assert.strictEqual(ascResults[3].title, 'Untagged Article'); // addDate: 4000
    });

    it('returns a random matching item with getRandomItem() or null when empty', () => {
      const randomJs = store.getRandomItem({ tags: ['JavaScript'] });
      assert.ok(randomJs);
      assert.ok(randomJs.title === 'React Documentation & Tutorial' || randomJs.title === 'Node.js Backend Guide');

      const randomEmpty = store.getRandomItem({ search: 'nonexistent-xyz' });
      assert.strictEqual(randomEmpty, null);

      // Multi-actor random item
      const randomMultiActor = store.getRandomItem({ actors: ['Dan Abramov', 'Ryan Dahl'] });
      assert.ok(randomMultiActor);
      assert.strictEqual(randomMultiActor.title, 'Node.js Backend Guide');
    });
  });

  describe('Import & Export Portability', () => {
    it('exports clean snapshot of current state', async () => {
      await store.addTag('TagA');
      await store.saveItem({
        title: 'Item A',
        url: 'https://example.com/a',
        tags: ['TagA']
      });

      const exported = store.exportData();
      assert.strictEqual(exported.items.length, 1);
      assert.deepStrictEqual(exported.tags, ['TagA']);
      assert.strictEqual(exported.items[0].title, 'Item A');
    });

    it('imports valid dataset and persists', async () => {
      const dataToImport = {
        items: [
          {
            id: 'imported-1',
            title: 'Imported Title',
            url: 'https://imported.com',
            tags: ['ImportedTag'],
            addDate: 123456789,
            actors: ['Hero']
          }
        ],
        tags: ['ImportedTag']
      };

      const success = await store.importData(dataToImport);
      assert.strictEqual(success, true);
      assert.strictEqual(store.getItems().length, 1);
      assert.strictEqual(store.getItemById('imported-1')?.title, 'Imported Title');
      assert.deepStrictEqual(store.getTags(), ['ImportedTag']);
    });

    it('rejects invalid import payloads', async () => {
      assert.strictEqual(await store.importData(null), false);
      assert.strictEqual(await store.importData({ items: [] }), false);
      assert.strictEqual(await store.importData({ tags: [] }), false);
      assert.strictEqual(await store.importData('string'), false);
    });
  });

  describe('Pub-Sub Subscriptions', () => {
    it('notifies subscribers on data changes', async () => {
      let notificationCount = 0;
      const unsubscribe = store.subscribe(() => {
        notificationCount++;
      });

      await store.addTag('NewTag');
      await store.saveItem({ title: 'T', url: 'https://t.com' });
      await store.deleteTag('NewTag');

      assert.strictEqual(notificationCount, 3);

      unsubscribe();
      await store.addTag('AnotherTag');
      assert.strictEqual(notificationCount, 3); // No more notifications
    });
  });

  describe('Single Unified StorageAdapter Seam', () => {
    it('initializes with items, tags, and searchEngines arrays and preserves custom keys', async () => {
      const customAdapter = new MemoryStorageAdapter({
        custom_key: 'custom_val',
        last_sync_time: 123456
      });

      const data = await customAdapter.get(null);
      assert.deepStrictEqual(data.items, []);
      assert.deepStrictEqual(data.tags, []);
      assert.deepStrictEqual(data.searchEngines, []);
      assert.strictEqual(data.custom_key, 'custom_val');
      assert.strictEqual(data.last_sync_time, 123456);
    });

    it('supports retrieving single key string, key array, and object defaults', async () => {
      const mem = new MemoryStorageAdapter({
        tags: ['Reading'],
        items: [{ id: '1' }]
      });

      // String key
      const single = await mem.get('tags');
      assert.deepStrictEqual(single.tags, ['Reading']);

      // Array of keys
      const multiple = await mem.get(['tags', 'items', 'nonexistent']);
      assert.deepStrictEqual(multiple.tags, ['Reading']);
      assert.deepStrictEqual(multiple.items, [{ id: '1' }]);
      assert.strictEqual(multiple.nonexistent, undefined);

      // Object with defaults
      const withDefaults = await mem.get({
        tags: ['FallbackTag'],
        theme: 'dark'
      });
      assert.deepStrictEqual(withDefaults.tags, ['Reading']);
      assert.strictEqual(withDefaults.theme, 'dark');
    });

    it('supports remove and clear operations with onChanged notifications', async () => {
      const mem = new MemoryStorageAdapter({
        items: [{ id: '1' }],
        tags: ['Tag1'],
        searchEngines: [{ id: 'se-1' }]
      });

      let changedEvent = null;
      mem.onChanged((changes) => {
        changedEvent = changes;
      });

      await mem.remove('tags');
      assert.deepStrictEqual(await mem.get('tags'), {});
      assert.strictEqual(changedEvent.tags.oldValue[0], 'Tag1');
      assert.strictEqual(changedEvent.tags.newValue, undefined);

      await mem.clear();
      const all = await mem.get(null);
      assert.deepStrictEqual(all.items, []);
      assert.deepStrictEqual(all.tags, []);
      assert.deepStrictEqual(all.searchEngines, []);
    });

    it('acts as a single shared storage seam between CollectionStore and SearchEngineStore', async () => {
      const sharedStorage = new MemoryStorageAdapter();
      const collStore = new CollectionStore(sharedStorage);
      const seStore = new SearchEngineStore(sharedStorage);

      await collStore.saveItem({ title: 'Shared Item', url: 'https://shared.com' });
      await seStore.saveEngine({ title: 'Shared Engine', urlTemplate: 'https://engine.com?q={query}' });

      const all = await sharedStorage.get(['items', 'searchEngines']);
      assert.strictEqual(all.items.length, 1);
      assert.strictEqual(all.items[0].title, 'Shared Item');
      assert.strictEqual(all.searchEngines.length, 1);
      assert.strictEqual(all.searchEngines[0].title, 'Shared Engine');
    });
  });

  describe('Unified Snapshot & Backup Management (Deep Store Interface)', () => {
    let seStore;
    let tabAdapter;

    beforeEach(async () => {
      seStore = new SearchEngineStore(adapter);
      tabAdapter = new MemoryTabAdapter();
      await seStore.load();
    });

    describe('validateSnapshot', () => {
      it('validates a complete unified snapshot and returns detailed summary', () => {
        const payload = {
          version: 1,
          items: [{ id: 'item-1', title: 'Example', url: 'https://example.com', tags: ['News'] }],
          tags: ['News'],
          searchEngines: [{ id: 'se-1', title: 'Google', urlTemplate: 'https://google.com?q={query}' }]
        };

        const result = CollectionStore.validateSnapshot(payload);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.error, null);
        assert.strictEqual(result.hasItems, true);
        assert.strictEqual(result.hasTags, true);
        assert.strictEqual(result.hasSearchEngines, true);
        assert.strictEqual(result.counts.items, 1);
        assert.strictEqual(result.counts.tags, 1);
        assert.strictEqual(result.counts.searchEngines, 1);

        // Instance method is also available
        const instanceResult = store.validateSnapshot(payload);
        assert.deepStrictEqual(instanceResult, result);
      });

      it('validates a legacy snapshot without searchEngines', () => {
        const legacyPayload = {
          items: [{ id: 'item-1', title: 'Legacy', url: 'https://legacy.com', tags: [] }],
          tags: []
        };

        const result = CollectionStore.validateSnapshot(legacyPayload);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.error, null);
        assert.strictEqual(result.hasSearchEngines, false);
        assert.strictEqual(result.counts.searchEngines, 0);
      });

      it('rejects invalid payloads with error message and valid=false', () => {
        assert.strictEqual(CollectionStore.validateSnapshot(null).valid, false);
        assert.strictEqual(CollectionStore.validateSnapshot(undefined).valid, false);
        assert.strictEqual(CollectionStore.validateSnapshot('string').valid, false);
        assert.strictEqual(CollectionStore.validateSnapshot(123).valid, false);
        assert.strictEqual(CollectionStore.validateSnapshot([]).valid, false);
        assert.strictEqual(CollectionStore.validateSnapshot({ items: [] }).valid, false);
        assert.strictEqual(CollectionStore.validateSnapshot({ tags: [] }).valid, false);
        assert.strictEqual(CollectionStore.validateSnapshot({ items: [], tags: [], searchEngines: 'not-array' }).valid, false);
      });
    });

    describe('exportSnapshot', () => {
      it('exports unified snapshot containing items, tags, and search engines with timestamp and version', async () => {
        await store.addTag('Tech');
        await store.saveItem({ title: 'Item 1', url: 'https://item1.com', tags: ['Tech'] });
        await seStore.saveEngine({ title: 'SE 1', urlTemplate: 'https://se1.com?q={query}' });

        const snapshot = await store.exportSnapshot(seStore);
        assert.strictEqual(snapshot.version, 1);
        assert.ok(typeof snapshot.timestamp === 'number');
        assert.strictEqual(snapshot.items.length, 1);
        assert.strictEqual(snapshot.items[0].title, 'Item 1');
        assert.deepStrictEqual(snapshot.tags, ['Tech']);
        assert.strictEqual(snapshot.searchEngines.length, 1);
        assert.strictEqual(snapshot.searchEngines[0].title, 'SE 1');
      });

      it('creates deep copies preventing external mutation of store state', async () => {
        await store.addTag('OriginalTag');
        await seStore.saveEngine({ title: 'Original Engine', urlTemplate: 'https://ex.com?q={query}' });

        const snapshot = await store.exportSnapshot(seStore);
        snapshot.tags.push('HackedTag');
        snapshot.searchEngines[0].title = 'Hacked Engine';

        assert.deepStrictEqual(store.getTags(), ['OriginalTag']);
        assert.strictEqual(seStore.getEngines()[0].title, 'Original Engine');
      });

      it('re-reads storage to prevent stale cache overwrite in multi-context scenarios', async () => {
        // Direct write to adapter simulating another context (e.g. Background script or another window)
        await adapter.set({
          items: [{ id: 'direct-item', title: 'External Context Item', url: 'https://external.com', tags: [] }]
        });

        // store.items is currently empty in memory
        const snapshot = await store.exportSnapshot(seStore);
        assert.strictEqual(snapshot.items.length, 1);
        assert.strictEqual(snapshot.items[0].title, 'External Context Item');
      });
    });

    describe('restoreSnapshot', () => {
      it('restores full dataset updating CollectionStore and SearchEngineStore', async () => {
        const fullSnapshot = {
          version: 1,
          items: [{ id: 'res-1', title: 'Restored Item', url: 'https://res.com', tags: ['RTag'] }],
          tags: ['RTag'],
          searchEngines: [{ id: 'se-10', title: 'Restored Engine', urlTemplate: 'https://res-se.com?q={query}' }]
        };

        let collectionNotified = false;
        let seNotified = false;
        store.subscribe(() => { collectionNotified = true; });
        seStore.subscribe(() => { seNotified = true; });

        const result = await store.restoreSnapshot(fullSnapshot, { searchEngineStore: seStore });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.restored.itemsCount, 1);
        assert.strictEqual(result.restored.tagsCount, 1);
        assert.strictEqual(result.restored.searchEnginesCount, 1);

        assert.strictEqual(store.getItems().length, 1);
        assert.strictEqual(store.getItemById('res-1')?.title, 'Restored Item');
        assert.strictEqual(seStore.getEngines().length, 1);
        assert.strictEqual(seStore.getEngineById('se-10')?.title, 'Restored Engine');

        assert.strictEqual(collectionNotified, true);
        assert.strictEqual(seNotified, true);
      });

      it('preserves existing search engines when restoring legacy snapshot', async () => {
        await seStore.saveEngine({ id: 'stay', title: 'Keep Me', urlTemplate: 'https://keep.com?q={query}' });

        const legacySnapshot = {
          items: [{ id: 'leg-1', title: 'Legacy Item', url: 'https://leg.com', tags: [] }],
          tags: []
        };

        const result = await store.restoreSnapshot(legacySnapshot, { searchEngineStore: seStore });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.restored.searchEnginesCount, null);

        assert.strictEqual(store.getItems().length, 1);
        assert.strictEqual(seStore.getEngines().length, 1);
        assert.strictEqual(seStore.getEngineById('stay')?.title, 'Keep Me');
      });

      it('overwrites search engines when searchEngines array is explicitly empty', async () => {
        await seStore.saveEngine({ title: 'To Delete', urlTemplate: 'https://del.com' });

        const snapshot = {
          items: [],
          tags: [],
          searchEngines: []
        };

        const result = await store.restoreSnapshot(snapshot, { searchEngineStore: seStore });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.restored.searchEnginesCount, 0);
        assert.strictEqual(seStore.getEngines().length, 0);
      });

      it('rejects invalid payload and keeps existing data unmodified', async () => {
        await store.addTag('SavedTag');
        await seStore.saveEngine({ title: 'Saved Engine', urlTemplate: 'https://saved.com' });

        const invalid = { items: 'bad', tags: [] };
        const result = await store.restoreSnapshot(invalid, { searchEngineStore: seStore });

        assert.strictEqual(result.success, false);
        assert.strictEqual(store.getTags().length, 1);
        assert.strictEqual(seStore.getEngines().length, 1);
      });
    });

    describe('exportBackupFile', () => {
      it('exports backup and triggers download via tabAdapter.downloadJson without duck-typing', async () => {
        await store.addTag('TagX');
        await seStore.saveEngine({ title: 'EngineX', urlTemplate: 'https://x.com?q={query}' });

        const result = await store.exportBackupFile(tabAdapter, { filename: 'my_backup.json', searchEngineStore: seStore });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filename, 'my_backup.json');
        assert.strictEqual(tabAdapter.downloads.length, 1);
        assert.strictEqual(tabAdapter.downloads[0].filename, 'my_backup.json');
        assert.deepStrictEqual(tabAdapter.downloads[0].data.tags, ['TagX']);
        assert.strictEqual(tabAdapter.downloads[0].data.searchEngines.length, 1);
      });

      it('uses formatted date in default filename if filename is not provided', async () => {
        const todayStr = new Date().toISOString().split('T')[0];
        const result = await store.exportBackupFile(tabAdapter, { searchEngineStore: seStore });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filename, `collection_backup_${todayStr}.json`);
      });
    });
  });

  describe('TabAdapter downloadJson Interface', () => {
    it('MemoryTabAdapter provides downloadJson(data, filename) interface', async () => {
      const tab = new MemoryTabAdapter();
      const testData = { hello: 'world' };
      const res = await tab.downloadJson(testData, 'test.json');

      assert.strictEqual(res, true);
      assert.strictEqual(tab.downloads.length, 1);
      assert.strictEqual(tab.downloads[0].filename, 'test.json');
      assert.deepStrictEqual(tab.downloads[0].data, testData);
      assert.strictEqual(tab.downloads[0].mimeType, 'application/json');
    });
  });
});
