// syncCoordinator.js - 雲端多裝置同步協調器 (Cloud Sync Coordinator)
// 封裝雙向與三向智慧合併 (Smart 3-Way Merge)、基準快照 (Base Snapshot)、防抖自動保存 (Debounced Auto-Sync)、關閉立即 Flush 與自動登入

import { validateBackupPayload, createUnifiedBackup, restoreUnifiedBackup } from './backupCoordinator.js';

export const SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  SUCCESS: 'success',
  ERROR: 'error'
};

function arraysEqual(arr1, arr2) {
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) return arr1 === arr2;
  if (arr1.length !== arr2.length) return false;
  const s1 = [...arr1].sort();
  const s2 = [...arr2].sort();
  return s1.every((val, idx) => val === s2[idx]);
}

export function isItemContentEqual(a, b) {
  if (!a || !b) return a === b;
  if (a.title !== b.title) return false;
  if (a.url !== b.url) return false;
  if ((a.imageUrl || null) !== (b.imageUrl || null)) return false;
  if (!arraysEqual(a.tags, b.tags)) return false;
  if (!arraysEqual(a.actors, b.actors)) return false;
  return true;
}

export function isEngineContentEqual(a, b) {
  if (!a || !b) return a === b;
  if (a.title !== b.title) return false;
  if (a.urlTemplate !== b.urlTemplate) return false;
  if ((a.queryRegex || null) !== (b.queryRegex || null)) return false;
  if ((a.queryReplacement || null) !== (b.queryReplacement || null)) return false;
  return true;
}

export function isEntityModified(entity, baseEntity, getTimestamp, isContentEqual) {
  if (!entity && !baseEntity) return false;
  if (!entity || !baseEntity) return true;
  const entityTime = getTimestamp(entity);
  const baseTime = getTimestamp(baseEntity);
  if (entityTime > baseTime) return true;
  return !isContentEqual(entity, baseEntity);
}

export function isItemModified(item, baseItem) {
  return isEntityModified(
    item,
    baseItem,
    (i) => Number(i.updatedAt || i.addDate || 0),
    isItemContentEqual
  );
}

export function isEngineModified(eng, baseEng) {
  return isEntityModified(
    eng,
    baseEng,
    (e) => Number(e.updatedAt || 0),
    isEngineContentEqual
  );
}

/**
 * 通用 2-Way 實體列表合併輔助函式
 */
export function mergeEntityList2Way({
  localList = [],
  cloudList = [],
  getKey = (item) => item.id || item.url,
  getTimestamp = (item) => Number(item.updatedAt || item.addDate || 0)
} = {}) {
  const entityMap = new Map();
  for (const cloudEntity of (cloudList || [])) {
    if (!cloudEntity) continue;
    const key = getKey(cloudEntity);
    if (key) entityMap.set(key, { ...cloudEntity });
  }

  for (const localEntity of (localList || [])) {
    if (!localEntity) continue;
    const key = getKey(localEntity);
    if (!key) continue;
    if (!entityMap.has(key)) {
      entityMap.set(key, { ...localEntity });
    } else {
      const cloudEntity = entityMap.get(key);
      const localTime = getTimestamp(localEntity);
      const cloudTime = getTimestamp(cloudEntity);
      if (localTime >= cloudTime) {
        entityMap.set(key, { ...cloudEntity, ...localEntity });
      }
    }
  }

  return Array.from(entityMap.values());
}

/**
 * 通用 3-Way 實體列表合併輔助函式
 */
