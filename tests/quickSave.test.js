import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter } from '../sidebar/store.js';
import { isValidWebUrl, saveActiveTabDirectly } from '../background.js';

describe('Quick Save Collection Item (saveActiveTabDirectly)', () => {
  describe('isValidWebUrl', () => {
    it('accepts standard http and https web URLs', () => {
      assert.strictEqual(isValidWebUrl('https://github.com'), true);
      assert.strictEqual(isValidWebUrl('http://localhost:3000'), true);
      assert.strictEqual(isValidWebUrl('https://example.com/sub/path?q=1#hash'), true);
    });

    it('rejects internal browser schemes and non-string values', () => {
      assert.strictEqual(isValidWebUrl('chrome://extensions'), false);
      assert.strictEqual(isValidWebUrl('chrome-extension://abcdef/popup.html'), false);
      assert.strictEqual(isValidWebUrl('about:blank'), false);
      assert.strictEqual(isValidWebUrl('file:///home/user/test.html'), false);
      assert.strictEqual(isValidWebUrl('view-source:https://example.com'), false);
      assert.strictEqual(isValidWebUrl(''), false);
      assert.strictEqual(isValidWebUrl(null), false);
      assert.strictEqual(isValidWebUrl(undefined), false);
      assert.strictEqual(isValidWebUrl(123), false);
    });
  });

  describe('saveActiveTabDirectly', () => {
    let store;

    beforeEach(async () => {
      store = new CollectionStore(new MemoryStorageAdapter());
      await store.load();
    });

    it('rejects tabs with invalid or non-web URLs without mutating the store', async () => {
      const tab = { id: 1, title: 'Extensions', url: 'chrome://extensions' };
      const result = await saveActiveTabDirectly(tab, store, {
        resolveImage: async () => {
          throw new Error('resolveImage should not be called for invalid URLs');
        }
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.reason, 'invalid_url');
      assert.strictEqual(store.getItems().length, 0);
    });

    it('saves a new Collection Item with its resolved cover image', async () => {
      const tab = {
        id: 101,
        title: 'Antigravity Documentation',
        url: 'https://antigravity.google.com/docs'
      };

      const resolvedUrls = [];
      const result = await saveActiveTabDirectly(tab, store, {
        resolveImage: async (url) => {
          resolvedUrls.push(url);
          return 'https://antigravity.google.com/og-cover.png';
        }
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.isExisting, false);
      assert.deepStrictEqual(resolvedUrls, ['https://antigravity.google.com/docs']);
      assert.strictEqual(result.item.title, 'Antigravity Documentation');
      assert.strictEqual(result.item.url, 'https://antigravity.google.com/docs');
      assert.strictEqual(result.item.imageUrl, 'https://antigravity.google.com/og-cover.png');

      const items = store.getItems();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, result.item.id);
    });

    it('updates an existing Collection Item by URL while preserving its Tags, Actors, and existing cover image', async () => {
      const initial = await store.saveItem({
        title: 'Original Title',
        url: 'https://example.com/article',
        imageUrl: 'https://example.com/existing-cover.jpg',
        tags: ['Favorite', 'Tech'],
        actors: ['Author A']
      });

      let resolveImageCalled = false;
      const updatedTab = {
        id: 102,
        title: 'Updated Title on Webpage',
        url: 'https://example.com/article'
      };
      const result = await saveActiveTabDirectly(updatedTab, store, {
        resolveImage: async () => {
          resolveImageCalled = true;
          return 'https://example.com/new-cover.jpg';
        }
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.isExisting, true);
      assert.strictEqual(resolveImageCalled, false, 'Should not re-fetch image when existing item already has imageUrl');
      assert.strictEqual(result.item.id, initial.id);
      assert.strictEqual(result.item.title, 'Updated Title on Webpage');
      assert.strictEqual(result.item.imageUrl, 'https://example.com/existing-cover.jpg');
      assert.deepStrictEqual(result.item.tags, ['Favorite', 'Tech']);
      assert.deepStrictEqual(result.item.actors, ['Author A']);
      assert.strictEqual(store.getItems().length, 1);
    });

    it('falls back to existing title or URL when tab.title is blank', async () => {
      const tab = {
        id: 103,
        title: '   ',
        url: 'https://example.com/no-title'
      };

      const result = await saveActiveTabDirectly(tab, store, {
        resolveImage: async () => null
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.item.title, 'https://example.com/no-title');
    });
  });
});
