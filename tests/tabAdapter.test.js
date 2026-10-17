import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTabAdapter, MemoryTabAdapter } from '../tabAdapter.js';

describe('BrowserTabAdapter (Deep Module & Seam)', () => {
  let memoryAdapter;
  let tabAdapter;

  beforeEach(() => {
    memoryAdapter = new MemoryTabAdapter({
      activeTab: { id: 101, index: 3, title: 'Active Tab', url: 'https://active.com' },
      tabs: [
        { id: 101, index: 3, title: 'Active Tab', url: 'https://active.com', active: true },
        { id: 102, index: 4, title: 'Second Tab', url: 'https://second.com', active: false }
      ]
    });
    tabAdapter = new BrowserTabAdapter(memoryAdapter);
  });

  describe('getActiveTab', () => {
    it('returns the currently active tab details', async () => {
      const activeTab = await tabAdapter.getActiveTab();
      assert.ok(activeTab);
      assert.strictEqual(activeTab.id, 101);
      assert.strictEqual(activeTab.index, 3);
      assert.strictEqual(activeTab.title, 'Active Tab');
      assert.strictEqual(activeTab.url, 'https://active.com');
    });

    it('returns null when no active tab exists', async () => {
      const emptyAdapter = new MemoryTabAdapter({ activeTab: null });
      const emptyTabAdapter = new BrowserTabAdapter(emptyAdapter);

      const activeTab = await emptyTabAdapter.getActiveTab();
      assert.strictEqual(activeTab, null);
    });
  });

  describe('findTabs & findTabByUrl', () => {
    it('finds tabs by query criteria in MemoryTabAdapter', async () => {
      const allTabs = await tabAdapter.findTabs();
      assert.strictEqual(allTabs.length, 2);

      const activeTabs = await tabAdapter.findTabs({ active: true });
      assert.strictEqual(activeTabs.length, 1);
      assert.strictEqual(activeTabs[0].id, 101);

      const matchedTab = await tabAdapter.findTabByUrl('https://second.com');
      assert.ok(matchedTab);
      assert.strictEqual(matchedTab.id, 102);

      const nonExistent = await tabAdapter.findTabByUrl('https://unknown.com');
      assert.strictEqual(nonExistent, null);
    });
  });

  describe('executeScript', () => {
    it('executes script or returns tab dom result in MemoryTabAdapter', async () => {
      memoryAdapter.tabDomMap.set(101, 'https://active.com/image.jpg');

      const results = await tabAdapter.executeScript({
        target: { tabId: 101 },
        func: () => 'fallback'
      });

      assert.ok(results);
      assert.strictEqual(results[0].result, 'https://active.com/image.jpg');
    });

    it('returns null when no executor or DOM data is configured', async () => {
      const results = await tabAdapter.executeScript({
        target: { tabId: 999 },
        func: () => null
      });

      assert.strictEqual(results, null);
    });
  });

  describe('showSaveFeedback', () => {
    it('records feedback in MemoryTabAdapter', async () => {
      const tab = { id: 101 };
      const success = await tabAdapter.showSaveFeedback(tab, { isExisting: true, title: 'Item 1' });

      assert.strictEqual(success, true);
      assert.strictEqual(memoryAdapter.feedbackRecords.length, 1);
      assert.strictEqual(memoryAdapter.feedbackRecords[0].tab.id, 101);
      assert.strictEqual(memoryAdapter.feedbackRecords[0].options.isExisting, true);
    });
  });

  describe('openAdjacent', () => {
    it('opens a new tab immediately after the active tab with openerTabId', async () => {
      const createdTab = await tabAdapter.openAdjacent('https://example.com/page1');

      assert.strictEqual(createdTab.url, 'https://example.com/page1');
      assert.strictEqual(createdTab.index, 4); // activeTab.index (3) + 1
      assert.strictEqual(createdTab.openerTabId, 101); // activeTab.id
      assert.strictEqual(createdTab.active, true);

      // Verify recorded in memory adapter
      assert.strictEqual(memoryAdapter.createdTabs.length, 1);
      assert.strictEqual(memoryAdapter.createdTabs[0].url, 'https://example.com/page1');
    });

    it('supports opening inactive tab when active option is false', async () => {
      const createdTab = await tabAdapter.openAdjacent('https://example.com/page2', { active: false });

      assert.strictEqual(createdTab.active, false);
      assert.strictEqual(createdTab.index, 4);
      assert.strictEqual(createdTab.openerTabId, 101);
    });

    it('opens tab gracefully without index or openerTabId when no active tab exists', async () => {
      const emptyAdapter = new MemoryTabAdapter({ activeTab: null });
      const emptyTabAdapter = new BrowserTabAdapter(emptyAdapter);

      const createdTab = await emptyTabAdapter.openAdjacent('https://example.com/page3');

      assert.strictEqual(createdTab.url, 'https://example.com/page3');
      assert.strictEqual(createdTab.index, undefined);
      assert.strictEqual(createdTab.openerTabId, undefined);
      assert.strictEqual(createdTab.active, true);
    });
  });

  describe('openBatchAdjacent', () => {
    it('opens multiple tabs sequentially after the active tab with incrementing indices', async () => {
      const urls = [
        'https://example.com/batch1',
        'https://example.com/batch2',
        'https://example.com/batch3'
      ];

      const createdTabs = await tabAdapter.openBatchAdjacent(urls, { active: false });

      assert.strictEqual(createdTabs.length, 3);

      assert.strictEqual(createdTabs[0].url, 'https://example.com/batch1');
      assert.strictEqual(createdTabs[0].index, 4); // 3 + 1 + 0
      assert.strictEqual(createdTabs[0].openerTabId, 101);
      assert.strictEqual(createdTabs[0].active, false);

      assert.strictEqual(createdTabs[1].url, 'https://example.com/batch2');
      assert.strictEqual(createdTabs[1].index, 5); // 3 + 1 + 1
      assert.strictEqual(createdTabs[1].openerTabId, 101);

      assert.strictEqual(createdTabs[2].url, 'https://example.com/batch3');
      assert.strictEqual(createdTabs[2].index, 6); // 3 + 1 + 2
      assert.strictEqual(createdTabs[2].openerTabId, 101);

      assert.strictEqual(memoryAdapter.createdTabs.length, 3);
    });

    it('returns empty array when given empty URLs list', async () => {
      const createdTabs = await tabAdapter.openBatchAdjacent([]);
      assert.deepStrictEqual(createdTabs, []);
      assert.strictEqual(memoryAdapter.createdTabs.length, 0);
    });
  });

  describe('downloadJson', () => {
    it('serializes data and triggers download with given filename', async () => {
      const sampleData = { items: [{ id: 1, title: 'Sample' }], tags: ['Test'] };
      const filename = 'backup_2026-08-17.json';

      const downloadResult = await tabAdapter.downloadJson(sampleData, filename);

      assert.ok(downloadResult);
      assert.strictEqual(memoryAdapter.downloads.length, 1);
      assert.strictEqual(memoryAdapter.downloads[0].filename, filename);
      assert.ok(memoryAdapter.downloads[0].content.includes('Sample'));
    });
  });
});
