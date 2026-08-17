import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter, UNTAGGED_TAG } from '../sidebar/store.js';

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
});

