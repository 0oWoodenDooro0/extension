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

  if (payload.identifierRules !== undefined && !Array.isArray(payload.identifierRules)) {
    return { valid: false, error: 'Invalid backup format: identifierRules must be an array when present.' };
  }

  return { valid: true, error: null };
}

/**
 * 生成包含 Collection、SearchEngine 與 IdentifierRule 的統一備份快照 (深拷貝)
 * 強制重新從底層 Storage 載入最新資料，確保不會讀取到跨視窗的過期記憶體快取
 * @param {Object} collectionStore 
 * @param {Object} searchEngineStore 
 * @param {Object} [identifierRuleStore=null]
 * @returns {Promise<Object>}
 */
export async function createUnifiedBackup(collectionStore, searchEngineStore, identifierRuleStore = null) {
  if (collectionStore && typeof collectionStore.load === 'function') {
    await collectionStore.load();
  }
  if (searchEngineStore && typeof searchEngineStore.load === 'function') {
    await searchEngineStore.load();
  }
  if (identifierRuleStore && typeof identifierRuleStore.load === 'function') {
    await identifierRuleStore.load();
  }

  const collectionData = collectionStore ? collectionStore.exportData() : { items: [], tags: [] };
  const searchEngineData = searchEngineStore ? searchEngineStore.exportData() : { searchEngines: [] };
  const identifierRuleData = identifierRuleStore ? identifierRuleStore.exportData() : { identifierRules: [] };

  return {
    version: 1,
    items: JSON.parse(JSON.stringify(collectionData.items || [])),
    tags: JSON.parse(JSON.stringify(collectionData.tags || [])),
    searchEngines: JSON.parse(JSON.stringify(searchEngineData.searchEngines || [])),
    identifierRules: JSON.parse(JSON.stringify(identifierRuleData.identifierRules || []))
  };
}

/**
 * 復原統一備份資料至 CollectionStore、SearchEngineStore 與 IdentifierRuleStore
 * @param {Object} payload 
 * @param {{ collectionStore: Object, searchEngineStore: Object, identifierRuleStore?: Object }} stores 
 * @returns {Promise<{ success: boolean, restored?: Object, error?: string }>}
 */
export async function restoreUnifiedBackup(payload, { collectionStore, searchEngineStore, identifierRuleStore = null }) {
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
  if (identifierRuleStore && typeof identifierRuleStore.load === 'function') {
    await identifierRuleStore.load();
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

  let identifierRulesCount = null;
  if (Array.isArray(payload.identifierRules) && identifierRuleStore) {
    const irSuccess = await identifierRuleStore.importData(payload);
    if (!irSuccess) {
      return { success: false, error: 'Failed to import identifier rules into identifier rule store.' };
    }
    identifierRulesCount = payload.identifierRules.length;
  }

  const restored = {
    itemsCount: payload.items.length,
    tagsCount: payload.tags.length,
    searchEnginesCount
  };
  if (identifierRulesCount !== null) {
    restored.identifierRulesCount = identifierRulesCount;
  }

  return {
    success: true,
    restored
  };
}

/**
 * 導出統一備份並透過 tabAdapter 觸發檔案下載
 * @param {Object} collectionStore 
 * @param {Object} searchEngineStore 
 * @param {Object} tabAdapter 
 * @param {string|null} customFilename 
 * @param {Object} [identifierRuleStore=null]
 * @returns {Promise<{ success: boolean, filename: string, data: Object }>}
 */
export async function exportBackupFile(
  collectionStore,
  searchEngineStore,
  tabAdapter,
  customFilename = null,
  identifierRuleStore = null
) {
  let resolvedFilename = customFilename;
  let resolvedRuleStore = identifierRuleStore;
  if (customFilename && typeof customFilename === 'object' && !identifierRuleStore) {
    resolvedRuleStore = customFilename;
    resolvedFilename = null;
  }

  const backupData = await createUnifiedBackup(collectionStore, searchEngineStore, resolvedRuleStore);
  const todayStr = new Date().toISOString().split('T')[0];
  const filename = resolvedFilename || `collection_backup_${todayStr}.json`;

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
