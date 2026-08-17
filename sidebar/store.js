// store.js - 深度資料模組 (Deep Collection Module)
// 封裝所有項目 CRUD、標籤串聯異動、項目去重、ID/時間戳生成與儲存持久化

export const UNTAGGED_TAG = '_UNTAGGED_';

let idCounter = 0;
function generateUniqueId() {
  idCounter = (idCounter + 1) % 100000;
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${idCounter}`;
}

/**
 * 記憶體儲存適配器 (適用於測試環境與無瀏覽器運行環境)
 */
export class MemoryStorageAdapter {
  constructor(initialData = {}) {
    this.data = {
      items: initialData.items ? JSON.parse(JSON.stringify(initialData.items)) : [],
      tags: initialData.tags ? JSON.parse(JSON.stringify(initialData.tags)) : []
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
 * CollectionStore 深度模組
 */
export class CollectionStore {
  constructor(storageAdapter = null) {
    this.adapter = storageAdapter || (typeof chrome !== 'undefined' && chrome.storage ? new ChromeStorageAdapter() : new MemoryStorageAdapter());
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
   * 新增或更新項目 (自動處理 ID 生成、addDate 時間戳、去重與持久化)
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
    } else {
      // 建立全新項目
      targetItem = {
        id: id || generateUniqueId(),
        title: cleanTitle,
        url: cleanUrl,
        tags: cleanTags,
        addDate: Date.now(),
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
    this.items.forEach(item => {
      if (Array.isArray(item.tags) && item.tags.includes(cleanOld)) {
        item.tags = item.tags.map(t => (t === cleanOld ? cleanNew : t));
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
    this.items.forEach(item => {
      if (Array.isArray(item.tags)) {
        item.tags = item.tags.filter(t => t !== cleanName);
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

    this.items = data.items;
    this.tags = data.tags;
    await this.persist();
    this.notify({ type: 'imported' });
    return true;
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
