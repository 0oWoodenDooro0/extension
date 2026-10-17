// store.js - 深度資料模組 (Deep Collection Module)
// 封裝所有項目 CRUD、標籤串聯異動、項目去重、ID/時間戳生成、統一儲存適配器與快照匯出/還原

export const UNTAGGED_TAG = '_UNTAGGED_';

let idCounter = 0;
function generateUniqueId() {
  idCounter = (idCounter + 1) % 100000;
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${idCounter}`;
}

/**
 * 記憶體儲存適配器 (適用於測試環境與無瀏覽器運行環境)
 * 支援所有鍵值 (items, tags, searchEngines, 以及自訂同步狀態)
 */
export class MemoryStorageAdapter {
  constructor(initialData = {}) {
    this.data = JSON.parse(JSON.stringify(initialData || {}));
    if (!this.data.items) this.data.items = [];
    if (!this.data.tags) this.data.tags = [];
    if (!this.data.searchEngines) this.data.searchEngines = [];
    this.listeners = [];
  }

  async get(keys) {
    if (keys === null || keys === undefined) {
      return JSON.parse(JSON.stringify(this.data));
    }
    if (typeof keys === 'string') {
      const result = {};
      if (this.data[keys] !== undefined) {
        result[keys] = JSON.parse(JSON.stringify(this.data[keys]));
      }
      return result;
    }
    if (Array.isArray(keys)) {
      const result = {};
      keys.forEach(key => {
        if (this.data[key] !== undefined) {
          result[key] = JSON.parse(JSON.stringify(this.data[key]));
        }
      });
      return result;
    }
    if (typeof keys === 'object') {
      const result = {};
      for (const [key, defaultVal] of Object.entries(keys)) {
        result[key] = this.data[key] !== undefined
          ? JSON.parse(JSON.stringify(this.data[key]))
          : defaultVal;
      }
      return result;
    }
    return {};
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

  async remove(keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    for (const key of keyList) {
      if (this.data[key] !== undefined) {
        changes[key] = { oldValue: this.data[key], newValue: undefined };
        delete this.data[key];
      }
    }
    this.listeners.forEach(fn => fn(changes, 'local'));
  }

  async clear() {
    const changes = {};
    for (const [key, val] of Object.entries(this.data)) {
      changes[key] = { oldValue: val, newValue: undefined };
    }
    this.data = { items: [], tags: [], searchEngines: [] };
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

  async remove(keys) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return resolve();
      }
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async clear() {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return resolve();
      }
      chrome.storage.local.clear(() => {
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
 * CollectionStore 深度模組
 */
export class CollectionStore {
  constructor(storageAdapter = null, { searchEngineStore = null } = {}) {
    this.adapter = storageAdapter || (typeof chrome !== 'undefined' && chrome.storage ? new ChromeStorageAdapter() : new MemoryStorageAdapter());
    this.searchEngineStore = searchEngineStore;
    this.items = [];
    this.tags = [];
    this.subscribers = new Set();
    this.isLoaded = false;
    this.isPersisting = false;

    // 監聽外部/多視窗同步
    this.unsubscribeStorage = this.adapter.onChanged((changes) => {
      if (this.isPersisting) return;
      let changed = false;
      if (changes.items && changes.items.newValue) {
        this.items = changes.items.newValue;
        changed = true;
      }
      if (changes.tags && changes.tags.newValue) {
        this.tags = changes.tags.newValue;
        changed = true;
      }
      if (changed) {
        this.notify({ type: 'sync', source: 'external' });
      }
    });
  }

  /**
   * 載入儲存資料
   */
  async load() {
    try {
      const data = await this.adapter.get(['items', 'tags']);
      this.items = Array.isArray(data.items) ? data.items : [];
      this.tags = Array.isArray(data.tags) ? data.tags : [];
      this.isLoaded = true;
      return { items: this.items, tags: this.tags };
    } catch (err) {
      console.error('[CollectionStore] Failed to load data:', err);
      this.items = [];
      this.tags = [];
      this.isLoaded = true;
      return { items: [], tags: [] };
    }
  }

  /**
   * 持久化資料到適配器
   */
  async persist() {
    this.isPersisting = true;
    try {
      await this.adapter.set({
        items: this.items,
        tags: this.tags
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
        console.error('[CollectionStore] Error in subscriber callback:', err);
      }
    });
  }

  // --- 查詢介面 (Query Interface) ---

  getItems() {
    return [...this.items];
  }

  getTags() {
    return [...this.tags];
  }

  getItemById(id) {
    return this.items.find(i => i.id === id);
  }

  getItemByUrl(url) {
    return this.items.find(i => i.url === url);
  }

  getAllActors() {
    const actorSet = new Set();
    this.items.forEach(item => {
      if (Array.isArray(item.actors)) {
        item.actors.forEach(actor => {
          if (actor && actor.trim()) {
            actorSet.add(actor.trim());
          }
        });
      }
    });
    return Array.from(actorSet).sort();
  }

  /**
   * 多維度查詢與過濾項目 (支援標籤交集、未分類、演員比對、全文模糊搜尋與排序)
   */
  queryItems(options = {}) {
    const {
      tags = [],
      untagged = false,
      actor = '',
      actors = [],
      search = '',
      sortBy = 'addDate',
      sortOrder = 'desc'
    } = options;

    let results = [...this.items];

    // 1. 標籤與未分類過濾 (Tag & Untagged Scope)
    const isUntaggedRequested = untagged || (Array.isArray(tags) && tags.includes(UNTAGGED_TAG));

    if (isUntaggedRequested) {
      results = results.filter(item => !item.tags || item.tags.length === 0);
    } else if (Array.isArray(tags) && tags.length > 0) {
      const activeTags = tags.filter(t => t && t !== UNTAGGED_TAG);
      if (activeTags.length > 0) {
        results = results.filter(item =>
          Array.isArray(item.tags) && activeTags.every(t => item.tags.includes(t))
        );
      }
    }

    // 2. 演員過濾 (Actor Substring Match & Multi-actor intersection)
    let filterActors = [];
    if (Array.isArray(actors)) {
      filterActors = actors.map(a => (a ? String(a).trim().toLowerCase() : '')).filter(Boolean);
    }
    if (actor && typeof actor === 'string') {
      const cleanSingle = actor.trim().toLowerCase();
      if (cleanSingle && !filterActors.includes(cleanSingle)) {
        filterActors.push(cleanSingle);
      }
    }

    if (filterActors.length > 0) {
      results = results.filter(item => {
        const itemActors = Array.isArray(item.actors) ? item.actors : [];
        return filterActors.every(target =>
          itemActors.some(a => (a || '').toLowerCase().includes(target))
        );
      });
    }

    // 3. 全文搜尋 (Search across title, url, actors)
    const cleanSearch = (search || '').trim().toLowerCase();
    if (cleanSearch) {
      results = results.filter(item => {
        const titleMatch = item.title && item.title.toLowerCase().includes(cleanSearch);
        const urlMatch = item.url && item.url.toLowerCase().includes(cleanSearch);
        const actors = Array.isArray(item.actors) ? item.actors : [];
        const actorMatch = actors.some(a => (a || '').toLowerCase().includes(cleanSearch));
        return titleMatch || urlMatch || actorMatch;
      });
    }

    // 4. 排序 (Sorting)
    results.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === 'addDate') {
        valA = valA || 0;
        valB = valB || 0;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return results;
  }

  /**
   * 根據查詢條件隨機取得一個項目 (無匹配項目時回傳 null)
   */
  getRandomItem(options = {}) {
    const matchedItems = this.queryItems(options);
    if (matchedItems.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * matchedItems.length);
    return matchedItems[randomIndex];
  }

  // --- 項目異動介面 (Item Mutation Interface) ---

  /**
   * 新增或更新項目 (自動處理 ID 生成、addDate/updatedAt 時間戳、去重與持久化)
   */
  async saveItem({ id, title, url, tags = [], imageUrl = null, actors = [] }) {
    if (!title || !url) {
      throw new Error('Item title and url are required.');
    }

    const cleanTitle = title.trim();
    const cleanUrl = url.trim();
    const cleanTags = Array.isArray(tags) ? [...tags] : [];
    const cleanActors = Array.isArray(actors) ? actors.map(a => a.trim()).filter(Boolean) : [];
    const cleanImageUrl = imageUrl ? imageUrl.trim() : null;
    const now = Date.now();

    let targetItem = null;
    if (id) {
      targetItem = this.items.find(i => i.id === id);
    } else {
      // 依據 URL 檢查是否已存在
      targetItem = this.items.find(i => i.url === cleanUrl);
    }

    if (targetItem) {
      // 編輯更新現有項目
      targetItem.title = cleanTitle;
      targetItem.url = cleanUrl;
      targetItem.tags = cleanTags;
      targetItem.imageUrl = cleanImageUrl;
      targetItem.actors = cleanActors;
      targetItem.updatedAt = now;
    } else {
      // 建立全新項目
      targetItem = {
        id: id || generateUniqueId(),
        title: cleanTitle,
        url: cleanUrl,
        tags: cleanTags,
        addDate: now,
        updatedAt: now,
        imageUrl: cleanImageUrl,
        actors: cleanActors
      };
      this.items.push(targetItem);
    }

    await this.persist();
    this.notify({ type: 'itemSaved', item: targetItem });
    return targetItem;
  }

  /**
   * 刪除項目
   */
  async deleteItem(id) {
    const index = this.items.findIndex(i => i.id === id);
    if (index === -1) return false;

    const [deletedItem] = this.items.splice(index, 1);
    await this.persist();
    this.notify({ type: 'itemDeleted', item: deletedItem });
    return true;
  }

  // --- 標籤管理與串聯異動 (Tag Operations & Cascades) ---

  /**
   * 新增標籤
   */
  async addTag(tagName) {
    const cleanName = tagName ? tagName.trim() : '';
    if (!cleanName || this.tags.includes(cleanName)) {
      return false;
    }
    this.tags.push(cleanName);
    await this.persist();
    this.notify({ type: 'tagAdded', tag: cleanName });
    return true;
  }

  /**
   * 重新命名標籤 (自動串聯更新所有包含此標籤的項目)
   */
  async renameTag(oldName, newName) {
    const cleanOld = oldName ? oldName.trim() : '';
    const cleanNew = newName ? newName.trim() : '';

    if (!cleanOld || !cleanNew || cleanOld === cleanNew) return false;
    if (this.tags.includes(cleanNew)) return false; // 防止撞名

    const tagIndex = this.tags.indexOf(cleanOld);
    if (tagIndex === -1) return false;

    // 1. 更新標籤陣列
    this.tags[tagIndex] = cleanNew;

    // 2. 串聯更新所有項目
    const now = Date.now();
    this.items.forEach(item => {
      if (Array.isArray(item.tags) && item.tags.includes(cleanOld)) {
        item.tags = item.tags.map(t => (t === cleanOld ? cleanNew : t));
        item.updatedAt = now;
      }
    });

    await this.persist();
    this.notify({ type: 'tagRenamed', oldTag: cleanOld, newTag: cleanNew });
    return true;
  }

  /**
   * 刪除標籤 (自動從所有項目中移除此標籤)
   */
  async deleteTag(tagName) {
    const cleanName = tagName ? tagName.trim() : '';
    if (!cleanName || !this.tags.includes(cleanName)) return false;

    // 1. 從標籤陣列中移除
    this.tags = this.tags.filter(t => t !== cleanName);

    // 2. 串聯從所有項目中移除
    const now = Date.now();
    this.items.forEach(item => {
      if (Array.isArray(item.tags)) {
        item.tags = item.tags.filter(t => t !== cleanName);
        item.updatedAt = now;
      }
    });

    await this.persist();
    this.notify({ type: 'tagDeleted', tag: cleanName });
    return true;
  }

  /**
   * 標籤排序 (Drag & Drop)
   */
  async reorderTags(fromIndex, toIndex) {
    if (
      fromIndex < 0 ||
      fromIndex >= this.tags.length ||
      toIndex < 0 ||
      toIndex >= this.tags.length ||
      fromIndex === toIndex
    ) {
      return false;
    }

    const [movedTag] = this.tags.splice(fromIndex, 1);
    this.tags.splice(toIndex, 0, movedTag);

    await this.persist();
    this.notify({ type: 'tagsReordered' });
    return true;
  }

  // --- 資料匯出入 (Portability) ---

  exportData() {
    return {
      items: JSON.parse(JSON.stringify(this.items)),
      tags: JSON.parse(JSON.stringify(this.tags))
    };
  }

  async importData(data) {
    if (
      !data ||
      typeof data !== 'object' ||
      !Array.isArray(data.items) ||
      !Array.isArray(data.tags)
    ) {
      return false;
    }

    this.items = JSON.parse(JSON.stringify(data.items));
    this.tags = JSON.parse(JSON.stringify(data.tags));
    await this.persist();
    this.notify({ type: 'imported' });
    return true;
  }

  // --- 統一快照與備份管理 (Unified Snapshot & Backup Management) ---

  /**
   * 靜態方法：驗證快照結構並回傳結構摘要
   */
  static validateSnapshot(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        valid: false,
        error: 'Invalid backup format: payload must be a non-null object.',
        hasItems: false,
        hasTags: false,
        hasSearchEngines: false,
        counts: { items: 0, tags: 0, searchEngines: 0 }
      };
    }

    if (!Array.isArray(payload.items)) {
      return {
        valid: false,
        error: 'Invalid backup format: items must be an array.',
        hasItems: false,
        hasTags: false,
        hasSearchEngines: false,
        counts: { items: 0, tags: 0, searchEngines: 0 }
      };
    }

    if (!Array.isArray(payload.tags)) {
      return {
        valid: false,
        error: 'Invalid backup format: tags must be an array.',
        hasItems: true,
        hasTags: false,
        hasSearchEngines: false,
        counts: { items: payload.items.length, tags: 0, searchEngines: 0 }
      };
    }

    if (payload.searchEngines !== undefined && !Array.isArray(payload.searchEngines)) {
      return {
        valid: false,
        error: 'Invalid backup format: searchEngines must be an array when present.',
        hasItems: true,
        hasTags: true,
        hasSearchEngines: false,
        counts: { items: payload.items.length, tags: payload.tags.length, searchEngines: 0 }
      };
    }

    const hasSearchEngines = Array.isArray(payload.searchEngines);
    return {
      valid: true,
      error: null,
      hasItems: true,
      hasTags: true,
      hasSearchEngines,
      counts: {
        items: payload.items.length,
        tags: payload.tags.length,
        searchEngines: hasSearchEngines ? payload.searchEngines.length : 0
      }
    };
  }

  /**
   * 實例方法轉發至靜態 validateSnapshot
   */
  validateSnapshot(payload) {
    return CollectionStore.validateSnapshot(payload);
  }

  /**
   * 統一快照匯出 (Unified Snapshot Export)
   * 強制從底層 Storage 重新載入最新狀態，防止多執行環境 (Multi-context) 快取覆蓋
   */
  async exportSnapshot(searchEngineStore = this.searchEngineStore) {
    await this.load();
    if (searchEngineStore && typeof searchEngineStore.load === 'function') {
      await searchEngineStore.load();
    }

    let searchEngines = [];
    if (searchEngineStore) {
      if (typeof searchEngineStore.getEngines === 'function') {
        searchEngines = searchEngineStore.getEngines();
      } else if (typeof searchEngineStore.exportData === 'function') {
        searchEngines = searchEngineStore.exportData().searchEngines || [];
      }
    } else {
      const data = await this.adapter.get('searchEngines');
      if (Array.isArray(data.searchEngines)) {
        searchEngines = data.searchEngines;
      }
    }

    return {
      version: 1,
      timestamp: Date.now(),
      items: JSON.parse(JSON.stringify(this.items || [])),
      tags: JSON.parse(JSON.stringify(this.tags || [])),
      searchEngines: JSON.parse(JSON.stringify(searchEngines || []))
    };
  }

  /**
   * 統一快照還原 (Unified Snapshot Restore)
   * 原子性校驗並還原 items, tags 與 searchEngines，相容未包含 searchEngines 的舊版快照
   */
  async restoreSnapshot(payload, { searchEngineStore = this.searchEngineStore } = {}) {
    const validation = CollectionStore.validateSnapshot(payload);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 確保最新狀態
    await this.load();
    if (searchEngineStore && typeof searchEngineStore.load === 'function') {
      await searchEngineStore.load();
    }

    const collSuccess = await this.importData(payload);
    if (!collSuccess) {
      return { success: false, error: 'Failed to import collections into collection store.' };
    }

    let searchEnginesCount = null;
    if (Array.isArray(payload.searchEngines)) {
      if (searchEngineStore && typeof searchEngineStore.importData === 'function') {
        const seSuccess = await searchEngineStore.importData(payload);
        if (!seSuccess) {
          return { success: false, error: 'Failed to import search engines into search engine store.' };
        }
      } else {
        await this.adapter.set({ searchEngines: JSON.parse(JSON.stringify(payload.searchEngines)) });
      }
      searchEnginesCount = payload.searchEngines.length;
    }

    return {
      success: true,
      restored: {
        itemsCount: payload.items.length,
        tagsCount: payload.tags.length,
        searchEnginesCount
      }
    };
  }

  /**
   * 匯出備份檔案並透過 tabAdapter 下載
   */
  async exportBackupFile(tabAdapter, { filename = null, searchEngineStore = this.searchEngineStore } = {}) {
    const backupData = await this.exportSnapshot(searchEngineStore);
    const todayStr = new Date().toISOString().split('T')[0];
    const finalFilename = filename || `collection_backup_${todayStr}.json`;

    if (tabAdapter && typeof tabAdapter.downloadJson === 'function') {
      await tabAdapter.downloadJson(backupData, finalFilename);
    }

    return {
      success: true,
      filename: finalFilename,
      data: backupData
    };
  }
}

// 預設全域 Singleton 實例
export const collectionStore = new CollectionStore();

// 向後相容 state 物件 (Getter 代理，確保現有程式碼過渡平滑)
export const state = {
  get items() {
    return collectionStore.items;
  },
  set items(val) {
    collectionStore.items = val;
  },
  get tags() {
    return collectionStore.tags;
  },
  set tags(val) {
    collectionStore.tags = val;
  }
};

// 向後相容匯出函式
export function loadData() {
  return collectionStore.load();
}

export function saveData() {
  return collectionStore.persist();
}
