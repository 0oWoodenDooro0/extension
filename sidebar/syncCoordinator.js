// syncCoordinator.js - 雲端多裝置同步協調器 (Cloud Sync Coordinator)
// 封裝雙向同步、智慧合併 (Smart Merge)、版本比對與快照還原邏輯

import { validateBackupPayload, createUnifiedBackup, restoreUnifiedBackup } from './backupCoordinator.js';

export const SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  SUCCESS: 'success',
  ERROR: 'error'
};

/**
 * 智慧合併演算法 (Smart 2-Way Merge)
 * 根據 item.id 與 updatedAt 進行比對，保留較新之項目，聯集標籤與搜尋引擎
 * @param {Object} localData - 本地備份物件 { items, tags, searchEngines }
 * @param {Object} cloudData - 雲端備份物件 { items, tags, searchEngines }
 * @returns {Object} 合併後物件 { items, tags, searchEngines }
 */
export function mergeUnifiedData(localData, cloudData) {
  const localItems = Array.isArray(localData?.items) ? localData.items : [];
  const cloudItems = Array.isArray(cloudData?.items) ? cloudData.items : [];

  // 1. 合併 Items (以 id 或 url 為鍵，比較 updatedAt / addDate)
  const itemMap = new Map();

  // 先放雲端項目
  for (const item of cloudItems) {
    if (item && (item.id || item.url)) {
      const key = item.id || item.url;
      itemMap.set(key, { ...item });
    }
  }

  // 再以本地項目比對
  for (const localItem of localItems) {
    if (!localItem || (!localItem.id && !localItem.url)) continue;
    const key = localItem.id || localItem.url;
    if (!itemMap.has(key)) {
      itemMap.set(key, { ...localItem });
    } else {
      const cloudItem = itemMap.get(key);
      const localTime = Number(localItem.updatedAt || localItem.addDate || 0);
      const cloudTime = Number(cloudItem.updatedAt || cloudItem.addDate || 0);

      // 若本地較新或時間相同，採用本地；否則保留雲端
      if (localTime >= cloudTime) {
        itemMap.set(key, { ...cloudItem, ...localItem });
      }
    }
  }

  const mergedItems = Array.from(itemMap.values());

  // 2. 合併 Tags (保持原有順序並聯集去重)
  const localTags = Array.isArray(localData?.tags) ? localData.tags : [];
  const cloudTags = Array.isArray(cloudData?.tags) ? cloudData.tags : [];
  const tagSet = new Set(localTags);
  for (const tag of cloudTags) {
    if (tag && typeof tag === 'string') {
      tagSet.add(tag);
    }
  }
  const mergedTags = Array.from(tagSet);

  // 3. 合併 SearchEngines (以 id 或 urlTemplate 為鍵比對)
  const localEngines = Array.isArray(localData?.searchEngines) ? localData.searchEngines : [];
  const cloudEngines = Array.isArray(cloudData?.searchEngines) ? cloudData.searchEngines : [];
  const engineMap = new Map();

  for (const eng of cloudEngines) {
    if (eng && (eng.id || eng.urlTemplate)) {
      const key = eng.id || eng.urlTemplate;
      engineMap.set(key, { ...eng });
    }
  }

  for (const eng of localEngines) {
    if (!eng || (!eng.id && !eng.urlTemplate)) continue;
    const key = eng.id || eng.urlTemplate;
    if (!engineMap.has(key)) {
      engineMap.set(key, { ...eng });
    } else {
      const cloudEng = engineMap.get(key);
      const localTime = Number(eng.updatedAt || 0);
      const cloudTime = Number(cloudEng.updatedAt || 0);
      if (localTime >= cloudTime) {
        engineMap.set(key, { ...cloudEng, ...eng });
      }
    }
  }
  const mergedEngines = Array.from(engineMap.values());

  return {
    version: 1,
    items: mergedItems,
    tags: mergedTags,
    searchEngines: mergedEngines
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
   * @param {Object} [options.storage] - 本地儲存 (記錄 lastSyncTime 等)
   */
  constructor({ cloudAdapter, collectionStore, searchEngineStore, storage = null } = {}) {
    this.cloudAdapter = cloudAdapter;
    this.collectionStore = collectionStore;
    this.searchEngineStore = searchEngineStore;
    this.storage = storage;
    this.status = SYNC_STATUS.IDLE;
    this.lastSyncTime = null;
    this.listeners = [];
  }

  onStatusChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  _setStatus(status, detail = null) {
    this.status = status;
    this.listeners.forEach(cb => cb({ status, detail, lastSyncTime: this.lastSyncTime }));
  }

  async init() {
    if (this.storage) {
      const data = await this.storage.get(['last_sync_time']);
      if (data.last_sync_time) {
        this.lastSyncTime = data.last_sync_time;
      }
    }
  }

  /**
   * 執行雙向同步：讀取雲端、比對合併、更新本地、推回雲端
   * @returns {Promise<{ success: boolean, stats?: Object, error?: string }>}
   */
  async sync() {
    const isAuth = await this.cloudAdapter.isAuthenticated();
    if (!isAuth) {
      const errorMsg = 'Cloud adapter is not authenticated.';
      this._setStatus(SYNC_STATUS.ERROR, errorMsg);
      return { success: false, error: errorMsg };
    }

    this._setStatus(SYNC_STATUS.SYNCING, 'Checking cloud files...');

    try {
      // 1. 取得本地最新資料
      const localData = await createUnifiedBackup(this.collectionStore, this.searchEngineStore);

      // 2. 檢查雲端是否有舊有備份檔案
      const cloudFile = await this.cloudAdapter.findFile();

      if (!cloudFile) {
        // 雲端無檔案：直接將本地資料推送至雲端
        this._setStatus(SYNC_STATUS.SYNCING, 'Uploading initial data to cloud...');
        const uploadResult = await this.cloudAdapter.uploadJson(localData);

        const now = Date.now();
        this.lastSyncTime = now;
        if (this.storage) {
          await this.storage.set({ last_sync_time: now });
        }

        this._setStatus(SYNC_STATUS.SUCCESS, 'Initial upload complete');
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

      // 3. 雲端有檔案：下載內容
      this._setStatus(SYNC_STATUS.SYNCING, 'Downloading cloud data...');
      const cloudData = await this.cloudAdapter.downloadJson(cloudFile.id);

      const validation = validateBackupPayload(cloudData);
      if (!validation.valid) {
        throw new Error(`Cloud data corrupted or invalid format: ${validation.error}`);
      }

      // 4. 智慧雙向合併 (Smart Merge)
      const mergedData = mergeUnifiedData(localData, cloudData);

      // 5. 更新本地 Store
      await restoreUnifiedBackup(mergedData, {
        collectionStore: this.collectionStore,
        searchEngineStore: this.searchEngineStore
      });

      // 6. 將合併後的最終版本上傳至雲端
      this._setStatus(SYNC_STATUS.SYNCING, 'Updating cloud data with merged result...');
      const uploadResult = await this.cloudAdapter.uploadJson(mergedData);

      const now = Date.now();
      this.lastSyncTime = now;
      if (this.storage) {
        await this.storage.set({ last_sync_time: now });
      }

      this._setStatus(SYNC_STATUS.SUCCESS, 'Sync complete');
      return {
        success: true,
        action: 'merged_sync',
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
   * 強制從雲端拉取並覆蓋本地 (Force Download)
   */
  async pullFromCloud() {
    const isAuth = await this.cloudAdapter.isAuthenticated();
    if (!isAuth) throw new Error('Not authenticated.');

    this._setStatus(SYNC_STATUS.SYNCING, 'Fetching cloud file...');
    const cloudFile = await this.cloudAdapter.findFile();
    if (!cloudFile) throw new Error('No cloud backup found to restore.');

    const cloudData = await this.cloudAdapter.downloadJson(cloudFile.id);
    const result = await restoreUnifiedBackup(cloudData, {
      collectionStore: this.collectionStore,
      searchEngineStore: this.searchEngineStore
    });

    if (result.success) {
      const now = Date.now();
      this.lastSyncTime = now;
      if (this.storage) await this.storage.set({ last_sync_time: now });
      this._setStatus(SYNC_STATUS.SUCCESS, 'Restored from cloud');
    } else {
      this._setStatus(SYNC_STATUS.ERROR, result.error);
    }
    return result;
  }

  /**
   * 強制用本地資料覆蓋雲端 (Force Upload)
   */
  async pushToCloud() {
    const isAuth = await this.cloudAdapter.isAuthenticated();
    if (!isAuth) throw new Error('Not authenticated.');

    this._setStatus(SYNC_STATUS.SYNCING, 'Uploading local data to cloud...');
    const localData = await createUnifiedBackup(this.collectionStore, this.searchEngineStore);
    const uploadResult = await this.cloudAdapter.uploadJson(localData);

    const now = Date.now();
    this.lastSyncTime = now;
    if (this.storage) await this.storage.set({ last_sync_time: now });
    this._setStatus(SYNC_STATUS.SUCCESS, 'Pushed local to cloud');

    return { success: true, modifiedTime: uploadResult.modifiedTime };
  }
}
