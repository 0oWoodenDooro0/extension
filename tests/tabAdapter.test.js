import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTabAdapter, MemoryTabAdapter } from '../tabAdapter.js';

describe('BrowserTabAdapter Adjacent Tab Navigation', () => {
  let memoryAdapter;
  let tabAdapter;

  beforeEach(() => {
    memoryAdapter = new MemoryTabAdapter({
      activeTab: { id: 101, index: 3, title: 'Active Tab', url: 'https://active.com' }
    });
    tabAdapter = new BrowserTabAdapter(memoryAdapter);
  });

  describe('openAdjacent', () => {
    it('opens a new tab immediately after the active tab (index + 1) linked via openerTabId', async () => {
      const createdTab = await tabAdapter.openAdjacent('https://example.com/page1', { active: false });

      assert.strictEqual(createdTab.url, 'https://example.com/page1');
      assert.strictEqual(createdTab.index, 4);
      assert.strictEqual(createdTab.openerTabId, 101);
      assert.strictEqual(createdTab.active, false);
    });

    it('opens tab without index or openerTabId when no active tab is available', async () => {
      const emptyTabAdapter = new BrowserTabAdapter(new MemoryTabAdapter({ activeTab: null }));
      const createdTab = await emptyTabAdapter.openAdjacent('https://example.com/page3');

      assert.strictEqual(createdTab.url, 'https://example.com/page3');
      assert.strictEqual(createdTab.index, undefined);
      assert.strictEqual(createdTab.openerTabId, undefined);
      assert.strictEqual(createdTab.active, true);
    });
  });

  describe('openBatchAdjacent', () => {
    it('opens multiple tabs in order with sequentially incrementing indices after the active tab', async () => {
      const urls = [
        'https://example.com/batch1',
        'https://example.com/batch2',
        'https://example.com/batch3'
      ];

      const createdTabs = await tabAdapter.openBatchAdjacent(urls, { active: false });

      assert.strictEqual(createdTabs.length, 3);
      assert.deepStrictEqual(
        createdTabs.map(t => ({ url: t.url, index: t.index, openerTabId: t.openerTabId, active: t.active })),
        [
          { url: 'https://example.com/batch1', index: 4, openerTabId: 101, active: false },
          { url: 'https://example.com/batch2', index: 5, openerTabId: 101, active: false },
          { url: 'https://example.com/batch3', index: 6, openerTabId: 101, active: false }
        ]
      );
    });

    it('returns an empty array without creating tabs when given an empty list', async () => {
      const createdTabs = await tabAdapter.openBatchAdjacent([]);
      assert.deepStrictEqual(createdTabs, []);
      assert.strictEqual(memoryAdapter.createdTabs.length, 0);
    });
  });
});
