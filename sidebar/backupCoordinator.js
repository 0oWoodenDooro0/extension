// backupCoordinator.js - 統一備份協調模組 (Unified Backup Coordinator)
// 向後相容層，內部完整委派至深層 CollectionStore 快照與備份介面

import { CollectionStore } from './store.js';

/**
 * 校驗備份資料結構是否合法
 * @param {any} payload 
 * @returns {{ valid: boolean, error: string|null, hasItems?: boolean, hasTags?: boolean, hasSearchEngines?: boolean, counts?: Object }}
 */
export function validateBackupPayload(payload) {
  return CollectionStore.validateSnapshot(payload);
}

/**
 * 生成包含 Collection 與 SearchEngine 的統一備份快照 (深拷貝)
 * 強制重新從底層 Storage 載入最新資料，確保不會讀取到跨視窗的過期記憶體快取
 * @param {Object} collectionStore 
 * @param {Object} searchEngineStore 
 * @returns {Promise<Object>}
 */
export async function createUnifiedBackup(collectionStore, searchEngineStore) {
  if (collectionStore && typeof collectionStore.exportSnapshot === 'function') {
    return await collectionStore.exportSnapshot(searchEngineStore);
  }

  // Fallback 相容非標準 Store 實例
  if (collectionStore && typeof collectionStore.load === 'function') {
    await collectionStore.load();
  }
  if (searchEngineStore && typeof searchEngineStore.load === 'function') {
    await searchEngineStore.load();
  }

  const collectionData = collectionStore ? collectionStore.exportData() : { items: [], tags: [] };
  const searchEngineData = searchEngineStore ? searchEngineStore.exportData() : { searchEngines: [] };

  return {
    version: 1,
    timestamp: Date.now(),
    items: JSON.parse(JSON.stringify(collectionData.items || [])),
    tags: JSON.parse(JSON.stringify(collectionData.tags || [])),
    searchEngines: JSON.parse(JSON.stringify(searchEngineData.searchEngines || []))
  };
}

/**
 * 復原統一備份資料至 CollectionStore 與 SearchEngineStore
 * @param {Object} payload 
 * @param {{ collectionStore: Object, searchEngineStore: Object }} stores 
 * @returns {Promise<{ success: boolean, restored?: Object, error?: string }>}
 */
export async function restoreUnifiedBackup(payload, { collectionStore, searchEngineStore } = {}) {
  if (collectionStore && typeof collectionStore.restoreSnapshot === 'function') {
    return await collectionStore.restoreSnapshot(payload, { searchEngineStore });
  }

  // Fallback 相容非標準 Store 實例
  const validation = validateBackupPayload(payload);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (collectionStore && typeof collectionStore.load === 'function') {
    await collectionStore.load();
  }
  if (searchEngineStore && typeof searchEngineStore.load === 'function') {
    await searchEngineStore.load();
  }

  const collSuccess = await collectionStore.importData(payload);
  if (!collSuccess) {
    return { success: false, error: 'Failed to import collections into collection store.' };
  }

  let searchEnginesCount = null;
  if (Array.isArray(payload.searchEngines) && searchEngineStore) {
    const seSuccess = await searchEngineStore.importData(payload);
    if (!seSuccess) {
      return { success: false, error: 'Failed to import search engines into search engine store.' };
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
 * 導出統一備份並透過 tabAdapter 觸發檔案下載 (移除 duck-typing 分支)
 * @param {Object} collectionStore 
 * @param {Object} searchEngineStore 
 * @param {Object} tabAdapter 
 * @param {string|null} customFilename 
 * @returns {Promise<{ success: boolean, filename: string, data: Object }>}
 */
export async function exportBackupFile(collectionStore, searchEngineStore, tabAdapter, customFilename = null) {
  if (collectionStore && typeof collectionStore.exportBackupFile === 'function') {
    return await collectionStore.exportBackupFile(tabAdapter, { filename: customFilename, searchEngineStore });
  }

  const backupData = await createUnifiedBackup(collectionStore, searchEngineStore);
  const todayStr = new Date().toISOString().split('T')[0];
  const filename = customFilename || `collection_backup_${todayStr}.json`;

  if (tabAdapter && typeof tabAdapter.downloadJson === 'function') {
    await tabAdapter.downloadJson(backupData, filename);
  }

  return {
    success: true,
    filename,
    data: backupData
  };
}
