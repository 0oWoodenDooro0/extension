import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter } from '../sidebar/store.js';
import { isValidWebUrl, saveActiveTabDirectly, inPageToast } from '../background.js';

describe('Quick Save Feature (Keyboard Shortcut)', () => {
  describe('isValidWebUrl', () => {
    it('accepts standard http and https URLs', () => {
      assert.strictEqual(isValidWebUrl('https://github.com'), true);
      assert.strictEqual(isValidWebUrl('http://localhost:3000'), true);
      assert.strictEqual(isValidWebUrl('https://example.com/sub/path?q=1#hash'), true);
    });

    it('rejects internal browser pages and special schemes', () => {
      assert.strictEqual(isValidWebUrl('chrome://extensions'), false);
      assert.strictEqual(isValidWebUrl('chrome-extension://abcdef/popup.html'), false);
      assert.strictEqual(isValidWebUrl('about:blank'), false);
      assert.strictEqual(isValidWebUrl('file:///home/user/test.html'), false);
      assert.strictEqual(isValidWebUrl('view-source:https://example.com'), false);
    });

    it('rejects empty, null, or non-string inputs', () => {
      assert.strictEqual(isValidWebUrl(''), false);
      assert.strictEqual(isValidWebUrl(null), false);
      assert.strictEqual(isValidWebUrl(undefined), false);
      assert.strictEqual(isValidWebUrl(123), false);
    });
  });

  describe('saveActiveTabDirectly', () => {
    let adapter;
    let store;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter();
      store = new CollectionStore(adapter);
      await store.load();
    });

    it('returns error when tab has an invalid or internal URL', async () => {
      const tab = { id: 1, title: 'Extensions', url: 'chrome://extensions' };
      const result = await saveActiveTabDirectly(tab, store);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.reason, 'invalid_url');
      assert.strictEqual(store.getItems().length, 0);
    });

    it('saves a new valid web tab into CollectionStore', async () => {
      const tab = {
        id: 101,
        title: 'Antigravity Documentation',
        url: 'https://antigravity.google.com/docs'
      };

      const result = await saveActiveTabDirectly(tab, store);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.isExisting, false);
      assert.strictEqual(result.item.title, 'Antigravity Documentation');
      assert.strictEqual(result.item.url, 'https://antigravity.google.com/docs');

      // Verify in store
      const items = store.getItems();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].url, 'https://antigravity.google.com/docs');
    });

    it('updates existing item if saved again with updated title, preserving tags', async () => {
      // 1. Initial save with custom tag
      const firstTab = {
        id: 102,
        title: 'Original Title',
        url: 'https://example.com/article'
      };
      const initial = await saveActiveTabDirectly(firstTab, store);
      await store.saveItem({
        id: initial.item.id,
        title: initial.item.title,
        url: initial.item.url,
        tags: ['Favorite', 'Tech'],
        actors: ['Author A']
      });

      // 2. Trigger quick save again with updated tab title
      const updatedTab = {
        id: 102,
        title: 'Updated Title on Webpage',
        url: 'https://example.com/article'
      };
      const result = await saveActiveTabDirectly(updatedTab, store);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.isExisting, true);
      assert.strictEqual(result.item.title, 'Updated Title on Webpage');
      assert.strictEqual(result.item.id, initial.item.id);

      // Verify tags and actors were preserved
      assert.deepStrictEqual(result.item.tags, ['Favorite', 'Tech']);
      assert.deepStrictEqual(result.item.actors, ['Author A']);

      // No duplicate items created
      assert.strictEqual(store.getItems().length, 1);
    });

    it('uses URL as fallback title if tab.title is empty or whitespace', async () => {
      const tab = {
        id: 103,
        title: '   ',
        url: 'https://example.com/no-title'
      };

      const result = await saveActiveTabDirectly(tab, store);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.item.title, 'https://example.com/no-title');
    });
  });

  describe('inPageToast DOM execution (simulated DOM)', () => {
    it('creates toast element with proper styles and replaces previous toast', () => {
      // Simple mock DOM environment for inPageToast verification
      const elements = new Map();
      const mockDocument = {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => {
          const el = {
            tagName: tag,
            style: {},
            innerText: '',
            id: '',
            remove: () => {
              if (el.id) elements.delete(el.id);
            }
          };
          return el;
        },
        body: {
          appendChild: (el) => {
            if (el.id) elements.set(el.id, el);
          }
        }
      };

      global.document = mockDocument;
      global.requestAnimationFrame = (cb) => cb();

      // First toast
      inPageToast('Saved item 1', false);
      const toast1 = elements.get('__collection_ext_toast__');
      assert.ok(toast1);
      assert.strictEqual(toast1.innerText, 'Saved item 1');
      assert.ok(toast1.style.background.includes('16, 185, 129')); // Green theme

      // Second toast (replaces first)
      inPageToast('Updated item 2', true);
      const toast2 = elements.get('__collection_ext_toast__');
      assert.ok(toast2);
      assert.strictEqual(toast2.innerText, 'Updated item 2');
      assert.ok(toast2.style.background.includes('30, 64, 175')); // Blue theme

      // Cleanup mock
      delete global.document;
      delete global.requestAnimationFrame;
    });
  });
});
