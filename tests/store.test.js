import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter } from '../sidebar/store.js';

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
