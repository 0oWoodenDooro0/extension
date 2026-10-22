import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter } from '../sidebar/store.js';
import {
  isValidWebUrl,
  saveActiveTabDirectly,
  quickSaveActiveTab,
  captureTabMetadata,
  inPageToast
} from '../background.js';
import { BrowserTabAdapter, MemoryTabAdapter } from '../tabAdapter.js';

describe('Quick Save & Page Capture Feature (Deep Module)', () => {
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

  describe('captureTabMetadata', () => {
    let store;

    beforeEach(async () => {
      const storage = new MemoryStorageAdapter();
      store = new CollectionStore(storage);
      await store.load();
    });

    it('returns invalid result when tab or url is invalid', async () => {
      const result1 = await captureTabMetadata(null, { store });
      assert.strictEqual(result1.valid, false);
      assert.strictEqual(result1.reason, 'invalid_url');

      const result2 = await captureTabMetadata({ url: 'chrome://settings' }, { store });
      assert.strictEqual(result2.valid, false);
      assert.strictEqual(result2.reason, 'invalid_url');
    });

    it('extracts metadata for a new tab with fallback title', async () => {
      const tab = {
        id: 1,
        title: 'Google DeepMind',
        url: 'https://deepmind.google'
      };

      const result = await captureTabMetadata(tab, { store });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.isExisting, false);
      assert.strictEqual(result.title, 'Google DeepMind');
      assert.strictEqual(result.url, 'https://deepmind.google');
      assert.deepStrictEqual(result.tags, []);
      assert.deepStrictEqual(result.actors, []);
    });

    it('uses URL as fallback title when tab.title is empty or whitespace', async () => {
      const tab = {
        id: 2,
        title: '   ',
        url: 'https://example.com/no-title'
      };

      const result = await captureTabMetadata(tab, { store });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.title, 'https://example.com/no-title');
    });

    it('preserves existing tags, actors, and imageUrl when item already exists', async () => {
      await store.saveItem({
        title: 'Stored Title',
        url: 'https://existing.com',
        imageUrl: 'https://existing.com/pic.jpg',
        tags: ['AI', 'Tech'],
        actors: ['Alice', 'Bob']
      });

      const tab = {
        id: 3,
        title: 'Newly Visited Title',
        url: 'https://existing.com'
      };

      const result = await captureTabMetadata(tab, { store });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.isExisting, true);
      assert.strictEqual(result.title, 'Newly Visited Title');
      assert.strictEqual(result.imageUrl, 'https://existing.com/pic.jpg');
      assert.deepStrictEqual(result.tags, ['AI', 'Tech']);
      assert.deepStrictEqual(result.actors, ['Alice', 'Bob']);
    });
  });

  describe('quickSaveActiveTab & saveActiveTabDirectly', () => {
    let adapter;
    let store;
    let memoryTabAdapter;
    let tabAdapter;
    const noopFetch = async () => ({ ok: false, text: async () => '' });

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter();
      store = new CollectionStore(adapter);
      await store.load();

      memoryTabAdapter = new MemoryTabAdapter({
        activeTab: {
          id: 101,
          title: 'Antigravity Documentation',
          url: 'https://antigravity.google.com/docs'
        }
      });
      tabAdapter = new BrowserTabAdapter(memoryTabAdapter);
    });

    it('returns error when tab has an invalid or internal URL', async () => {
      const tab = { id: 1, title: 'Extensions', url: 'chrome://extensions' };
      const result = await quickSaveActiveTab({ tab, store, tabAdapter, fetchImpl: noopFetch });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.reason, 'invalid_url');
      assert.strictEqual(store.getItems().length, 0);
    });

    it('queries active tab from tabAdapter when tab is null and saves into store', async () => {
      const fakeFetch = async () => ({
        ok: true,
        text: async () => '<meta property="og:image" content="https://antigravity.google.com/cover.png">'
      });

      const result = await quickSaveActiveTab({
        tab: null,
        store,
        tabAdapter,
        fetchImpl: fakeFetch
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.isExisting, false);
      assert.strictEqual(result.item.title, 'Antigravity Documentation');
      assert.strictEqual(result.item.url, 'https://antigravity.google.com/docs');
      assert.strictEqual(result.item.imageUrl, 'https://antigravity.google.com/cover.png');

      // Verify in store
      const items = store.getItems();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].url, 'https://antigravity.google.com/docs');

      // Verify feedback was recorded through tabAdapter
      assert.strictEqual(memoryTabAdapter.feedbackRecords.length, 1);
      assert.strictEqual(memoryTabAdapter.feedbackRecords[0].options.isExisting, false);
    });

    it('updates existing item if saved again with updated title, preserving tags', async () => {
      // 1. Initial save with custom tag
      const firstTab = {
        id: 102,
        title: 'Original Title',
        url: 'https://example.com/article'
      };
      const initial = await quickSaveActiveTab({
        tab: firstTab,
        store,
        tabAdapter,
        fetchImpl: noopFetch
      });
      await store.saveItem({
        id: initial.item.id,
        title: initial.item.title,
        url: initial.item.url,
        imageUrl: 'https://example.com/cover.jpg',
        tags: ['Favorite', 'Tech'],
        actors: ['Author A']
      });

      // 2. Trigger quick save again with updated tab title
      const updatedTab = {
        id: 102,
        title: 'Updated Title on Webpage',
        url: 'https://example.com/article'
      };
      const result = await quickSaveActiveTab({
        tab: updatedTab,
        store,
        tabAdapter,
        fetchImpl: noopFetch
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.isExisting, true);
      assert.strictEqual(result.item.title, 'Updated Title on Webpage');
      assert.strictEqual(result.item.id, initial.item.id);
      assert.strictEqual(result.item.imageUrl, 'https://example.com/cover.jpg');

      // Verify tags and actors were preserved
      assert.deepStrictEqual(result.item.tags, ['Favorite', 'Tech']);
      assert.deepStrictEqual(result.item.actors, ['Author A']);

      // No duplicate items created
      assert.strictEqual(store.getItems().length, 1);

      // Verify feedback was recorded as isExisting = true
      assert.strictEqual(memoryTabAdapter.feedbackRecords.length, 2);
      assert.strictEqual(memoryTabAdapter.feedbackRecords[1].options.isExisting, true);
    });

    it('saveActiveTabDirectly maintains backward compatibility', async () => {
      const tab = {
        id: 103,
        title: 'Direct Save',
        url: 'https://example.com/direct'
      };

      const result = await saveActiveTabDirectly(tab, store, { tabAdapter, fetchImpl: noopFetch });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.item.title, 'Direct Save');
      assert.strictEqual(result.item.url, 'https://example.com/direct');
    });
  });

  describe('inPageToast DOM execution (simulated DOM)', () => {
    it('creates toast element with proper styles and replaces previous toast', () => {
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
