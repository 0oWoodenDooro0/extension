// syncCoordinator.js - 雲端多裝置同步協調器 (Cloud Sync Coordinator)
// 封裝雙向與三向智慧合併 (Smart 3-Way Merge)、基準快照 (Base Snapshot)、版本比對與快照還原邏輯

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

function isItemContentEqual(a, b) {
  if (!a || !b) return a === b;
  if (a.title !== b.title) return false;
  if (a.url !== b.url) return false;
  if ((a.imageUrl || null) !== (b.imageUrl || null)) return false;
  if (!arraysEqual(a.tags, b.tags)) return false;
  if (!arraysEqual(a.actors, b.actors)) return false;
  return true;
}

function isEngineContentEqual(a, b) {
  if (!a || !b) return a === b;
  if (a.title !== b.title) return false;
  if (a.urlTemplate !== b.urlTemplate) return false;
  if ((a.queryRegex || null) !== (b.queryRegex || null)) return false;
  if ((a.queryReplacement || null) !== (b.queryReplacement || null)) return false;
  return true;
}

function isItemModified(item, baseItem) {
  if (!item && !baseItem) return false;
  if (!item || !baseItem) return true;
  const itemTime = Number(item.updatedAt || item.addDate || 0);
  const baseTime = Number(baseItem.updatedAt || baseItem.addDate || 0);
  if (itemTime > baseTime) return true;
  return !isItemContentEqual(item, baseItem);
}

function isEngineModified(eng, baseEng) {
  if (!eng && !baseEng) return false;
  if (!eng || !baseEng) return true;
  const engTime = Number(eng.updatedAt || 0);
  const baseTime = Number(baseEng.updatedAt || 0);
  if (engTime > baseTime) return true;
  return !isEngineContentEqual(eng, baseEng);
}

/**
 * 舊版雙向合併 (Smart 2-Way Merge)
 * 用於無基準快照 (首次同步或升級過渡) 時進行聯集保護，防止資料誤刪
 */
export function twoWayMergeUnifiedData(localData, cloudData) {
  const localItems = Array.isArray(localData?.items) ? localData.items : [];
  const cloudItems = Array.isArray(cloudData?.items) ? cloudData.items : [];

  const itemMap = new Map();
  for (const item of cloudItems) {
    if (item && (item.id || item.url)) {
      const key = item.id || item.url;
      itemMap.set(key, { ...item });
    }
  }

  for (const localItem of localItems) {
    if (!localItem || (!localItem.id && !localItem.url)) continue;
    const key = localItem.id || localItem.url;
    if (!itemMap.has(key)) {
      itemMap.set(key, { ...localItem });
    } else {
      const cloudItem = itemMap.get(key);
      const localTime = Number(localItem.updatedAt || localItem.addDate || 0);
      const cloudTime = Number(cloudItem.updatedAt || cloudItem.addDate || 0);
      if (localTime >= cloudTime) {
        itemMap.set(key, { ...cloudItem, ...localItem });
      }
    }
  }

  const localTags = Array.isArray(localData?.tags) ? localData.tags : [];
  const cloudTags = Array.isArray(cloudData?.tags) ? cloudData.tags : [];
  const tagSet = new Set(localTags);
  for (const tag of cloudTags) {
    if (tag && typeof tag === 'string') {
      tagSet.add(tag);
    }
  }

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

  return {
    version: 1,
    items: Array.from(itemMap.values()),
    tags: Array.from(tagSet),
    searchEngines: Array.from(engineMap.values())
  };
}

/**
 * 三向合併演算法 (Smart 3-Way Merge)
 * 根據本機 (Local)、雲端 (Cloud) 與上次同步基準 (Base) 快照進行精準比對：
 * 1. 本機刪除 (在 Base 但不在 Local，且 Cloud 未被異動) -> 雲端同步刪除，不重新復活。
 * 2. 雲端刪除 (在 Base 但不在 Cloud，且 Local 未被異動) -> 本機同步刪除。
 * 3. 雙方新增或各自修改 -> 保留或依照 updatedAt 解決衝突 (修改勝過刪除)。
 * @param {Object} localData - 本機目前資料
 * @param {Object} cloudData - 雲端下載資料
 * @param {Object} baseData - 上次同步基準快照
 * @returns {Object} 合併後物件 { items, tags, searchEngines }
 */
