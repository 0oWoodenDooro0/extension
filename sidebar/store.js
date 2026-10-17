// store.js - 深度資料模組 (Deep Collection Module)
// 封裝所有項目 CRUD、標籤串聯異動、項目去重、ID/時間戳生成與儲存持久化、以及側邊欄 Active Filter 狀態

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

    // 內部過濾狀態 (封裝於 Store 中，避免散落於 View 元件)
    this._filterState = {
      activeTags: [], // 空陣列表示 "All Items"
      activeActors: [],
      pendingActorInput: '',
      searchQuery: ''
    };

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
  queryItems({
    tags = null,
    untagged = false,
    actor = null,
    actors = null,
    search = '',
    sortBy = 'addDate',
    sortOrder = 'desc'
  } = {}) {
    let results = [...this.items];

    // 1. 標籤過濾 (支援多標籤交集 或 UNTAGGED_TAG)
    if (untagged) {
      results = results.filter(item => !item.tags || item.tags.length === 0);
    } else if (Array.isArray(tags) && tags.length > 0) {
      if (tags.includes(UNTAGGED_TAG)) {
        results = results.filter(item => !item.tags || item.tags.length === 0);
      } else {
        // 多標籤交集 (Intersection): 必須包含 tags 清單中的所有指定標籤
        results = results.filter(item => {
          if (!Array.isArray(item.tags)) return false;
          return tags.every(reqTag => item.tags.includes(reqTag));
        });
      }
    }

    // 2. 演員比對 (支援單一演員 actor 或多演員交集 actors)
    const requiredActors = [];
    if (actor && actor.trim()) {
      requiredActors.push(actor.trim().toLowerCase());
    }
    if (Array.isArray(actors)) {
      actors.forEach(a => {
        if (a && typeof a === 'string' && a.trim()) {
          const lower = a.trim().toLowerCase();
          if (!requiredActors.includes(lower)) {
            requiredActors.push(lower);
          }
        }
      });
    }

    if (requiredActors.length > 0) {
      results = results.filter(item => {
        if (!Array.isArray(item.actors) || item.actors.length === 0) return false;
        const itemActorsLower = item.actors.map(a => (a || '').toLowerCase());
        // 必須滿足所有指定的演員 (支援不區分大小寫之子字串比對)
        return requiredActors.every(req =>
          itemActorsLower.some(act => act.includes(req))
        );
      });
    }

    // 3. 全文模糊搜尋 (比對 title, url, 以及 actors)
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      results = results.filter(item => {
        const titleMatch = item.title && item.title.toLowerCase().includes(searchLower);
        const urlMatch = item.url && item.url.toLowerCase().includes(searchLower);
        const actorMatch = Array.isArray(item.actors) && item.actors.some(a => a && a.toLowerCase().includes(searchLower));
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

  // --- Active Filter State 管理介面 (Deep Module) ---

  getActiveTags() {
    return [...this._filterState.activeTags];
  }

  getActiveActorFilters() {
    return [...this._filterState.activeActors];
  }

  getSearchQuery() {
    return this._filterState.searchQuery;
  }

  getPendingActorInput() {
    return this._filterState.pendingActorInput;
  }

  isTagActive(tag) {
    if (tag === 'All Items') {
      return this._filterState.activeTags.length === 0;
    }
    return this._filterState.activeTags.includes(tag);
  }

  toggleTagFilter(tag) {
    if (!tag || tag === 'All Items') {
      this._filterState.activeTags = [];
      return;
    }

    if (tag === UNTAGGED_TAG) {
      if (this._filterState.activeTags.includes(UNTAGGED_TAG)) {
        this._filterState.activeTags = [];
      } else {
        this._filterState.activeTags = [UNTAGGED_TAG];
      }
      return;
    }

    // 一般標籤：若先前有 UNTAGGED_TAG 則清除
    let currentTags = this._filterState.activeTags.filter(t => t !== UNTAGGED_TAG);
    const index = currentTags.indexOf(tag);
    if (index > -1) {
      currentTags.splice(index, 1);
    } else {
      currentTags.push(tag);
    }
    this._filterState.activeTags = currentTags;
  }

  setAllItemsFilter() {
    this._filterState.activeTags = [];
  }

  resetTagFilters() {
    this._filterState.activeTags = [];
  }

  addActorFilter(actorInput) {
    if (!actorInput) return;
    const items = Array.isArray(actorInput) ? actorInput : actorInput.split(',');
    items.forEach(raw => {
      const trimmed = (raw || '').trim();
      if (trimmed && !this._filterState.activeActors.includes(trimmed)) {
        this._filterState.activeActors.push(trimmed);
      }
    });
  }

  removeActorFilter(actor) {
    if (!actor) return;
    const clean = actor.trim();
    this._filterState.activeActors = this._filterState.activeActors.filter(a => a !== clean);
  }

  clearActorFilters() {
    this._filterState.activeActors = [];
    this._filterState.pendingActorInput = '';
  }

  setPendingActorInput(input) {
    this._filterState.pendingActorInput = (input || '').trim();
  }

  setSearchQuery(query) {
    this._filterState.searchQuery = (query || '').trim();
  }

  resetFilters() {
    this._filterState.activeTags = [];
    this._filterState.activeActors = [];
    this._filterState.pendingActorInput = '';
    this._filterState.searchQuery = '';
  }

  getFilteredItems(options = {}) {
    const queryOpts = { ...options };

    if (this._filterState.activeTags.length > 0) {
      if (this._filterState.activeTags.includes(UNTAGGED_TAG)) {
        queryOpts.untagged = true;
      } else {
        queryOpts.tags = [...this._filterState.activeTags];
      }
    }

    const actors = [...this._filterState.activeActors];
    if (this._filterState.pendingActorInput) {
      actors.push(this._filterState.pendingActorInput);
    }
    if (actors.length > 0) {
      queryOpts.actors = actors;
    }

    if (this._filterState.searchQuery) {
      queryOpts.search = this._filterState.searchQuery;
    }

    return this.queryItems(queryOpts);
  }

  getRandomFilteredItem(options = {}) {
    const matched = this.getFilteredItems(options);
    if (!matched || matched.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * matched.length);
    return matched[randomIndex];
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
      targetItem = this.items.find(i => i.url === cleanUrl);
    }

    if (targetItem) {
      targetItem.title = cleanTitle;
      targetItem.url = cleanUrl;
      targetItem.tags = cleanTags;
      targetItem.actors = cleanActors;
      if (cleanImageUrl) {
        targetItem.imageUrl = cleanImageUrl;
      }
      targetItem.updatedAt = now;
    } else {
      targetItem = {
        id: id || generateUniqueId(),
        title: cleanTitle,
        url: cleanUrl,
        imageUrl: cleanImageUrl,
        tags: cleanTags,
        actors: cleanActors,
        addDate: now,
        updatedAt: now
      };
      this.items.push(targetItem);
    }

    await this.persist();
    this.notify({ type: 'itemSaved', item: targetItem });
    return targetItem;
  }

  /**
   * 刪除指定 ID 之項目
   */
  async deleteItem(id) {
    const prevCount = this.items.length;
    this.items = this.items.filter(i => i.id !== id);
    if (this.items.length !== prevCount) {
      await this.persist();
      this.notify({ type: 'itemDeleted', id });
      return true;
    }
    return false;
  }

  // --- 標籤異動介面 (Tag Mutation Interface) ---

  /**
   * 新增標籤 (去重、濾除空白)
   */
  async addTag(tagName) {
    const clean = tagName ? tagName.trim() : '';
    if (!clean || this.tags.includes(clean)) {
      return false;
    }
    this.tags.push(clean);
    await this.persist();
    this.notify({ type: 'tagAdded', tag: clean });
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

    // 3. 串聯更新 Active Filter 狀態
    if (this._filterState.activeTags.includes(cleanOld)) {
      this._filterState.activeTags = this._filterState.activeTags.map(t => (t === cleanOld ? cleanNew : t));
    }

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

    // 3. 串聯從 Active Filter 狀態中移除
    if (this._filterState.activeTags.includes(cleanName)) {
      this._filterState.activeTags = this._filterState.activeTags.filter(t => t !== cleanName);
    }

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
