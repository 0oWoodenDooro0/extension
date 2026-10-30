import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter, UNTAGGED_TAG } from '../sidebar/store.js';

describe('CollectionStore (Collection Items, Tags & Actors)', () => {
  let adapter;
  let store;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    store = new CollectionStore(adapter);
    await store.load();
  });

  describe('Collection Item CRUD & Deduplication', () => {
    it('creates a new Collection Item with generated ID and persists to storage', async () => {
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

      assert.strictEqual(store.getItemById(item.id)?.title, 'Example Page');
      assert.strictEqual(store.getItemByUrl('https://example.com')?.id, item.id);

      const persisted = await adapter.get(['items', 'tags']);
      assert.strictEqual(persisted.items.length, 1);
      assert.strictEqual(persisted.items[0].id, item.id);
    });

    it('deduplicates by URL when saving without an ID, or updates in-place when saving with an existing ID', async () => {
      const created = await store.saveItem({
        title: 'First Save',
        url: 'https://example.com/page',
        tags: ['A']
      });

      // Saving same URL without ID updates existing record instead of creating a duplicate
      const deduped = await store.saveItem({
        title: 'Second Save Same URL',
        url: 'https://example.com/page',
        tags: ['A', 'B']
      });
      assert.strictEqual(store.getItems().length, 1);
      assert.strictEqual(deduped.id, created.id);
      assert.strictEqual(deduped.title, 'Second Save Same URL');
      assert.deepStrictEqual(deduped.tags, ['A', 'B']);

      // Saving with explicit ID can update the URL itself
      const updatedUrl = await store.saveItem({
        id: created.id,
        title: 'Moved URL',
        url: 'https://example.com/page-v2',
        tags: ['B']
      });
      assert.strictEqual(store.getItems().length, 1);
      assert.strictEqual(updatedUrl.url, 'https://example.com/page-v2');
    });

    it('deletes a Collection Item by ID and persists removal', async () => {
      const item = await store.saveItem({
        title: 'To Delete',
        url: 'https://example.com/delete'
      });

      assert.strictEqual(await store.deleteItem(item.id), true);
      assert.strictEqual(store.getItems().length, 0);
      assert.strictEqual(await store.deleteItem('non-existent'), false);

      const persisted = await adapter.get(['items']);
      assert.strictEqual(persisted.items.length, 0);
    });

    it('collects unique Actors across all Collection Items sorted alphabetically', async () => {
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

    it('supports optional identifier across saveItem, updates, and persistence reload', async () => {
      const item = await store.saveItem({
        title: 'Identifier Test',
        url: 'https://example.com/ident',
        identifier: '  RFC-1234  '
      });

      assert.strictEqual(item.identifier, 'RFC-1234');
      assert.strictEqual(store.getItemById(item.id)?.identifier, 'RFC-1234');

      // Check persistence
      const persisted = await adapter.get(['items']);
      assert.strictEqual(persisted.items[0].identifier, 'RFC-1234');

      // Reload store from adapter
      const newStore = new CollectionStore(adapter);
      await newStore.load();
      assert.strictEqual(newStore.getItemById(item.id)?.identifier, 'RFC-1234');

      // Update identifier
      const updated = await store.saveItem({
        id: item.id,
        title: 'Identifier Test Updated',
        url: 'https://example.com/ident',
        identifier: 'RFC-5678'
      });
      assert.strictEqual(updated.identifier, 'RFC-5678');
      assert.strictEqual(store.getItemById(item.id)?.identifier, 'RFC-5678');

      // Clearing identifier with empty string or null sets it to null
      const cleared = await store.saveItem({
        id: item.id,
        title: 'Identifier Test Cleared',
        url: 'https://example.com/ident',
        identifier: '   '
      });
      assert.strictEqual(cleared.identifier, null);
    });

    it('provides case-insensitive duplicate identifier lookup excluding specified itemId', async () => {
      const item1 = await store.saveItem({
        title: 'Original RFC',
        url: 'https://example.com/rfc1',
        identifier: 'RFC-999'
      });
      const item2 = await store.saveItem({
        title: 'Second Spec',
        url: 'https://example.com/rfc2',
        identifier: 'SPEC-100'
      });

      // Exact and case-insensitive match
      assert.strictEqual(store.hasDuplicateIdentifier('RFC-999'), true);
      assert.strictEqual(store.hasDuplicateIdentifier('  rfc-999  '), true);
      assert.strictEqual(store.findItemByIdentifier('rfc-999')?.id, item1.id);
      assert.strictEqual(store.findItemByIdentifier('spec-100')?.title, 'Second Spec');

      // Exclude specified itemId (e.g. during item edit)
      assert.strictEqual(store.hasDuplicateIdentifier('RFC-999', item1.id), false);
      assert.strictEqual(store.findItemByIdentifier('RFC-999', item1.id), null);
      assert.strictEqual(store.hasDuplicateIdentifier('RFC-999', item2.id), true);

      // Non-existent or empty/whitespace identifiers
      assert.strictEqual(store.hasDuplicateIdentifier('NONEXISTENT'), false);
      assert.strictEqual(store.findItemByIdentifier('NONEXISTENT'), null);
      assert.strictEqual(store.hasDuplicateIdentifier(''), false);
      assert.strictEqual(store.hasDuplicateIdentifier('   '), false);
      assert.strictEqual(store.findItemByIdentifier(null), null);
    });
  });

  describe('Tag Management & Cascade Updates', () => {
    it('adds unique Tags, rejects duplicates, and supports reordering', async () => {
      assert.strictEqual(await store.addTag('Design'), true);
      assert.strictEqual(await store.addTag('Design'), false);
      await store.addTag('Engineering');
      await store.addTag('Product');

      await store.reorderTags(0, 2);
      assert.deepStrictEqual(store.getTags(), ['Engineering', 'Product', 'Design']);
    });

    it('renames a Tag and cascades the new name to all associated Collection Items while preventing name collisions', async () => {
      await store.addTag('OldTag');
      await store.addTag('ExistingTag');

      const item1 = await store.saveItem({
        title: 'Item 1',
        url: 'https://example.com/1',
        tags: ['OldTag', 'ExistingTag']
      });
      const item2 = await store.saveItem({
        title: 'Item 2',
        url: 'https://example.com/2',
        tags: ['ExistingTag']
      });

      // Collision with ExistingTag must be rejected
      assert.strictEqual(await store.renameTag('OldTag', 'ExistingTag'), false);

      assert.strictEqual(await store.renameTag('OldTag', 'NewTag'), true);
      assert.deepStrictEqual(store.getTags(), ['NewTag', 'ExistingTag']);
      assert.deepStrictEqual(store.getItemById(item1.id)?.tags, ['NewTag', 'ExistingTag']);
      assert.deepStrictEqual(store.getItemById(item2.id)?.tags, ['ExistingTag']);
    });

    it('deletes a Tag and cascades removal from all associated Collection Items', async () => {
      await store.addTag('TagToDelete');
      await store.addTag('KeepTag');

      const item = await store.saveItem({
        title: 'Tagged Item',
        url: 'https://example.com/1',
        tags: ['TagToDelete', 'KeepTag']
      });

      assert.strictEqual(await store.deleteTag('TagToDelete'), true);
      assert.deepStrictEqual(store.getTags(), ['KeepTag']);
      assert.deepStrictEqual(store.getItemById(item.id)?.tags, ['KeepTag']);
    });
  });

  describe('Query Interface (queryItems & getRandomItem)', () => {
    beforeEach(async () => {
      await store.importData({
        tags: ['Frontend', 'Backend', 'JavaScript', 'AI', 'Python'],
        items: [
          {
            id: 'item-1',
            title: 'React Documentation & Tutorial',
            url: 'https://react.dev',
            tags: ['Frontend', 'JavaScript'],
            actors: ['Dan Abramov'],
            addDate: 1000
          },
          {
            id: 'item-2',
            title: 'Node.js Backend Guide',
            url: 'https://nodejs.org/guide',
            tags: ['Backend', 'JavaScript'],
            actors: ['Ryan Dahl', 'Dan Abramov'],
            identifier: 'NODE-GUIDE-01',
            addDate: 2000
          },
          {
            id: 'item-3',
            title: 'Python Machine Learning',
            url: 'https://python.org',
            tags: ['AI', 'Python'],
            actors: ['Guido van Rossum'],
            addDate: 3000
          },
          {
            id: 'item-4',
            title: 'Untagged Article',
            url: 'https://example.com/untagged',
            tags: [],
            actors: ['Anonymous'],
            addDate: 4000
          }
        ]
      });
    });

    it('sorts Collection Items by addDate descending by default and supports ascending sort', () => {
      const descResults = store.queryItems();
      assert.deepStrictEqual(descResults.map(i => i.id), ['item-4', 'item-3', 'item-2', 'item-1']);

      const ascResults = store.queryItems({ sortBy: 'addDate', sortOrder: 'asc' });
      assert.deepStrictEqual(ascResults.map(i => i.id), ['item-1', 'item-2', 'item-3', 'item-4']);
    });

    it('filters by Tag intersection and Untagged scope', () => {
      const singleTag = store.queryItems({ tags: ['JavaScript'] });
      assert.strictEqual(singleTag.length, 2);

      const intersection = store.queryItems({ tags: ['JavaScript', 'Backend'] });
      assert.deepStrictEqual(intersection.map(i => i.id), ['item-2']);

      const untaggedByFlag = store.queryItems({ untagged: true });
      assert.deepStrictEqual(untaggedByFlag.map(i => i.id), ['item-4']);

      const untaggedByConstant = store.queryItems({ tags: [UNTAGGED_TAG] });
      assert.deepStrictEqual(untaggedByConstant.map(i => i.id), ['item-4']);
    });

    it('filters by multiple Actors using case-insensitive substring intersection while ignoring blank inputs', () => {
      const singleActor = store.queryItems({ actors: ['dan', '   ', null] });
      assert.strictEqual(singleActor.length, 2);

      const multiActorIntersection = store.queryItems({ actors: ['dan', 'ryan'] });
      assert.deepStrictEqual(multiActorIntersection.map(i => i.id), ['item-2']);

      const disjointActors = store.queryItems({ actors: ['Dan Abramov', 'Guido van Rossum'] });
      assert.strictEqual(disjointActors.length, 0);
    });

    it('combines Tag intersection, Actor intersection, and full-text search across title, URL, and Actors', () => {
      assert.deepStrictEqual(store.queryItems({ search: 'machine' }).map(i => i.id), ['item-3']);
      assert.deepStrictEqual(store.queryItems({ search: 'nodejs.org' }).map(i => i.id), ['item-2']);
      assert.deepStrictEqual(store.queryItems({ search: 'node-guide' }).map(i => i.id), ['item-2']);
      assert.deepStrictEqual(store.queryItems({ search: 'guido' }).map(i => i.id), ['item-3']);

      assert.deepStrictEqual(store.queryItems({ identifier: 'NODE-GUIDE-01' }).map(i => i.id), ['item-2']);
      assert.deepStrictEqual(store.queryItems({ identifier: '  node-guide-01  ' }).map(i => i.id), ['item-2']);
      assert.deepStrictEqual(store.queryItems({ identifier: 'nonexistent' }), []);

      const combined = store.queryItems({
        tags: ['JavaScript'],
        actors: ['Dan', 'Ryan'],
        search: 'guide'
      });
      assert.deepStrictEqual(combined.map(i => i.id), ['item-2']);
    });

    it('returns a matching Collection Item from getRandomItem or null when no items match', () => {
      const match = store.getRandomItem({ tags: ['JavaScript'], actors: ['Dan Abramov', 'Ryan Dahl'] });
      assert.strictEqual(match?.id, 'item-2');

      const empty = store.getRandomItem({ search: 'nonexistent-xyz' });
      assert.strictEqual(empty, null);
    });
  });

  describe('Cross-Window Synchronization & Subscriptions', () => {
    it('updates in-memory state and emits external sync notification when shared storage changes', async () => {
      const events = [];
      const unsubscribe = store.subscribe((event) => events.push(event));

      await store.addTag('LocalTag');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'tagAdded');

      // Simulate an external context (e.g. background Quick Save or Sync) writing to storage
      await adapter.set({
        items: [{ id: 'ext-item', title: 'From Background', url: 'https://bg.com', tags: ['ExtTag'] }],
        tags: ['ExtTag']
      });

      assert.strictEqual(events.length, 2);
      assert.deepStrictEqual(events[1], { type: 'sync', source: 'external' });
      assert.strictEqual(store.getItemById('ext-item')?.title, 'From Background');
      assert.deepStrictEqual(store.getTags(), ['ExtTag']);

      unsubscribe();
      await store.addTag('IgnoredTag');
      assert.strictEqual(events.length, 2);
    });
  });
});