export function mergeEntityList3Way({
  localList = [],
  cloudList = [],
  baseList = [],
  getKey = (item) => item.id || item.url,
  getTimestamp = (item) => Number(item.updatedAt || item.addDate || 0),
  isContentEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
} = {}) {
  const localMap = new Map();
  for (const item of (localList || [])) {
    if (!item) continue;
    const key = getKey(item);
    if (key) localMap.set(key, item);
  }

  const cloudMap = new Map();
  for (const item of (cloudList || [])) {
    if (!item) continue;
    const key = getKey(item);
    if (key) cloudMap.set(key, item);
  }

  const baseMap = new Map();
  for (const item of (baseList || [])) {
    if (!item) continue;
    const key = getKey(item);
    if (key) baseMap.set(key, item);
  }

  const allKeys = new Set([...localMap.keys(), ...cloudMap.keys(), ...baseMap.keys()]);
  const merged = [];

  for (const key of allKeys) {
    const localEntity = localMap.get(key);
    const cloudEntity = cloudMap.get(key);
    const baseEntity = baseMap.get(key);

    const inLocal = Boolean(localEntity);
    const inCloud = Boolean(cloudEntity);
    const inBase = Boolean(baseEntity);

    if (inLocal && inCloud && inBase) {
      const localMod = isEntityModified(localEntity, baseEntity, getTimestamp, isContentEqual);
      const cloudMod = isEntityModified(cloudEntity, baseEntity, getTimestamp, isContentEqual);

      if (!localMod && !cloudMod) {
        merged.push({ ...localEntity });
      } else if (localMod && !cloudMod) {
        merged.push({ ...localEntity });
      } else if (!localMod && cloudMod) {
        merged.push({ ...cloudEntity });
      } else {
        const localTime = getTimestamp(localEntity);
        const cloudTime = getTimestamp(cloudEntity);
        if (localTime >= cloudTime) {
          merged.push({ ...cloudEntity, ...localEntity });
        } else {
          merged.push({ ...localEntity, ...cloudEntity });
        }
      }
    } else if (!inLocal && inCloud && inBase) {
      const cloudMod = isEntityModified(cloudEntity, baseEntity, getTimestamp, isContentEqual);
      if (cloudMod) {
        merged.push({ ...cloudEntity });
      }
    } else if (inLocal && !inCloud && inBase) {
      const localMod = isEntityModified(localEntity, baseEntity, getTimestamp, isContentEqual);
      if (localMod) {
        merged.push({ ...localEntity });
      }
    } else if (!inLocal && !inCloud && inBase) {
      // Both deleted
    } else if (inLocal && !inCloud && !inBase) {
      merged.push({ ...localEntity });
    } else if (!inLocal && inCloud && !inBase) {
      merged.push({ ...cloudEntity });
    } else if (inLocal && inCloud && !inBase) {
      const localTime = getTimestamp(localEntity);
      const cloudTime = getTimestamp(cloudEntity);
      if (localTime >= cloudTime) {
        merged.push({ ...cloudEntity, ...localEntity });
      } else {
        merged.push({ ...localEntity, ...cloudEntity });
      }
    }
  }

  return merged;
}

/**
 * 通用實體列表合併入口 (當提供 baseList 時執行 3-Way Merge，否則退回 2-Way Merge)
 */
export function mergeEntityList({
  localList = [],
  cloudList = [],
  baseList = null,
  getKey = (item) => item.id || item.url,
  getTimestamp = (item) => Number(item.updatedAt || item.addDate || 0),
  isEqual = null,
  isContentEqual = null
} = {}) {
  const eqFn = isEqual || isContentEqual || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
  if (Array.isArray(baseList)) {
    return mergeEntityList3Way({
      localList,
      cloudList,
      baseList,
      getKey,
      getTimestamp,
      isContentEqual: eqFn
    });
  }
  return mergeEntityList2Way({
    localList,
    cloudList,
    getKey,
    getTimestamp
  });
}

/**
 * 比對兩份統一備份資料內容是否完全一致 (用於判斷是否有未同步變更)
 */
export function isUnifiedDataEqual(dataA, dataB) {
  if (!dataA || !dataB) return dataA === dataB;

  const itemsA = Array.isArray(dataA.items) ? dataA.items : [];
  const itemsB = Array.isArray(dataB.items) ? dataB.items : [];
  if (itemsA.length !== itemsB.length) return false;

  const tagsA = Array.isArray(dataA.tags) ? dataA.tags : [];
  const tagsB = Array.isArray(dataB.tags) ? dataB.tags : [];
  if (tagsA.length !== tagsB.length || !tagsA.every((t, i) => t === tagsB[i])) return false;

  const enginesA = Array.isArray(dataA.searchEngines) ? dataA.searchEngines : [];
  const enginesB = Array.isArray(dataB.searchEngines) ? dataB.searchEngines : [];
  if (enginesA.length !== enginesB.length) return false;

  const mapBItems = new Map();
  for (const item of itemsB) {
    if (item && (item.id || item.url)) {
      mapBItems.set(item.id || item.url, item);
    }
  }
  for (const itemA of itemsA) {
    const key = itemA && (itemA.id || itemA.url);
    const itemB = mapBItems.get(key);
    if (!itemB || isItemModified(itemA, itemB) || !isItemContentEqual(itemA, itemB)) {
      return false;
    }
  }

  const mapBEngines = new Map();
  for (const eng of enginesB) {
    if (eng && (eng.id || eng.urlTemplate)) {
      mapBEngines.set(eng.id || eng.urlTemplate, eng);
    }
  }
  for (const engA of enginesA) {
    const key = engA && (engA.id || engA.urlTemplate);
    const engB = mapBEngines.get(key);
    if (!engB || isEngineModified(engA, engB) || !isEngineContentEqual(engA, engB)) {
      return false;
    }
  }

  return true;
}

