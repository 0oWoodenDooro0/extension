// tabAdapter.js - 統一分頁與下載導航適配器模組 (Browser Tab & Download Adapter)
// 封裝分頁查詢、相鄰位置插入 (openerTabId / index + 1)、批次開啟、腳本注入與檔案下載

/**
 * 注入至網頁 DOM 中的浮動 Toast 提示函式
 * (必須維持純函式、零外部閉包依賴，以便透過 chrome.scripting.executeScript 序列化注入)
 * @param {string} message 
 * @param {boolean} isExisting 
 */
export function inPageToast(message, isExisting) {
  const TOAST_ID = '__collection_ext_toast__';
  const existingToast = document.getElementById(TOAST_ID);
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.innerText = message;

  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    padding: '10px 18px',
    background: isExisting ? 'rgba(30, 64, 175, 0.94)' : 'rgba(16, 185, 129, 0.94)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.1)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    opacity: '0',
    transform: 'translateY(-10px) scale(0.96)',
    pointerEvents: 'none'
  });

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  });

  const hideTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px) scale(0.96)';
    const removeTimer = setTimeout(() => toast.remove(), 260);
    if (typeof removeTimer?.unref === 'function') removeTimer.unref();
  }, 2000);
  if (typeof hideTimer?.unref === 'function') hideTimer.unref();
}

/**
 * 記憶體分頁適配器 (適用於測試環境與無瀏覽器環境)
 */
export class MemoryTabAdapter {
  constructor(initialData = {}) {
    this.activeTab = initialData.activeTab !== undefined
      ? initialData.activeTab
      : (Array.isArray(initialData.tabs) ? (initialData.tabs.find(t => t.active) || null) : null);
    this.tabs = initialData.tabs
      ? [...initialData.tabs]
      : (this.activeTab ? [{ ...this.activeTab }] : []);
    this.createdTabs = [];
    this.downloads = [];
    this.feedbackRecords = [];
    this.idCounter = 1000;
    this.scriptExecutor = initialData.scriptExecutor || null;
    this.tabDomMap = initialData.tabDomMap instanceof Map ? initialData.tabDomMap : new Map();
  }

  async getActiveTab() {
    return this.activeTab ? { ...this.activeTab } : null;
  }

  async findTabs(query = {}) {
    let result = [...this.tabs];
    if (query.active !== undefined) {
      result = result.filter(t => (t.active ?? false) === query.active);
    }
    if (query.url !== undefined) {
      result = result.filter(t => t.url === query.url);
    }
    return result.map(t => ({ ...t }));
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
    this.tabs.push(newTab);
    if (active) {
      this.activeTab = newTab;
    }
    return newTab;
  }

  async executeScript({ target = {}, func, args = [] } = {}) {
    const tabId = target.tabId;
    if (this.scriptExecutor) {
      return await this.scriptExecutor({ tabId, func, args });
    }
    if (this.tabDomMap.has(tabId)) {
      const data = this.tabDomMap.get(tabId);
      return [{ result: typeof data === 'function' ? data() : data }];
    }
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.domResult !== undefined) {
      return [{ result: tab.domResult }];
    }
    if (typeof func === 'function' && typeof document !== 'undefined') {
      try {
        const res = func(...args);
        return [{ result: res }];
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async showSaveFeedback(tab, options = {}) {
    this.feedbackRecords.push({ tab, options, timestamp: Date.now() });
    return true;
  }

  async download({ content, filename, mimeType = 'application/json', data = null }) {
    let parsedData = data;
    if (!parsedData && typeof content === 'string' && (mimeType.includes('json') || (filename && filename.endsWith('.json')))) {
      try {
        parsedData = JSON.parse(content);
      } catch (e) {
        // ignore non-json string
      }
    }
    const record = {
      content,
      filename,
      mimeType,
      data: parsedData,
      timestamp: Date.now()
    };
    this.downloads.push(record);
    return true;
  }

  async downloadJson(data, filename = 'backup.json') {
    const content = JSON.stringify(data, null, 2);
    return await this.download({
      content,
      filename,
      mimeType: 'application/json',
      data
    });
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
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(tabs && tabs.length > 0 ? tabs[0] : null);
          }
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async findTabs(query = {}) {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      return [];
    }
    return new Promise((resolve) => {
      try {
        chrome.tabs.query(query, (tabs) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve([]);
          } else {
            resolve(tabs || []);
          }
        });
      } catch (e) {
        resolve([]);
      }
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

  async executeScript({ target = {}, func, args = [] } = {}) {
    if (typeof chrome === 'undefined' || !chrome.scripting || !chrome.scripting.executeScript) {
      return null;
    }
    try {
      const results = await chrome.scripting.executeScript({
        target,
        func,
        args
      });
      return results;
    } catch (err) {
      return null;
    }
  }

  async showSaveFeedback(tab, { isExisting = false, title = '' } = {}) {
    if (!tab || !tab.id) return false;

    // 1. Badge 提示
    if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setBadgeText) {
      try {
        chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({
          color: isExisting ? '#2563EB' : '#10B981',
          tabId: tab.id
        });
        const badgeTimer = setTimeout(() => {
          try {
            chrome.action.setBadgeText({ text: '', tabId: tab.id });
          } catch (e) {}
        }, 2000);
        if (typeof badgeTimer?.unref === 'function') badgeTimer.unref();
      } catch (e) {}
    }

    // 2. 注入 Toast
    if (typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
      try {
        const displayTitle = title ? (title.length > 32 ? title.slice(0, 32) + '...' : title) : 'Page';
        const msg = isExisting ? `✓ 已更新收藏：${displayTitle}` : `✓ 已收藏至 Collection：${displayTitle}`;

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: inPageToast,
          args: [msg, isExisting]
        });
      } catch (e) {}
    }
    return true;
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
   * 查詢符合條件的分頁
   */
  async findTabs(query = {}) {
    if (typeof this.adapter.findTabs === 'function') {
      return await this.adapter.findTabs(query);
    }
    return [];
  }

  /**
   * 根據網址查詢已開啟分頁 (無匹配則回傳 null)
   */
  async findTabByUrl(url) {
    if (!url) return null;
    const tabs = await this.findTabs({ url });
    if (tabs && tabs.length > 0) {
      const exact = tabs.find(t => t.url === url);
      return exact || tabs[0];
    }
    // 若特定 URL 查詢未命中， fallback 檢查所有分頁
    const allTabs = await this.findTabs();
    return allTabs.find(t => t.url === url) || null;
  }

  /**
   * 在目標分頁執行腳本或函式
   */
  async executeScript({ target = {}, func, args = [] } = {}) {
    if (typeof this.adapter.executeScript === 'function') {
      return await this.adapter.executeScript({ target, func, args });
    }
    return null;
  }

  /**
   * 顯示保存成功回饋 (Badge 與 Toast)
   */
  async showSaveFeedback(tab, options = {}) {
    if (typeof this.adapter.showSaveFeedback === 'function') {
      return await this.adapter.showSaveFeedback(tab, options);
    }
    return false;
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
    if (typeof this.adapter.downloadJson === 'function') {
      return await this.adapter.downloadJson(data, filename);
    }
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