export function threeWayMergeUnifiedData(localData, cloudData, baseData) {
  if (!baseData) {
    return twoWayMergeUnifiedData(localData, cloudData);
  }

  const localItems = Array.isArray(localData?.items) ? localData.items : [];
  const cloudItems = Array.isArray(cloudData?.items) ? cloudData.items : [];
  const baseItems = Array.isArray(baseData?.items) ? baseData.items : [];

  // --- 1. Items 3-Way Merge ---
  const localItemMap = new Map();
  for (const item of localItems) {
    if (item && (item.id || item.url)) {
      localItemMap.set(item.id || item.url, item);
    }
  }

  const cloudItemMap = new Map();
  for (const item of cloudItems) {
    if (item && (item.id || item.url)) {
      cloudItemMap.set(item.id || item.url, item);
    }
  }

  const baseItemMap = new Map();
  for (const item of baseItems) {
    if (item && (item.id || item.url)) {
      baseItemMap.set(item.id || item.url, item);
    }
  }

  const allItemKeys = new Set([
    ...localItemMap.keys(),
    ...cloudItemMap.keys(),
    ...baseItemMap.keys()
  ]);

  const mergedItems = [];

  for (const key of allItemKeys) {
    const localItem = localItemMap.get(key);
    const cloudItem = cloudItemMap.get(key);
    const baseItem = baseItemMap.get(key);

    const inLocal = !!localItem;
    const inCloud = !!cloudItem;
    const inBase = !!baseItem;

    if (inLocal && inCloud && inBase) {
      const localMod = isItemModified(localItem, baseItem);
      const cloudMod = isItemModified(cloudItem, baseItem);

      if (!localMod && !cloudMod) {
        mergedItems.push({ ...localItem });
      } else if (localMod && !cloudMod) {
        mergedItems.push({ ...localItem });
      } else if (!localMod && cloudMod) {
        mergedItems.push({ ...cloudItem });
      } else {
        const localTime = Number(localItem.updatedAt || localItem.addDate || 0);
        const cloudTime = Number(cloudItem.updatedAt || cloudItem.addDate || 0);
        if (localTime >= cloudTime) {
          mergedItems.push({ ...cloudItem, ...localItem });
        } else {
          mergedItems.push({ ...localItem, ...cloudItem });
        }
      }
    } else if (!inLocal && inCloud && inBase) {
      // 在 Base 與 Cloud，但 Local 不存在
      const cloudMod = isItemModified(cloudItem, baseItem);
      if (cloudMod) {
        // 雲端在上次同步後有進一步更新 -> 衝突時以編輯為優先
        mergedItems.push({ ...cloudItem });
      } else {
        // 雲端未更動，本機刪除 -> 確認刪除！
      }
    } else if (inLocal && !inCloud && inBase) {
      // 在 Base 與 Local，但 Cloud 不存在 (其他裝置刪除)
      const localMod = isItemModified(localItem, baseItem);
      if (localMod) {
        // 本機在上次同步後有進一步更新 -> 衝突時以本機編輯為優先
        mergedItems.push({ ...localItem });
      } else {
        // 本機未更動，雲端已刪除 -> 確認刪除！
      }
    } else if (!inLocal && !inCloud && inBase) {
      // 雙方皆已刪除
    } else if (inLocal && !inCloud && !inBase) {
      // 本機新增項目
      mergedItems.push({ ...localItem });
    } else if (!inLocal && inCloud && !inBase) {
      // 雲端新增項目
      mergedItems.push({ ...cloudItem });
    } else if (inLocal && inCloud && !inBase) {
      // 雙方各自新增同一 ID/URL 項目 -> 比較時間戳
      const localTime = Number(localItem.updatedAt || localItem.addDate || 0);
      const cloudTime = Number(cloudItem.updatedAt || cloudItem.addDate || 0);
      if (localTime >= cloudTime) {
        mergedItems.push({ ...cloudItem, ...localItem });
      } else {
        mergedItems.push({ ...localItem, ...cloudItem });
      }
    }
  }

  // --- 2. Tags 3-Way Merge ---
  const localTags = Array.isArray(localData?.tags) ? localData.tags : [];
  const cloudTags = Array.isArray(cloudData?.tags) ? cloudData.tags : [];
  const baseTags = Array.isArray(baseData?.tags) ? baseData.tags : [];

  const localTagSet = new Set(localTags);
  const cloudTagSet = new Set(cloudTags);
  const baseTagSet = new Set(baseTags);

  const allTagKeys = new Set([...localTagSet, ...cloudTagSet, ...baseTagSet]);
  const finalTagSet = new Set();

  for (const tag of allTagKeys) {
    if (!tag || typeof tag !== 'string') continue;
    const inLocal = localTagSet.has(tag);
    const inCloud = cloudTagSet.has(tag);
    const inBase = baseTagSet.has(tag);

    if (inLocal && inCloud && inBase) {
      finalTagSet.add(tag);
    } else if (!inLocal && inCloud && inBase) {
      // 本機刪除標籤 -> 不保留
    } else if (inLocal && !inCloud && inBase) {
      // 雲端刪除標籤 -> 不保留
    } else if (inLocal && !inBase) {
      // 本機新增標籤 -> 保留
      finalTagSet.add(tag);
    } else if (inCloud && !inBase) {
      // 雲端新增標籤 -> 保留
      finalTagSet.add(tag);
    }
  }

  // 保持本機順序，並將雲端新增的標籤追加至末尾
  const mergedTags = [];
  for (const tag of localTags) {
    if (finalTagSet.has(tag) && !mergedTags.includes(tag)) {
      mergedTags.push(tag);
    }
  }
  for (const tag of cloudTags) {
    if (finalTagSet.has(tag) && !mergedTags.includes(tag)) {
      mergedTags.push(tag);
    }
  }

  // --- 3. Search Engines 3-Way Merge ---
  const localEngines = Array.isArray(localData?.searchEngines) ? localData.searchEngines : [];
  const cloudEngines = Array.isArray(cloudData?.searchEngines) ? cloudData.searchEngines : [];
  const baseEngines = Array.isArray(baseData?.searchEngines) ? baseData.searchEngines : [];

  const localEngMap = new Map();
  for (const eng of localEngines) {
    if (eng && (eng.id || eng.urlTemplate)) {
      localEngMap.set(eng.id || eng.urlTemplate, eng);
    }
  }

  const cloudEngMap = new Map();
  for (const eng of cloudEngines) {
    if (eng && (eng.id || eng.urlTemplate)) {
      cloudEngMap.set(eng.id || eng.urlTemplate, eng);
    }
  }

  const baseEngMap = new Map();
  for (const eng of baseEngines) {
    if (eng && (eng.id || eng.urlTemplate)) {
      baseEngMap.set(eng.id || eng.urlTemplate, eng);
    }
  }

  const allEngKeys = new Set([
    ...localEngMap.keys(),
    ...cloudEngMap.keys(),
    ...baseEngMap.keys()
  ]);

  const mergedEngines = [];

  for (const key of allEngKeys) {
    const localEng = localEngMap.get(key);
    const cloudEng = cloudEngMap.get(key);
    const baseEng = baseEngMap.get(key);

    const inLocal = !!localEng;
    const inCloud = !!cloudEng;
    const inBase = !!baseEng;

    if (inLocal && inCloud && inBase) {
      const localMod = isEngineModified(localEng, baseEng);
      const cloudMod = isEngineModified(cloudEng, baseEng);

      if (!localMod && !cloudMod) {
        mergedEngines.push({ ...localEng });
      } else if (localMod && !cloudMod) {
        mergedEngines.push({ ...localEng });
      } else if (!localMod && cloudMod) {
        mergedEngines.push({ ...cloudEng });
      } else {
        const localTime = Number(localEng.updatedAt || 0);
        const cloudTime = Number(cloudEng.updatedAt || 0);
        if (localTime >= cloudTime) {
          mergedEngines.push({ ...cloudEng, ...localEng });
        } else {
          mergedEngines.push({ ...localEng, ...cloudEng });
        }
      }
    } else if (!inLocal && inCloud && inBase) {
      const cloudMod = isEngineModified(cloudEng, baseEng);
      if (cloudMod) {
        mergedEngines.push({ ...cloudEng });
      }
    } else if (inLocal && !inCloud && inBase) {
      const localMod = isEngineModified(localEng, baseEng);
      if (localMod) {
        mergedEngines.push({ ...localEng });
      }
    } else if (!inLocal && !inCloud && inBase) {
      // 雙方皆已刪除
    } else if (inLocal && !inCloud && !inBase) {
      mergedEngines.push({ ...localEng });
    } else if (!inLocal && inCloud && !inBase) {
      mergedEngines.push({ ...cloudEng });
    } else if (inLocal && inCloud && !inBase) {
      const localTime = Number(localEng.updatedAt || 0);
      const cloudTime = Number(cloudEng.updatedAt || 0);
      if (localTime >= cloudTime) {
        mergedEngines.push({ ...cloudEng, ...localEng });
      } else {
        mergedEngines.push({ ...localEng, ...cloudEng });
      }
    }
  }

  return {
    version: 1,
    items: mergedItems,
    tags: mergedTags,
    searchEngines: mergedEngines
  };
}