/**
 * 雙向合併 (Smart 2-Way Merge)
 * 用於無基準快照 (首次同步或升級過渡) 時進行聯集保護，防止資料誤刪
 */
export function twoWayMergeUnifiedData(localData, cloudData) {
  const items = mergeEntityList({
    localList: localData?.items || [],
    cloudList: cloudData?.items || [],
    getKey: (item) => item.id || item.url,
    getTimestamp: (item) => Number(item.updatedAt || item.addDate || 0)
  });

  const localTags = Array.isArray(localData?.tags) ? localData.tags : [];
  const cloudTags = Array.isArray(cloudData?.tags) ? cloudData.tags : [];
  const tagSet = new Set(localTags);
  for (const tag of cloudTags) {
    if (tag && typeof tag === 'string') {
      tagSet.add(tag);
    }
  }

  const searchEngines = mergeEntityList({
    localList: localData?.searchEngines || [],
    cloudList: cloudData?.searchEngines || [],
    getKey: (eng) => eng.id || eng.urlTemplate,
    getTimestamp: (eng) => Number(eng.updatedAt || 0)
  });

  return {
    version: 1,
    items,
    tags: Array.from(tagSet),
    searchEngines
  };
}

/**
 * 三向智慧合併 (Smart 3-Way Merge with Deletion & Timestamp Conflict Resolution)
 */
export function threeWayMergeUnifiedData(localData, cloudData, baseData) {
  if (!baseData) {
    return twoWayMergeUnifiedData(localData, cloudData);
  }

  const items = mergeEntityList({
    localList: localData?.items || [],
    cloudList: cloudData?.items || [],
    baseList: baseData?.items || [],
    getKey: (item) => item.id || item.url,
    getTimestamp: (item) => Number(item.updatedAt || item.addDate || 0),
    isEqual: isItemContentEqual
  });

  // Tags 3-way merge
  const localTags = new Set(Array.isArray(localData?.tags) ? localData.tags : []);
  const cloudTags = new Set(Array.isArray(cloudData?.tags) ? cloudData.tags : []);
  const baseTags = new Set(Array.isArray(baseData?.tags) ? baseData.tags : []);
  const allTagKeys = new Set([...localTags, ...cloudTags, ...baseTags]);
  const mergedTags = [];

  for (const tag of allTagKeys) {
    const inLocal = localTags.has(tag);
    const inCloud = cloudTags.has(tag);
    const inBase = baseTags.has(tag);

    if (inLocal && inCloud) {
      mergedTags.push(tag);
    } else if (inLocal && !inCloud) {
      if (!inBase) mergedTags.push(tag);
    } else if (!inLocal && inCloud) {
      if (!inBase) mergedTags.push(tag);
    }
  }

  const searchEngines = mergeEntityList({
    localList: localData?.searchEngines || [],
    cloudList: cloudData?.searchEngines || [],
    baseList: baseData?.searchEngines || [],
    getKey: (eng) => eng.id || eng.urlTemplate,
    getTimestamp: (eng) => Number(eng.updatedAt || 0),
    isEqual: isEngineContentEqual
  });

  return {
    version: 1,
    items,
    tags: mergedTags,
    searchEngines
  };
}

/**
 * 智慧合併統一入口
 * 若有提供 baseData 則採用 Smart 3-Way Merge，否則退回 2-Way Merge
 */
export function mergeUnifiedData(localData, cloudData, baseData = null) {
  if (baseData && typeof baseData === 'object') {
    return threeWayMergeUnifiedData(localData, cloudData, baseData);
  }
  return twoWayMergeUnifiedData(localData, cloudData);
}

/**
 * 收斂跨環境生命週期 (Sidebar / Popup) 與 IPC 綁定
 */
