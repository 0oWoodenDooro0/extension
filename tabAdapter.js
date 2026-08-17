// tabAdapter.js - 統一分頁與下載導航適配器模組 (Browser Tab & Download Adapter)
// 封裝分頁查詢、相鄰位置插入 (openerTabId / index + 1)、批次開啟與檔案下載

/**
 * 記憶體分頁適配器 (適用於測試環境與無瀏覽器環境)
 */
export class MemoryTabAdapter {
  constructor(initialData = {}) {
    this.activeTab = initialData.activeTab !== undefined ? initialData.activeTab : null;
    this.createdTabs = [];
    this.downloads = [];
    this.idCounter = 1000;
  }

  async getActiveTab() {
    return this.activeTab ? { ...this.activeTab } : null;
  }

  async createTab({ url, index, openerTabId, active = true }) {
    const newTab = {
      id: ++this.idCounter,
      url,
      index,
      openerTabId,
      active
    };
    this.createdTabs.push(newTab);
    return newTab;
  }

  async download({ content, filename, mimeType = 'application/json' }) {
    const record = {
      content,
      filename,
      mimeType,
      timestamp: Date.now()
    };
    this.downloads.push(record);
    return true;
  }
}

/**
 * 瀏覽器 Chrome 分頁與下載適配器
 */
export class ChromeTabAdapter {
  async getActiveTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      return null;
    }
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(tabs && tabs.length > 0 ? tabs[0] : null);
        }
      });
    });
  }

  async createTab({ url, index, openerTabId, active = true }) {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.create) {
      return { url, index, openerTabId, active };
    }
    return new Promise((resolve, reject) => {
      const createProperties = { url, active };
      if (index !== undefined) createProperties.index = index;
      if (openerTabId !== undefined) createProperties.openerTabId = openerTabId;

      chrome.tabs.create(createProperties, (createdTab) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(createdTab);
        }
      });
    });
  }

  async download({ content, filename, mimeType = 'application/json' }) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      return chrome.downloads.download({ url, filename, saveAs: true })
        .then(() => {
          URL.revokeObjectURL(url);
          return true;
        })
        .catch(() => {
          URL.revokeObjectURL(url);
          return false;
        });
    } else if (typeof document !== 'undefined') {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }
    return false;
  }
}

/**
 * BrowserTabAdapter 深度模組
 */
export class BrowserTabAdapter {
  constructor(adapter = null) {
    this.adapter = adapter || (typeof chrome !== 'undefined' && chrome.tabs ? new ChromeTabAdapter() : new MemoryTabAdapter());
  }

  /**
   * 取得當前作用中分頁詳細資訊
   */
  async getActiveTab() {
    return await this.adapter.getActiveTab();
  }

  /**
   * 在當前分頁後方相鄰開啟新分頁 (自動計算 index + 1 並設定 openerTabId)
   */
  async openAdjacent(url, { tab = null, active = true } = {}) {
    const currentTab = tab || (await this.getActiveTab());
    const index = currentTab && typeof currentTab.index === 'number' ? currentTab.index + 1 : undefined;
    const openerTabId = currentTab ? currentTab.id : undefined;

    return await this.adapter.createTab({
      url,
      index,
      openerTabId,
      active
    });
  }

  /**
   * 批次在當前分頁後方依序開啟多個分頁
   */
  async openBatchAdjacent(urls = [], { tab = null, active = false } = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
      return [];
    }

    const currentTab = tab || (await this.getActiveTab());
    const startIndex = currentTab && typeof currentTab.index === 'number' ? currentTab.index + 1 : undefined;
    const openerTabId = currentTab ? currentTab.id : undefined;

    const createdTabs = [];
    for (let i = 0; i < urls.length; i++) {
      const index = startIndex !== undefined ? startIndex + i : undefined;
      const createdTab = await this.adapter.createTab({
        url: urls[i],
        index,
        openerTabId,
        active
      });
      createdTabs.push(createdTab);
    }
    return createdTabs;
  }

  /**
   * 將資料序列化為格式化 JSON 檔案並觸發下載
   */
  async downloadJson(data, filename = 'backup.json') {
    const content = JSON.stringify(data, null, 2);
    return await this.adapter.download({
      content,
      filename,
      mimeType: 'application/json'
    });
  }
}

// 預設全域 Singleton 實例
export const tabAdapter = new BrowserTabAdapter();