/**
 * 智慧合併統一入口
 * 若有提供 baseData 則採用 Smart 3-Way Merge，無則退回 2-Way Merge
 * @param {Object} localData - 本機備份物件 { items, tags, searchEngines }
 * @param {Object} cloudData - 雲端備份物件 { items, tags, searchEngines }
 * @param {Object} [baseData=null] - 上次同步基準快照
 * @returns {Object} 合併後物件 { items, tags, searchEngines }
 */
export function mergeUnifiedData(localData, cloudData, baseData = null) {
  if (baseData && typeof baseData === 'object') {
    return threeWayMergeUnifiedData(localData, cloudData, baseData);
  }
  return twoWayMergeUnifiedData(localData, cloudData);
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
   * @param {Object} [options.storage] - 本地儲存 (記錄 last_sync_time, last_sync_base 等)
   */
  constructor({ cloudAdapter, collectionStore, searchEngineStore, storage = null } = {}) {
    this.cloudAdapter = cloudAdapter;
    this.collectionStore = collectionStore;
    this.searchEngineStore = searchEngineStore;
    this.storage = storage;
    this.status = SYNC_STATUS.IDLE;
    this.lastSyncTime = null;
    this.baseData = null;
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
      const data = await this.storage.get(['last_sync_time', 'last_sync_base']);
      if (data.last_sync_time) {
        this.lastSyncTime = data.last_sync_time;
      }
      if (data.last_sync_base) {
        this.baseData = data.last_sync_base;
      }
    }
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
    if (this.storage) {
      await this.storage.set({
        last_sync_time: time,
        last_sync_base: this.baseData
      });
    }
  }

  /**
   * 執行同步：讀取雲端、比對合併 (Smart 3-Way Merge)、更新本地、推回雲端
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
        // 雲端無檔案：直接將本地資料推送至雲端，並將此版本設為基準快照
        this._setStatus(SYNC_STATUS.SYNCING, 'Uploading initial data to cloud...');
        const uploadResult = await this.cloudAdapter.uploadJson(localData);

        const now = Date.now();
        await this._saveSyncState(now, localData);

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

      // 4. 智慧三向合併 (Smart 3-Way Merge)
      const mergedData = mergeUnifiedData(localData, cloudData, this.baseData);

      // 5. 更新本地 Store
      await restoreUnifiedBackup(mergedData, {
        collectionStore: this.collectionStore,
        searchEngineStore: this.searchEngineStore
      });

      // 6. 將合併後的最終版本上傳至雲端，並更新基準快照
      this._setStatus(SYNC_STATUS.SYNCING, 'Updating cloud data with merged result...');
      const uploadResult = await this.cloudAdapter.uploadJson(mergedData);

      const now = Date.now();
      await this._saveSyncState(now, mergedData);

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
   * 強制從雲端拉取並覆蓋本地 (Force Download / Pull)
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
    const isAuth = await this.cloudAdapter.isAuthenticated();
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