export function bindClientLifecycle({
  portName = 'sidebar-lifecycle',
  coordinator = null,
  runtime = (typeof chrome !== 'undefined' ? chrome.runtime : null),
  windowObj = (typeof window !== 'undefined' ? window : null),
  documentObj = (typeof document !== 'undefined' ? document : null)
} = {}) {
  if (runtime && typeof runtime.connect === 'function') {
    try {
      runtime.connect({ name: portName });
    } catch {
      // ignore
    }
  }

  const handleFlush = () => {
    let sentToRuntime = false;
    if (runtime && typeof runtime.sendMessage === 'function') {
      try {
        runtime.sendMessage({ action: 'flushSync' }, () => {
          if (runtime.lastError && coordinator && typeof coordinator.flushPendingSync === 'function') {
            coordinator.flushPendingSync().catch(() => {});
          }
        });
        sentToRuntime = true;
      } catch {
        // fallback
      }
    }
    if (!sentToRuntime && coordinator && typeof coordinator.flushPendingSync === 'function') {
      coordinator.flushPendingSync().catch(() => {});
    }
  };

  const onVisibilityChange = () => {
    if (documentObj && documentObj.visibilityState === 'hidden') {
      handleFlush();
    }
  };

  if (windowObj && typeof windowObj.addEventListener === 'function') {
    windowObj.addEventListener('pagehide', handleFlush);
  }
  if (documentObj && typeof documentObj.addEventListener === 'function') {
    documentObj.addEventListener('visibilitychange', onVisibilityChange);
  }

  return function unbind() {
    if (windowObj && typeof windowObj.removeEventListener === 'function') {
      windowObj.removeEventListener('pagehide', handleFlush);
    }
    if (documentObj && typeof documentObj.removeEventListener === 'function') {
      documentObj.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

/**
 * 雲端同步管理類別 (SyncCoordinator)
 */
export class SyncCoordinator {
  /**
   * @param {Object} options
   * @param {Object} options.cloudAdapter - 雲端適配器 (實作 findFile, downloadJson, uploadJson, isAuthenticated)
   * @param {Object} options.collectionStore - CollectionStore 實例
   * @param {Object} options.searchEngineStore - SearchEngineStore 實例
   * @param {Object} [options.storage] - 本地儲存 (記錄 last_sync_time, last_sync_base, sync_dirty 等)
   * @param {number} [options.autoSyncDebounceMs=3000] - 自動防抖同步延遲毫秒數
   */
  constructor({
    cloudAdapter,
    collectionStore,
    searchEngineStore,
    storage = null,
    autoSyncDebounceMs = 3000
  } = {}) {
    this.cloudAdapter = cloudAdapter;
    this.collectionStore = collectionStore;
    this.searchEngineStore = searchEngineStore;
    this.storage = storage;
    this.autoSyncDebounceMs = autoSyncDebounceMs;
    this.status = SYNC_STATUS.IDLE;
    this.lastSyncTime = null;
    this.lastError = null;
    this.baseData = null;
    this.isDirty = false;
    this.isApplyingRemoteSync = false;
    this._syncPromise = null;
    this._pendingSyncAfterCurrent = false;
    this._pendingSyncOptions = null;
    this._autoSyncTimer = null;
    this._unsubscribeStores = [];
    this._dataChangeSubscribed = false;
    this.listeners = [];

    if (this.storage && typeof this.storage.onChanged === 'function') {
      this._unsubscribeStorage = this.storage.onChanged((changes) => {
        if (changes.last_sync_time && changes.last_sync_time.newValue) {
          this.lastSyncTime = changes.last_sync_time.newValue;
        }
        if (changes.last_sync_base !== undefined) {
          this.baseData = changes.last_sync_base.newValue || null;
        }
        if (changes.sync_dirty !== undefined) {
          this.isDirty = !!changes.sync_dirty.newValue;
        }
        if (changes.last_sync_status && changes.last_sync_status.newValue) {
          const { status, detail, lastSyncTime } = changes.last_sync_status.newValue;
          if (lastSyncTime) this.lastSyncTime = lastSyncTime;
          if (status && status !== this.status) {
            this.status = status;
            this.listeners.forEach(cb => cb({ status, detail, lastSyncTime: this.lastSyncTime }));
          }
        }
      });
    }
  }

  onStatusChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  _setStatus(status, detail = null) {
    this.status = status;
    if (status === SYNC_STATUS.ERROR) {
      this.lastError = detail;
    } else if (status === SYNC_STATUS.SUCCESS) {
      this.lastError = null;
    }
    this.listeners.forEach(cb => cb({ status, detail, lastSyncTime: this.lastSyncTime }));
    if (this.storage) {
      this.storage.set({
        last_sync_status: {
          status,
          detail,
          lastSyncTime: this.lastSyncTime,
          updatedAt: Date.now()
        }
      }).catch(() => {});
    }
  }

  /**
   * 初始化 SyncCoordinator。
   * mode 為 'background' 時自動監聽 Storage 資料變更並標記 dirty，不啟動 Debounce 排程；
   * mode 為 'client' 時可依 autoSyncOnChange 決定是否自動排程。
   */
  async init({ mode = 'client', autoSyncOnChange = false } = {}) {
    if (this.storage) {
      const data = await this.storage.get(['last_sync_time', 'last_sync_base', 'sync_dirty']);
      if (data.last_sync_time) {
        this.lastSyncTime = data.last_sync_time;
      }
      if (data.last_sync_base) {
        this.baseData = data.last_sync_base;
      }
      if (data.sync_dirty !== undefined) {
        this.isDirty = !!data.sync_dirty;
      }

      if (typeof this.storage.onChanged === 'function' && !this._dataChangeSubscribed) {
        this._dataChangeSubscribed = true;
        this.storage.onChanged(async (changes) => {
          if (this.isApplyingRemoteSync) return;
          if (changes.sync_in_progress && changes.sync_in_progress.newValue === true) return;

          const hasDataChange = Boolean(changes.items || changes.tags || changes.searchEngines);
          if (!hasDataChange) return;

          if (mode === 'background' || !autoSyncOnChange) {
            await this.markDirty();
          } else {
            this.scheduleAutoSync();
          }
        });
      }
    }
  }

  /**
   * 取得整合帳號狀態摘要
   */
  async getAccountSummary() {
    let clientId = '';
    let redirectUri = '';
    let canAuto = false;
    let isAuth = false;
    let user = null;

    if (this.cloudAdapter) {
      if (typeof this.cloudAdapter.loadConfig === 'function') {
        const config = await this.cloudAdapter.loadConfig();
        clientId = config.clientId || '';
        user = config.user || null;
      } else if (typeof this.cloudAdapter.getClientId === 'function') {
        clientId = this.cloudAdapter.getClientId() || '';
      }
      if (typeof this.cloudAdapter.getRedirectUri === 'function') {
        redirectUri = this.cloudAdapter.getRedirectUri() || '';
      }
      if (typeof this.cloudAdapter.canAutoConnect === 'function') {
        canAuto = await this.cloudAdapter.canAutoConnect();
      }
      if (typeof this.cloudAdapter.isAuthenticated === 'function') {
        isAuth = await this.cloudAdapter.isAuthenticated();
      }
      if (!isAuth && canAuto && typeof this.cloudAdapter.ensureAuthenticated === 'function') {
        isAuth = await this.cloudAdapter.ensureAuthenticated({ allowInteractiveFallback: false });
      }
      if (isAuth && typeof this.cloudAdapter.getUserInfo === 'function') {
        try {
          user = await this.cloudAdapter.getUserInfo();
        } catch {
          // ignore
        }
      }
    }

    return {
      status: this.status,
      lastSyncTime: this.lastSyncTime,
      error: this.status === SYNC_STATUS.ERROR ? this.lastError : null,
      isAuthenticated: isAuth,
      user,
      clientId,
      redirectUri,
      canAutoConnect: canAuto
    };
  }

  async getSyncState() {
    return this.getAccountSummary();
  }

  async saveClientConfig(clientId) {
    const trimmed = (clientId || '').trim();
    if (this.cloudAdapter && typeof this.cloudAdapter.saveConfig === 'function') {
      await this.cloudAdapter.saveConfig(trimmed);
    } else if (this.cloudAdapter && typeof this.cloudAdapter.setClientId === 'function') {
      this.cloudAdapter.setClientId(trimmed);
    }
    if (this.storage) {
      await this.storage.set({ gdrive_client_id: trimmed });
    }
  }

  async connectAccount() {
    if (!this.cloudAdapter || typeof this.cloudAdapter.authorize !== 'function') {
      throw new Error('Cloud adapter does not support authorization');
    }
    const authResult = await this.cloudAdapter.authorize(true);
    const syncResult = await this.sync();
    return { authResult, syncResult };
  }

  async disconnectAccount() {
    if (this.cloudAdapter && typeof this.cloudAdapter.disconnect === 'function') {
      await this.cloudAdapter.disconnect();
    }
    this._setStatus(SYNC_STATUS.IDLE);
    await this.resetBase();
  }

  bindLifecycle(options = {}) {
    return bindClientLifecycle({ coordinator: this, ...options });
  }

  /**
   * 啟用資料異動監聽自動同步 (當 CollectionStore 或 SearchEngineStore 發生本地修改時自動排程同步)
   */
  enableAutoSync({ debounceMs = this.autoSyncDebounceMs } = {}) {
    this.disableAutoSync();

    const handleStoreMutation = (event) => {
      if (this.isApplyingRemoteSync) return;
      if (event && event.type === 'sync' && event.source === 'external') return;
      this.scheduleAutoSync(debounceMs);
    };

    if (this.collectionStore && typeof this.collectionStore.subscribe === 'function') {
      this._unsubscribeStores.push(this.collectionStore.subscribe(handleStoreMutation));
    }
    if (this.searchEngineStore && typeof this.searchEngineStore.subscribe === 'function') {
      this._unsubscribeStores.push(this.searchEngineStore.subscribe(handleStoreMutation));
    }

    return () => this.disableAutoSync();
  }

  disableAutoSync() {
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
    this._unsubscribeStores.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this._unsubscribeStores = [];
  }

  /**
   * 標記本地有未同步至雲端的變更
   */
  async markDirty() {
    this.isDirty = true;
    if (this.storage) {
      await this.storage.set({ sync_dirty: true });
    }
  }

  /**
   * 檢查目前本地資料是否與基準快照 (baseData) 有差異或標記為 dirty
   */
  async hasUnsyncedChanges() {
    if (this.isDirty) return true;
    const localData = await createUnifiedBackup(this.collectionStore, this.searchEngineStore);
    if (!this.baseData) {
      return (
        localData.items.length > 0 ||
        localData.tags.length > 0 ||
        localData.searchEngines.length > 0
      );
    }
    return !isUnifiedDataEqual(localData, this.baseData);
  }

  /**
   * 防抖排程自動同步
   */
  scheduleAutoSync(delayMs = this.autoSyncDebounceMs, options = {}) {
    if (this.isApplyingRemoteSync) return;
    this.markDirty().catch(() => {});

    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
    }

    this._autoSyncTimer = setTimeout(async () => {
      this._autoSyncTimer = null;
      const canSync = await this._canPerformAutoSync();
      if (canSync) {
        await this.sync(options);
      }
    }, delayMs);
  }

  async _canPerformAutoSync() {
    if (!this.cloudAdapter) return false;
    if (typeof this.cloudAdapter.canAutoConnect === 'function') {
      return await this.cloudAdapter.canAutoConnect();
    }
    if (typeof this.cloudAdapter.isAuthenticated === 'function') {
      return await this.cloudAdapter.isAuthenticated();
    }
    return false;
  }

  /**
   * 關閉 Extension 或瀏覽器時立即 Flush 保存未同步變更
   */
  async flushPendingSync(options = {}) {
    const hadPendingTimer = !!this._autoSyncTimer;
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }

    const canSync = await this._canPerformAutoSync();
    if (!canSync) {
      return { success: false, skipped: true, reason: 'not_connected' };
    }

    const shouldSync =
      hadPendingTimer ||
      this.isDirty ||
      !!options.force ||
      (await this.hasUnsyncedChanges());

    if (!shouldSync) {
      return { success: true, skipped: true, reason: 'already_in_sync' };
    }

    return await this.sync(options);
  }

  /**
   * 開啟瀏覽器或開啟 Extension 時自動登入並執行 3-Way Sync
   */
  async autoLoginAndSync({ allowInteractiveFallback = true } = {}) {
    const canSync = await this._canPerformAutoSync();
    if (!canSync) {
      return { success: false, skipped: true, reason: 'not_connected' };
    }

    let isAuth = false;
    if (typeof this.cloudAdapter.ensureAuthenticated === 'function') {
      isAuth = await this.cloudAdapter.ensureAuthenticated({ allowInteractiveFallback });
    } else if (typeof this.cloudAdapter.isAuthenticated === 'function') {
      isAuth = await this.cloudAdapter.isAuthenticated();
    }

    if (!isAuth) {
      const errorMsg = 'Cloud auto-login failed or requires authorization.';
      this._setStatus(SYNC_STATUS.ERROR, errorMsg);
      return { success: false, error: errorMsg };
    }

    return await this.sync({ allowInteractiveFallback });
  }

  getBaseData() {
    return this.baseData ? JSON.parse(JSON.stringify(this.baseData)) : null;
  }

  async resetBase() {
    this.baseData = null;
    if (this.storage) {
      await this.storage.set({ last_sync_base: null });
    }
  }

  async _saveSyncState(time, baseData) {
    this.lastSyncTime = time;
    this.baseData = baseData ? JSON.parse(JSON.stringify(baseData)) : null;
    this.isDirty = false;
    if (this.storage) {
      await this.storage.set({
        last_sync_time: time,
        last_sync_base: this.baseData,
        sync_dirty: false
      });
    }
  }

  /**
   * 執行同步：讀取雲端、比對合併 (Smart 3-Way Merge)、更新本地、推回雲端
   * 具備 Single-Flight 防重入鎖定，若同步期間有新請求將自動排隊接續執行
   * @param {Object} [options]
   * @returns {Promise<{ success: boolean, stats?: Object, error?: string }>}
   */
  async sync(options = {}) {
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }

    if (this._syncPromise) {
      this._pendingSyncAfterCurrent = true;
      this._pendingSyncOptions = options;
      return this._syncPromise;
    }

    this._syncPromise = (async () => {
      let result = await this._executeSync(options);
      while (this._pendingSyncAfterCurrent) {
        const nextOptions = this._pendingSyncOptions || {};
        this._pendingSyncAfterCurrent = false;
        this._pendingSyncOptions = null;
        result = await this._executeSync(nextOptions);
      }
      return result;
    })();

    try {
      return await this._syncPromise;
    } finally {
      this._syncPromise = null;
    }
  }

  async _executeSync(options = {}) {
    const allowInteractiveFallback =
      options.allowInteractiveFallback !== undefined ? options.allowInteractiveFallback : true;

    let isAuth = false;
    if (typeof this.cloudAdapter.ensureAuthenticated === 'function') {
      isAuth = await this.cloudAdapter.ensureAuthenticated({ allowInteractiveFallback });
    } else if (typeof this.cloudAdapter.isAuthenticated === 'function') {
      isAuth = await this.cloudAdapter.isAuthenticated();
    }

    if (!isAuth) {
      const errorMsg = 'Google Drive is not authenticated. Please log in.';
      this._setStatus(SYNC_STATUS.ERROR, errorMsg);
      return { success: false, error: errorMsg };
    }

    this._setStatus(SYNC_STATUS.SYNCING, 'Checking cloud backup...');

    try {
      if (this.storage) {
        const storedState = await this.storage.get(['last_sync_base']);
        if (storedState && storedState.last_sync_base !== undefined) {
          this.baseData = storedState.last_sync_base || null;
        }
      }

      // 1. 檢查雲端是否有舊有備份檔案
      const cloudFile = await this.cloudAdapter.findFile();

      if (!cloudFile) {
        // 雲端無檔案：取得本地最新資料並推送至雲端
        const localData = await createUnifiedBackup(this.collectionStore, this.searchEngineStore);
        this._setStatus(SYNC_STATUS.SYNCING, 'Uploading initial backup to cloud...');
        const uploadResult = await this.cloudAdapter.uploadJson(localData);

        const now = Date.now();
        await this._saveSyncState(now, localData);
        this._setStatus(SYNC_STATUS.SUCCESS, 'Initial upload completed');

        return {
          success: true,
          action: 'uploaded_initial',
          stats: {
            itemsCount: localData.items.length,
            tagsCount: localData.tags.length,
            searchEnginesCount: localData.searchEngines.length,
            modifiedTime: uploadResult.modifiedTime
          }
        };
      }

      // 2. 雲端有檔案：下載內容並校驗格式
      this._setStatus(SYNC_STATUS.SYNCING, 'Downloading cloud data...');
      const cloudData = await this.cloudAdapter.downloadJson(cloudFile.id);
      const validation = validateBackupPayload(cloudData);
      if (!validation.valid) {
        throw new Error(`Cloud data corrupted or invalid format: ${validation.error}`);
      }

      // 3. 在網路請求完成後，立即讀取當前「最新、最即時」的本地快照（避免網路請求期間使用者新增的資料被覆寫）
      const localData = await createUnifiedBackup(this.collectionStore, this.searchEngineStore);

      // 4. 智慧三向合併 (Smart 3-Way Merge)
      const mergedData = mergeUnifiedData(localData, cloudData, this.baseData);

      const localNeedsUpdate = !isUnifiedDataEqual(localData, mergedData);
      const cloudNeedsUpdate = !isUnifiedDataEqual(cloudData, mergedData);

      if (localNeedsUpdate) {
        this._setStatus(SYNC_STATUS.SYNCING, 'Applying remote changes locally...');
        this.isApplyingRemoteSync = true;
        if (this.storage) {
          await this.storage.set({ sync_in_progress: true });
        }
        try {
          const restoreRes = await restoreUnifiedBackup(mergedData, {
            collectionStore: this.collectionStore,
            searchEngineStore: this.searchEngineStore
          });
          if (!restoreRes.success) {
            throw new Error(`Failed to restore merged data locally: ${restoreRes.error}`);
          }
        } finally {
          this.isApplyingRemoteSync = false;
          if (this.storage) {
            await this.storage.set({ sync_in_progress: false });
          }
        }
      }

      let uploadResult = cloudFile;
      if (cloudNeedsUpdate) {
        this._setStatus(SYNC_STATUS.SYNCING, 'Uploading merged data to cloud...');
        uploadResult = await this.cloudAdapter.uploadJson(mergedData);
      }

      const now = Date.now();
      await this._saveSyncState(now, mergedData);
      this._setStatus(SYNC_STATUS.SUCCESS, 'Sync completed');

      return {
        success: true,
        action: cloudNeedsUpdate && localNeedsUpdate ? 'merged_both' : (cloudNeedsUpdate ? 'uploaded_merge' : (localNeedsUpdate ? 'downloaded_merge' : 'up_to_date')),
        stats: {
          itemsCount: mergedData.items.length,
          tagsCount: mergedData.tags.length,
          searchEnginesCount: mergedData.searchEngines.length,
          modifiedTime: uploadResult.modifiedTime
        }
      };
    } catch (err) {
      const errorMsg = err.message || 'Sync failed unexpectedly.';
      this._setStatus(SYNC_STATUS.ERROR, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 強制從雲端拉取並覆蓋本地 (Force Download / Pull)
   */
  async pullFromCloud() {
    let isAuth = false;
    if (typeof this.cloudAdapter.ensureAuthenticated === 'function') {
      isAuth = await this.cloudAdapter.ensureAuthenticated({ allowInteractiveFallback: true });
    } else {
      isAuth = await this.cloudAdapter.isAuthenticated();
    }
    if (!isAuth) throw new Error('Not authenticated.');

    this._setStatus(SYNC_STATUS.SYNCING, 'Fetching cloud file...');
    const cloudFile = await this.cloudAdapter.findFile();
    if (!cloudFile) throw new Error('No cloud backup found to restore.');

    const cloudData = await this.cloudAdapter.downloadJson(cloudFile.id);
    this.isApplyingRemoteSync = true;
    if (this.storage) {
      await this.storage.set({ sync_in_progress: true });
    }
    let result;
    try {
      result = await restoreUnifiedBackup(cloudData, {
        collectionStore: this.collectionStore,
        searchEngineStore: this.searchEngineStore
      });
    } finally {
      this.isApplyingRemoteSync = false;
      if (this.storage) {
        await this.storage.set({ sync_in_progress: false });
      }
    }

    if (result.success) {
      const now = Date.now();
      await this._saveSyncState(now, cloudData);
      this._setStatus(SYNC_STATUS.SUCCESS, 'Restored from cloud');
    } else {
      this._setStatus(SYNC_STATUS.ERROR, result.error);
    }
    return result;
  }

  /**
   * 強制用本地資料覆蓋雲端 (Force Upload / Push)
   */
  async pushToCloud() {
    let isAuth = false;
    if (typeof this.cloudAdapter.ensureAuthenticated === 'function') {
      isAuth = await this.cloudAdapter.ensureAuthenticated({ allowInteractiveFallback: true });
    } else {
      isAuth = await this.cloudAdapter.isAuthenticated();
    }
    if (!isAuth) throw new Error('Not authenticated.');

    this._setStatus(SYNC_STATUS.SYNCING, 'Uploading local data to cloud...');
    const localData = await createUnifiedBackup(this.collectionStore, this.searchEngineStore);
    const uploadResult = await this.cloudAdapter.uploadJson(localData);

    const now = Date.now();
    await this._saveSyncState(now, localData);
    this._setStatus(SYNC_STATUS.SUCCESS, 'Pushed local to cloud');

    return { success: true, modifiedTime: uploadResult.modifiedTime };
  }
}
