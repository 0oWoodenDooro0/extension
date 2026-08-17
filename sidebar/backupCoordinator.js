// backupCoordinator.js - 統一備份協調模組 (Unified Backup Coordinator)
// 封裝書籤項目、標籤以及快捷搜尋引擎的統一導出、校驗與復原邏輯

/**
 * 校驗備份資料結構是否合法
 * @param {any} payload 
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateBackupPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Invalid backup format: payload must be a non-null object.' };
  }

  if (!Array.isArray(payload.items)) {
    return { valid: false, error: 'Invalid backup format: items must be an array.' };
  }

  if (!Array.isArray(payload.tags)) {
    return { valid: false, error: 'Invalid backup format: tags must be an array.' };
  }

  if (payload.searchEngines !== undefined && !Array.isArray(payload.searchEngines)) {
    return { valid: false, error: 'Invalid backup format: searchEngines must be an array when present.' };
  }

  return { valid: true, error: null };
}

/**
 * 生成包含 Collection 與 SearchEngine 的統一備份快照 (深拷貝)
 * @param {Object} collectionStore 
 * @param {Object} searchEngineStore 
 * @returns {Promise<Object>}
 */
export async function createUnifiedBackup(collectionStore, searchEngineStore) {
  if (collectionStore && !collectionStore.isLoaded && typeof collectionStore.load === 'function') {
    await collectionStore.load();
  }
  if (searchEngineStore && !searchEngineStore.isLoaded && typeof searchEngineStore.load === 'function') {
    await searchEngineStore.load();
  }

  const collectionData = collectionStore ? collectionStore.exportData() : { items: [], tags: [] };
  const searchEngineData = searchEngineStore ? searchEngineStore.exportData() : { searchEngines: [] };

  return {
    version: 1,
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
export async function restoreUnifiedBackup(payload, { collectionStore, searchEngineStore }) {
  const validation = validateBackupPayload(payload);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (collectionStore && !collectionStore.isLoaded && typeof collectionStore.load === 'function') {
    await collectionStore.load();
  }
  if (searchEngineStore && !searchEngineStore.isLoaded && typeof searchEngineStore.load === 'function') {
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
 * 導出統一備份並透過 tabAdapter 觸發檔案下載
 * @param {Object} collectionStore 
 * @param {Object} searchEngineStore 
 * @param {Object} tabAdapter 
 * @param {string|null} customFilename 
 * @returns {Promise<{ success: boolean, filename: string, data: Object }>}
 */
export async function exportBackupFile(collectionStore, searchEngineStore, tabAdapter, customFilename = null) {
  const backupData = await createUnifiedBackup(collectionStore, searchEngineStore);
  const todayStr = new Date().toISOString().split('T')[0];
  const filename = customFilename || `collection_backup_${todayStr}.json`;

  if (tabAdapter && typeof tabAdapter.downloadJson === 'function') {
    await tabAdapter.downloadJson(backupData, filename);
  } else if (tabAdapter && typeof tabAdapter.download === 'function') {
    await tabAdapter.download({
      content: JSON.stringify(backupData, null, 2),
      filename,
      mimeType: 'application/json'
    });
  }

  return {
    success: true,
    filename,
    data: backupData
  };
}
