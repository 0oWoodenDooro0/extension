import { searchEngineStore, initializeSearchShortcuts } from './searchEngineStore.js';
import { collectionStore, ChromeStorageAdapter } from './sidebar/store.js';
import { GoogleDriveAdapter } from './sidebar/googleDriveAdapter.js';
import { SyncCoordinator } from './sidebar/syncCoordinator.js';

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

// 2. 監聽 Extension 頁面 (Sidebar / Popup) 生命週期連線：關閉時立即自動保存 (Flush Sync)
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

/**
 * 安全解析絕對 URL
 * @param {string} rawUrl 
 * @param {string} baseUrl 
 * @returns {string}
 */
export function resolveUrl(rawUrl, baseUrl) {
  try {
    return new URL(rawUrl, baseUrl).href;
  } catch {
    return rawUrl;
  }
}

/**
 * 輔助方法：從 HTML 字串中依序解析 Open Graph / Twitter / Link Rel / First Img
 * @param {string} htmlText 
 * @param {string} pageUrl 
 * @returns {string|null}
 */
export function extractImageFromHtml(htmlText, pageUrl) {
  if (!htmlText || typeof htmlText !== 'string') return null;

  // 1. og:image (支援 property 或 name 屬性)
  const ogMatch = htmlText.match(/<meta\s+[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                  htmlText.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i);
  if (ogMatch && ogMatch[1]) {
    return resolveUrl(ogMatch[1].trim(), pageUrl);
  }

  // 2. twitter:image (支援 name 或 property 屬性)
  const twitterMatch = htmlText.match(/<meta\s+[^>]*(?:name|property)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
                       htmlText.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']twitter:image["']/i);
  if (twitterMatch && twitterMatch[1]) {
    return resolveUrl(twitterMatch[1].trim(), pageUrl);
  }

  // 3. link rel="image_src"
  const imageSrcMatch = htmlText.match(/<link\s+[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i) ||
                        htmlText.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']image_src["']/i);
  if (imageSrcMatch && imageSrcMatch[1]) {
    return resolveUrl(imageSrcMatch[1].trim(), pageUrl);
  }

  // 4. link rel="apple-touch-icon"
  const appleIconMatch = htmlText.match(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i) ||
                         htmlText.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon["']/i);
  if (appleIconMatch && appleIconMatch[1]) {
    return resolveUrl(appleIconMatch[1].trim(), pageUrl);
  }

  // 5. 頁面第一個符合條件的 <img> 標籤 (排除常見小圖示/追蹤像素)
  const imgMatches = htmlText.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi);
  for (const match of imgMatches) {
    const src = match[1]?.trim();
    if (!src) continue;
    // 排除 svg, tracking pixel, data:image
    if (src.startsWith('data:') || src.endsWith('.svg') || src.includes('pixel') || src.includes('1x1')) {
      continue;
    }
    return resolveUrl(src, pageUrl);
  }

  return null;
}

// 導出向後相容別名供既有模組與測試使用
export { resolveUrl as resolveImageUrl, extractImageFromHtml as extractOgImageFromHtml };

/**
 * 透過背景 fetch 獲取指定 URL 的 HTML 並解析代表性圖片 (Fallback 機制)
 * @param {string} pageUrl 
 * @returns {Promise<string|null>}
 */
export async function fetchImageFromHtml(pageUrl) {
  try {
    const response = await fetch(pageUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(5000) // 5 秒逾時保護
    });

    if (!response.ok) return null;
    const htmlText = await response.text();
    return extractImageFromHtml(htmlText, pageUrl);
  } catch (err) {
    console.warn(`[Background] Failed to fetch HTML for ${pageUrl}:`, err.message);
    return null;
  }
}

/**
 * 取得指定 URL 的代表性圖片 (優先查詢已開啟的分頁 DOM，失敗則使用 fetch Fallback)
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
export async function getImageForUrl(url) {
  if (!url) return null;

  let imageUrl = null;

  // 1. 優先嘗試比對目前所有開啟的分頁
  try {
    const tabs = await chrome.tabs.query({});
    const matchedTab = tabs.find(t => t.url === url);

    if (matchedTab && matchedTab.id) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: matchedTab.id },
          func: () => {
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) return ogImage.content;
            const twitterImage = document.querySelector('meta[name="twitter:image"]');
            if (twitterImage && twitterImage.content) return twitterImage.content;
            const linkImage = document.querySelector('link[rel="image_src"]');
            if (linkImage && linkImage.href) return linkImage.href;
            const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
            if (appleIcon && appleIcon.href) return appleIcon.href;
            const firstImg = document.querySelector('article img, main img, img');
            if (firstImg && firstImg.src && !firstImg.src.startsWith('data:')) return firstImg.src;
            return null;
          }
        });

        if (results && results[0] && results[0].result) {
          imageUrl = results[0].result;
          return imageUrl;
        }
      } catch (err) {
        console.warn(`[Background] executeScript failed on tab ${matchedTab.id}:`, err.message);
      }
    }
  } catch (tabsErr) {
    console.warn('[Background] tabs.query failed:', tabsErr.message);
  }

  // 2. 若無匹配已開啟分頁，透過背景直接 fetch HTML 作為 Fallback
  imageUrl = await fetchImageFromHtml(url);
  return imageUrl;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== 'object') return false;

    // 監聽側邊欄的 'getImage' 請求
    if (request.action === 'getImage' && request.url) {
      getImageForUrl(request.url)
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

/**
 * 檢查是否為可收藏的一般網頁 URL (排除 chrome://, about:, file:// 等非 http/https 頁面)
 * @param {string} url 
 * @returns {boolean}
 */
