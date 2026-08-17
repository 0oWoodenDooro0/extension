// searchEngineStore.js - 快捷搜尋深層模組 (Deep Search Engine Module)
// 封裝搜尋引擎項目的 CRUD、儲存適配器、正規表達式解析替換、URL 模板編譯與跨視窗狀態同步

let engineIdCounter = 0;
function generateEngineId() {
  engineIdCounter = (engineIdCounter + 1) % 100000;
  return `engine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${engineIdCounter}`;
}

/**
 * 記憶體儲存適配器 (適用於測試環境與非瀏覽器環境)
 */
export class MemoryStorageAdapter {
  constructor(initialData = {}) {
    this.data = {
      searchEngines: initialData.searchEngines ? JSON.parse(JSON.stringify(initialData.searchEngines)) : []
    };
    this.listeners = [];
  }

  async get(keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const result = {};
    keyList.forEach(key => {
      if (this.data[key] !== undefined) {
        result[key] = JSON.parse(JSON.stringify(this.data[key]));
      }
    });
    return result;
  }

  async set(itemsObject) {
    const changes = {};
    for (const [key, val] of Object.entries(itemsObject)) {
      const oldVal = this.data[key];
      this.data[key] = JSON.parse(JSON.stringify(val));
      changes[key] = { oldValue: oldVal, newValue: this.data[key] };
    }
    this.listeners.forEach(fn => fn(changes, 'local'));
  }

  onChanged(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }
}

/**
 * 瀏覽器 Chrome Storage 適配器
 */
export class ChromeStorageAdapter {
  async get(keys) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return resolve({});
      }
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  }

  async set(itemsObject) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return resolve();
      }
      chrome.storage.local.set(itemsObject, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  onChanged(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      const listener = (changes, area) => {
        if (area === 'local') {
          callback(changes, area);
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
    return () => {};
  }
}

/**
 * SearchEngineStore 深度模組
 */
export class SearchEngineStore {
  constructor(storageAdapter = null) {
    this.adapter = storageAdapter || (typeof chrome !== 'undefined' && chrome.storage ? new ChromeStorageAdapter() : new MemoryStorageAdapter());
    this.engines = [];
    this.subscribers = new Set();
    this.isLoaded = false;
    this.isPersisting = false;

    // 監聽外部/多視窗同步
    this.unsubscribeStorage = this.adapter.onChanged((changes) => {
      if (this.isPersisting) return;
      if (changes.searchEngines && changes.searchEngines.newValue) {
        this.engines = changes.searchEngines.newValue;
        this.notify({ type: 'sync', source: 'external' });
      }
    });
  }

  /**
   * 載入儲存資料
   */
  async load() {
    try {
      const data = await this.adapter.get('searchEngines');
      this.engines = Array.isArray(data.searchEngines) ? data.searchEngines : [];
      this.isLoaded = true;
      return { searchEngines: this.engines };
    } catch (err) {
      console.error('[SearchEngineStore] Failed to load data:', err);
      this.engines = [];
      this.isLoaded = true;
      return { searchEngines: [] };
    }
  }

  /**
   * 持久化資料到適配器
   */
  async persist() {
    this.isPersisting = true;
    try {
      await this.adapter.set({
        searchEngines: this.engines
      });
    } finally {
      this.isPersisting = false;
    }
  }

  /**
   * 訂閱狀態變更通知
   */
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * 觸發訂閱者通知
   */
  notify(event) {
    this.subscribers.forEach(fn => {
      try {
        fn(event);
      } catch (err) {
        console.error('[SearchEngineStore] Error in subscriber callback:', err);
      }
    });
  }

  // --- 查詢介面 (Query Interface) ---

  getEngines() {
    return [...this.engines];
  }

  getEngineById(id) {
    return this.engines.find(e => e.id === id) || null;
  }

  // --- 項目異動介面 (Mutation Interface) ---

  /**
   * 新增或更新搜尋引擎
   */
  async saveEngine({ id, title, urlTemplate, queryRegex, queryReplacement }) {
    if (!title || !title.trim()) {
      throw new Error('Engine title is required.');
    }
    if (!urlTemplate || !urlTemplate.trim()) {
      throw new Error('Engine urlTemplate is required.');
    }

    const cleanTitle = title.trim();
    const cleanUrl = urlTemplate.trim();
    const cleanRegex = queryRegex && queryRegex.trim() ? queryRegex.trim() : null;
    const cleanReplacement = queryReplacement && queryReplacement.trim() ? queryReplacement.trim() : null;

    let targetEngine = null;
    if (id) {
      targetEngine = this.engines.find(e => e.id === id);
    }

    if (targetEngine) {
      targetEngine.title = cleanTitle;
      targetEngine.urlTemplate = cleanUrl;
      targetEngine.queryRegex = cleanRegex;
      targetEngine.queryReplacement = cleanReplacement;
    } else {
      targetEngine = {
        id: id || generateEngineId(),
        title: cleanTitle,
        urlTemplate: cleanUrl,
        queryRegex: cleanRegex,
        queryReplacement: cleanReplacement
      };
      this.engines.push(targetEngine);
    }

    await this.persist();
    this.notify({ type: 'engineSaved', engine: targetEngine });
    return targetEngine;
  }

  /**
   * 刪除搜尋引擎
   */
  async deleteEngine(id) {
    const index = this.engines.findIndex(e => e.id === id);
    if (index === -1) return false;

    this.engines.splice(index, 1);
    await this.persist();
    this.notify({ type: 'engineDeleted', id });
    return true;
  }

  // --- 正規表達式與 URL 編譯介面 (Format & URL Interface) ---

  /**
   * 根據正規表達式與替換規則格式化查詢字串
   */
  formatQuery(query, engineOrId) {
    if (!query) return '';
    const engine = typeof engineOrId === 'string' ? this.getEngineById(engineOrId) : engineOrId;
    if (!engine || !engine.queryRegex || !engine.queryReplacement) {
      return query;
    }

    try {
      const regex = new RegExp(engine.queryRegex);
      const match = query.match(regex);
      if (match) {
        return match[0].replace(regex, engine.queryReplacement);
      }
      return query;
    } catch (error) {
      console.error(`[SearchEngineStore.formatQuery] Regex error:`, error);
      return query;
    }
  }

  /**
   * 編譯搜尋目標 URL (自動處理正規表達式轉換與 URI 編碼)
   */
  buildSearchUrl(query, engineOrId) {
    const engine = typeof engineOrId === 'string' ? this.getEngineById(engineOrId) : engineOrId;
    if (!engine || !engine.urlTemplate) {
      return '';
    }

    const trimmed = (query || '').trim();
    const processedQuery = this.formatQuery(trimmed, engine);
    const encoded = encodeURIComponent(processedQuery);

    return engine.urlTemplate
      .replace(/\{id\}/g, encoded)
      .replace(/\{query\}/g, encoded);
  }

  // --- 資料匯出入 (Portability) ---

  exportData() {
    return {
      searchEngines: JSON.parse(JSON.stringify(this.engines))
    };
  }

  async importData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.searchEngines)) {
      return false;
    }

    this.engines = data.searchEngines;
    await this.persist();
    this.notify({ type: 'imported' });
    return true;
  }
}

// 預設全域 Singleton 實例
export const searchEngineStore = new SearchEngineStore();
