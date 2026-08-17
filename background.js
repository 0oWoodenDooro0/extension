import { initializeSearchShortcuts } from './utils.js';
import { collectionStore } from './sidebar/store.js';

initializeSearchShortcuts();

/**
 * 安全解析絕對 URL
 * @param {string} rawUrl 
 * @param {string} baseUrl 
 * @returns {string}
 */
export function resolveImageUrl(rawUrl, baseUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl, baseUrl).href;
  } catch (e) {
    if (rawUrl.startsWith('/') && baseUrl) {
      try {
        const baseObj = new URL(baseUrl);
        return baseObj.origin + rawUrl;
      } catch (err) {
        return rawUrl;
      }
    }
    return rawUrl;
  }
}

/**
 * 從 HTML 字串解析 og:image 的 content 屬性，並將相對路徑轉為絕對 URL
 * @param {string} html 
 * @param {string} baseUrl 
 * @returns {string|null}
 */
export function extractOgImageFromHtml(html, baseUrl) {
  if (!html || typeof html !== 'string') return null;

  // 匹配 <meta property="og:image" content="..."> 或 <meta content="..." property="og:image">
  // 同時支援 property 或 name 屬性與各種屬性順序
  const ogImageRegex = /<meta\s+[^>]*?(?:property|name)=["']og:image["'][^>]*?content=["']([^"']+)["'][^>]*?>|<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?(?:property|name)=["']og:image["'][^>]*?>/i;
  const match = html.match(ogImageRegex);
  if (!match) return null;

  const rawUrl = (match[1] || match[2] || '').trim();
  if (!rawUrl) return null;

  return resolveImageUrl(rawUrl, baseUrl);
}

// 尋找主網域與路徑匹配的已開啟分頁，並直接注入腳本提取 og:image (支援 JS 動態渲染 DOM)
export async function getImageFromExistingTab(url) {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query || !chrome.scripting) {
      return null;
    }

    const tabs = await chrome.tabs.query({});
    const targetUrlObj = new URL(url);
    
    // 尋找與目標 URL 的 origin 與 pathname 匹配的分頁 (忽略 hash 與 query 差異以提高匹配率)
    const matchingTab = tabs.find(t => {
      try {
        const tabUrlObj = new URL(t.url);
        return tabUrlObj.origin === targetUrlObj.origin && tabUrlObj.pathname === targetUrlObj.pathname;
      } catch (e) {
        return false;
      }
    });

    if (matchingTab) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: matchingTab.id },
        func: () => {
          const metas = document.querySelectorAll("meta[property='og:image'], meta[name='og:image']");
          if (metas && metas.length > 0) {
            // 對於動態 SPA 網站，切換頁面後動態新增的最新 og:image 會排在最後面，因此取最後一個
            const meta = metas[metas.length - 1];
            if (meta && meta.content) {
              const content = meta.content.trim();
              try {
                return new URL(content, window.location.href).href;
              } catch (e) {
                if (content.startsWith('/')) {
                  return window.location.origin + content;
                }
                return content;
              }
            }
          }
          return null;
        }
      });
      return (results && results[0]) ? results[0].result : null;
    }
  } catch (error) {
    // 忽略錯誤以保持主控台乾淨
  }
  return null;
}

// 當未開啟分頁時，透過背景直接 fetch HTML 並解析 og:image (Fallback)
export async function fetchImageFromHtml(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 秒逾時保護
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const html = await response.text();
    return extractOgImageFromHtml(html, url);
  } catch (e) {
    // 忽略網路錯誤或逾時
    return null;
  }
}

// 統一圖片擷取流程：優先匹配開啟的分頁，未開啟則使用背景 Fetch Fallback
export async function getImageForUrl(url) {
  if (!url || typeof url !== 'string') return null;

  // 1. 優先從已開啟的分頁 DOM 中提取
  let imageUrl = await getImageFromExistingTab(url);
  if (imageUrl) return imageUrl;

  // 2. 若無匹配已開啟分頁，透過背景直接 fetch HTML 作為 Fallback
  imageUrl = await fetchImageFromHtml(url);
  return imageUrl;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 監聽側邊欄的 'getImage' 請求
    if (request.action === 'getImage' && request.url) {
      getImageForUrl(request.url)
        .then(imageUrl => {
          sendResponse({ imageUrl: imageUrl });
        })
        .catch(() => {
          sendResponse({ imageUrl: null });
        });

      // 異步回傳指示
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
 * 注入至網頁 DOM 中的浮動 Toast 提示函式
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
      // 忽略受保護網頁 (例如 chrome:// 頁面或 Chrome Web Store) 的腳本注入錯誤
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

