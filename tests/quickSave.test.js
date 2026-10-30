import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionStore, MemoryStorageAdapter } from '../sidebar/store.js';
import { isValidWebUrl, saveActiveTabDirectly, inPageToast } from '../background.js';
import {
  IdentifierRuleStore,
  MemoryStorageAdapter as RuleMemoryAdapter
} from '../identifierRuleStore.js';

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

    it('automatically extracts identifier from active tab URL matching rule store', async () => {
      const ruleStore = new IdentifierRuleStore(new RuleMemoryAdapter());
      await ruleStore.saveRule({
        name: 'GitHub Issues',
        urlPattern: 'github.com',
        extractionRegex: 'issues/(\\d+)'
      });

      const tab = {
        id: 201,
        title: 'Issue 20',
        url: 'https://github.com/0oWoodenDooro0/extension/issues/20'
      };

      const result = await saveActiveTabDirectly(tab, store, {
        resolveImage: async () => null,
        ruleStore
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.item.identifier, '20');
      assert.strictEqual(result.isDuplicate, false);
      assert.strictEqual(result.duplicateItem, null);
    });

    it('flags duplicate conflict and triggers warning badge and toast when identifier matches existing item', async () => {
      const ruleStore = new IdentifierRuleStore(new RuleMemoryAdapter());
      await ruleStore.saveRule({
        name: 'Issue Tracker',
        extractionRegex: 'ticket/([A-Z0-9-]+)'
      });

      // Existing item with conflicting identifier
      await store.saveItem({
        title: 'Initial Ticket Item',
        url: 'https://example.com/old-page',
        identifier: 'TICK-999'
      });

      let badgeText = null;
      let badgeColor = null;
      let toastCall = null;

      const originalChrome = globalThis.chrome;
      globalThis.chrome = {
        action: {
          setBadgeText: ({ text }) => { badgeText = text; },
          setBadgeBackgroundColor: ({ color }) => { badgeColor = color; }
        },
        scripting: {
          executeScript: async (params) => {
            toastCall = params;
            return [{ result: true }];
          }
        }
      };

      try {
        const tab = {
          id: 301,
          title: 'Duplicate Page',
          url: 'https://example.com/ticket/TICK-999'
        };

        const result = await saveActiveTabDirectly(tab, store, {
          resolveImage: async () => null,
          ruleStore
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.item.identifier, 'TICK-999');
        assert.strictEqual(result.isDuplicate, true);
        assert.ok(result.duplicateItem);
        assert.strictEqual(result.duplicateItem.title, 'Initial Ticket Item');

        // Verify badge indicates duplicate conflict warning
        assert.strictEqual(badgeText, '!');
        assert.strictEqual(badgeColor, '#D97706');

        // Verify toast notification HUD contains warning alert and conflict title
        assert.ok(toastCall);
        assert.strictEqual(toastCall.target.tabId, 301);
        assert.strictEqual(toastCall.func, inPageToast);
        assert.match(toastCall.args[0], /⚠️/);
        assert.match(toastCall.args[0], /Initial Ticket Item/);
        assert.strictEqual(toastCall.args[2], true, 'isDuplicate parameter must be true');
      } finally {
        globalThis.chrome = originalChrome;
      }
    });

    it('inPageToast renders duplicate warning style with alert styling in DOM', () => {
      const originalDoc = globalThis.document;
      const elements = [];
      const mockBody = {
        appendChild: (el) => {
          elements.push(el);
          return el;
        }
      };
      globalThis.document = {
        getElementById: () => null,
        createElement: (tag) => {
          const el = {
            tagName: tag,
            style: {},
            dataset: {},
            remove: () => {}
          };
          return el;
        },
        body: mockBody
      };
      globalThis.requestAnimationFrame = (cb) => cb();

      try {
        inPageToast('⚠️ 衝突：識別碼與「現有項目」重複', false, true);

        assert.strictEqual(elements.length, 1);
        const toast = elements[0];
        assert.strictEqual(toast.id, '__collection_ext_toast__');
        assert.match(toast.innerText, /⚠️/);
        assert.match(toast.style.background, /217,\s*119,\s*6/);
        assert.match(toast.style.border, /rgba\(253,\s*230,\s*138/);
      } finally {
        globalThis.document = originalDoc;
      }
    });
  });
});
