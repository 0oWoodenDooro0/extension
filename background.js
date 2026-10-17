import { initializeSearchShortcuts } from './utils.js';
import { collectionStore, ChromeStorageAdapter } from './sidebar/store.js';
import { searchEngineStore } from './searchEngineStore.js';
import { GoogleDriveAdapter } from './sidebar/googleDriveAdapter.js';
import { SyncCoordinator } from './sidebar/syncCoordinator.js';
import { tabAdapter as defaultTabAdapter } from './tabAdapter.js';
import {
  resolveUrl,
  isIgnoredImage,
  extractImageFromHtml,
  resolveImageUrl,
  extractOgImageFromHtml,
  extractImageFromDom,
  fetchImageFromHtml,
  getImageForUrl,
  isValidWebUrl,
  inPageToast,
  showSaveFeedback,
  captureTabMetadata,
  quickSaveActiveTab,
  saveActiveTabDirectly
} from './pageCapture.js';

// 重新匯出所有網頁擷取、封面圖解析與快速儲存方法，維持 100% 向後相容
export {
  resolveUrl,
  isIgnoredImage,
  extractImageFromHtml,
  resolveImageUrl,
  extractOgImageFromHtml,
  extractImageFromDom,
  fetchImageFromHtml,
  getImageForUrl,
  isValidWebUrl,
  inPageToast,
  showSaveFeedback,
  captureTabMetadata,
  quickSaveActiveTab,
  saveActiveTabDirectly
};

initializeSearchShortcuts();

// --- Background Cloud Sync Coordinator Setup ---
const bgStorageAdapter = new ChromeStorageAdapter();
export const bgGoogleDriveAdapter = new GoogleDriveAdapter({
  storage: bgStorageAdapter
});
export const bgSyncCoordinator = new SyncCoordinator({
  cloudAdapter: bgGoogleDriveAdapter,
  collectionStore,
  searchEngineStore,
  storage: bgStorageAdapter,
  autoSyncDebounceMs: 3000
});

/**
 * 初始化背景自動登入與自動同步生命週期管理 (選項A：關閉與啟動時自動同步，平時不執行防抖排程)
 * @param {SyncCoordinator} coordinator
 * @param {Object} storageAdapter
 */
export async function initializeBackgroundSync(
  coordinator = bgSyncCoordinator,
  storageAdapter = bgStorageAdapter
) {
  await coordinator.init();

  // 監聽跨視窗 (Sidebar / Popup) 對本地儲存的異動，僅標記 dirty，不排程倒數同步
  // 避免平時打字或編輯時觸發多程序快取競爭或刪除剛新增的項目
  if (storageAdapter && typeof storageAdapter.onChanged === 'function') {
    storageAdapter.onChanged(async (changes) => {
      if (coordinator.isApplyingRemoteSync) return;
      if (changes.sync_in_progress && changes.sync_in_progress.newValue === true) return;

      const hasDataChange = Boolean(changes.items || changes.tags || changes.searchEngines);
      if (!hasDataChange) return;

      await coordinator.markDirty();
    });
  }
}

initializeBackgroundSync().catch((err) => {
  console.error('[BackgroundSync] Initialization error:', err);
});

// 1. 瀏覽器啟動時：自動登入並執行 3-Way Sync
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    bgSyncCoordinator.autoLoginAndSync({ allowInteractiveFallback: true }).catch((err) => {
      console.error('[BackgroundSync] Startup auto-sync error:', err);
    });
  });
}

// 2. 監聽 Extension 頁面 (Sidebar / Popup) 生命周期連線：關閉時立即自動保存 (Flush Sync)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidebar-lifecycle' || port.name === 'popup-lifecycle') {
      port.onDisconnect.addListener(() => {
        bgSyncCoordinator.flushPendingSync().catch((err) => {
          console.error(`[BackgroundSync] Flush sync on ${port.name} close error:`, err);
        });
      });
    }
  });
}

// 3. 監聽瀏覽器視窗關閉：當視窗關閉或最後一個視窗關閉時立即自動保存
if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener(() => {
    bgSyncCoordinator.flushPendingSync().catch((err) => {
      console.error('[BackgroundSync] Flush sync on window close error:', err);
    });
  });
}

// 4. 監聽背景 Service Worker 休眠/瀏覽器關閉前事件：立即保存未同步變更
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    bgSyncCoordinator.flushPendingSync().catch((err) => {
      console.error('[BackgroundSync] Flush sync on suspend error:', err);
    });
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== 'object') return false;

    // 監聽側邊欄的 'getImage' 請求
    if (request.action === 'getImage' && request.url) {
      getImageForUrl(request.url, { tabAdapter: defaultTabAdapter })
        .then(imageUrl => {
          sendResponse({ imageUrl: imageUrl });
        })
        .catch(() => {
          sendResponse({ imageUrl: null });
        });

      return true;
    }

    // 監聽開啟時自動登入與同步請求
    if (request.action === 'autoLoginAndSync') {
      bgSyncCoordinator
        .autoLoginAndSync({
          allowInteractiveFallback:
            request.allowInteractiveFallback !== undefined ? request.allowInteractiveFallback : true
        })
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // 監聽關閉時立即保存 (Flush Sync) 請求
    if (request.action === 'flushSync') {
      bgSyncCoordinator
        .flushPendingSync({ force: !!request.force })
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });
}

// 監聽鍵盤快捷鍵 (chrome.commands)
if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'save_active_tab') {
      try {
        await saveActiveTabDirectly(null, collectionStore, { tabAdapter: defaultTabAdapter });
      } catch (err) {
        console.error('[QuickSave] Error saving active tab:', err);
      }
    }
  });
}