export function isValidWebUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * 注入至網頁 DOM 中的浮動 Toast 提示函數
 * @param {string} message 
 * @param {boolean} isExisting 
 */
export function inPageToast(message, isExisting) {
  const TOAST_ID = '__collection_ext_toast__';
  const existingToast = document.getElementById(TOAST_ID);
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.innerText = message;

  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    padding: '10px 18px',
    background: isExisting ? 'rgba(30, 64, 175, 0.94)' : 'rgba(16, 185, 129, 0.94)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.1)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    opacity: '0',
    transform: 'translateY(-10px) scale(0.96)',
    pointerEvents: 'none'
  });

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px) scale(0.96)';
    setTimeout(() => toast.remove(), 260);
  }, 2000);
}

/**
 * 顯示保存成功的視覺反饋 (Badge 圖示與網頁內嵌 Toast)
 * @param {Object} tab 
 * @param {Object} options 
 */
export async function showSaveFeedback(tab, { isExisting = false, title = '' } = {}) {
  if (!tab || !tab.id) return;

  // 1. 擴充圖示 Badge 提示
  if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setBadgeText) {
    try {
      chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({
        color: isExisting ? '#2563EB' : '#10B981',
        tabId: tab.id
      });
      setTimeout(() => {
        try {
          chrome.action.setBadgeText({ text: '', tabId: tab.id });
        } catch (e) {}
      }, 2000);
    } catch (e) {}
  }

  // 2. 網頁內嵌浮動 Toast HUD 提示
  if (typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
    try {
      const displayTitle = title ? (title.length > 32 ? title.slice(0, 32) + '...' : title) : 'Page';
      const msg = isExisting ? `✓ 已更新收藏：${displayTitle}` : `✓ 已收藏至 Collection：${displayTitle}`;

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: inPageToast,
        args: [msg, isExisting]
      });
    } catch (e) {
      // 忽略受保護網頁的腳本注入錯誤
    }
  }
}

/**
 * 直接保存作用中分頁至 Collection (供快捷鍵或 Context Menu 呼叫)
 * @param {Object|null} tab - 目標分頁物件，為空時自動查詢當前作用中分頁
 * @param {Object} store - CollectionStore 實例
 * @returns {Promise<Object>}
 */
export async function saveActiveTabDirectly(tab = null, store = collectionStore) {
  let targetTab = tab;
  if (!targetTab && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTab = tabs && tabs[0] ? tabs[0] : null;
  }

  if (!targetTab || !isValidWebUrl(targetTab.url)) {
    return { success: false, reason: 'invalid_url' };
  }

  if (!store.isLoaded) {
    await store.load();
  }

  const existingItem = store.getItemByUrl(targetTab.url);
  const imageUrl = (existingItem && existingItem.imageUrl)
    ? existingItem.imageUrl
    : await getImageForUrl(targetTab.url);

  const title = (targetTab.title && targetTab.title.trim()) || existingItem?.title || targetTab.url;

  const savedItem = await store.saveItem({
    id: existingItem ? existingItem.id : undefined,
    title: title,
    url: targetTab.url,
    imageUrl: imageUrl || null,
    tags: existingItem ? existingItem.tags : [],
    actors: existingItem ? existingItem.actors : []
  });

  await showSaveFeedback(targetTab, {
    isExisting: !!existingItem,
    title: savedItem.title
  });

  return {
    success: true,
    item: savedItem,
    isExisting: !!existingItem
  };
}

// 監聽鍵盤快捷鍵 (chrome.commands)
if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'save_active_tab') {
      try {
        await saveActiveTabDirectly();
      } catch (err) {
        console.error('[QuickSave] Error saving active tab:', err);
      }
    }
  });
}
