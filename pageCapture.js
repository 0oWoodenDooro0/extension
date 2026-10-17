// pageCapture.js - 網頁擷取、封面圖解析與快速儲存深層模組 (Page Capture & Extraction Pipeline)
// 統一 DOM 注入與 HTML Regex 雙重圖片擷取規則，並將分頁查詢與腳本執行收斂至 TabAdapter 接縫

import { tabAdapter as defaultTabAdapter } from './tabAdapter.js';
import { collectionStore } from './sidebar/store.js';

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
 * 檢查是否為需排除的圖片 (SVG、追蹤像素、1x1、data: URI)
 * @param {string|null} src 
 * @returns {boolean}
 */
export function isIgnoredImage(src) {
  if (!src || typeof src !== 'string') return true;
  const s = src.toLowerCase().trim();
  if (s.startsWith('data:')) return true;
  if (s.endsWith('.svg') || s.includes('.svg?') || s.includes('.svg#')) return true;
  if (s.includes('pixel') || s.includes('1x1') || s.includes('spacer')) return true;
  return false;
}

/**
 * 從 HTML 字串中依序解析代表性封面圖 (5 階段優先序)
 * 1. og:image (支援 property 或 name)
 * 2. twitter:image (支援 name 或 property)
 * 3. link rel="image_src"
 * 4. link rel="apple-touch-icon"
 * 5. 第一張非排除之 <img> 標籤
 * @param {string} htmlText 
 * @param {string} pageUrl 
 * @returns {string|null}
 */
export function extractImageFromHtml(htmlText, pageUrl) {
  if (!htmlText || typeof htmlText !== 'string') return null;

  // 1. og:image (property or name)
  const ogMatch = htmlText.match(/<meta\s+[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                  htmlText.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i);
  if (ogMatch && ogMatch[1]) {
    return resolveUrl(ogMatch[1].trim(), pageUrl);
  }

  // 2. twitter:image (name or property)
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
  const appleIconMatch = htmlText.match(/<link\s+[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["']/i) ||
                         htmlText.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon(?:-precomposed)?["']/i);
  if (appleIconMatch && appleIconMatch[1]) {
    return resolveUrl(appleIconMatch[1].trim(), pageUrl);
  }

  // 5. 頁面第一個符合條件的 <img> 標籤 (排除 svg, tracking pixel, 1x1, data:)
  const imgMatches = htmlText.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi);
  for (const match of imgMatches) {
    const src = match[1]?.trim();
    const fullTag = match[0].toLowerCase();
    if (!src || isIgnoredImage(src) || fullTag.includes('pixel') || fullTag.includes('1x1') || fullTag.includes('spacer')) {
      continue;
    }
    return resolveUrl(src, pageUrl);
  }

  return null;
}

// 導出向後相容別名
export { resolveUrl as resolveImageUrl, extractImageFromHtml as extractOgImageFromHtml };

/**
 * 在 DOM 環境下依 5 階段優先序擷取代表性封面圖
 * @param {Document} [doc]
 * @returns {string|null}
 */
export function extractImageFromDom(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return null;

  function isIgnored(src, el) {
    if (!src || typeof src !== 'string') return true;
    const s = src.toLowerCase().trim();
    if (s.startsWith('data:')) return true;
    if (s.endsWith('.svg') || s.includes('.svg?') || s.includes('.svg#')) return true;
    if (s.includes('pixel') || s.includes('1x1') || s.includes('spacer')) return true;
    if (el) {
      const cls = (el.className || '').toLowerCase();
      if (cls.includes('pixel') || cls.includes('1x1') || cls.includes('spacer')) return true;
    }
    return false;
  }

  function resolve(rawUrl) {
    try {
      const base = doc.baseURI || (typeof location !== 'undefined' ? location.href : undefined);
      return new URL(rawUrl, base).href;
    } catch {
      return rawUrl;
    }
  }

  // 1. og:image (property or name)
  const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
  if (og && og.content && og.content.trim()) {
    return resolve(og.content.trim());
  }

  // 2. twitter:image (name or property)
  const twitter = doc.querySelector('meta[name="twitter:image"], meta[property="twitter:image"]');
  if (twitter && twitter.content && twitter.content.trim()) {
    return resolve(twitter.content.trim());
  }

  // 3. link rel="image_src"
  const imageSrc = doc.querySelector('link[rel="image_src"]');
  if (imageSrc && (imageSrc.href || imageSrc.getAttribute?.('href'))) {
    const href = imageSrc.href || imageSrc.getAttribute('href');
    if (href && href.trim()) return resolve(href.trim());
  }

  // 4. link rel="apple-touch-icon"
  const appleIcon = doc.querySelector('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
  if (appleIcon && (appleIcon.href || appleIcon.getAttribute?.('href'))) {
    const href = appleIcon.href || appleIcon.getAttribute('href');
    if (href && href.trim()) return resolve(href.trim());
  }

  // 5. first <img> that is not ignored
  const imgs = doc.querySelectorAll ? doc.querySelectorAll('article img, main img, img') : [];
  for (const img of imgs) {
    const src = img.currentSrc || img.src || (img.getAttribute && img.getAttribute('src'));
    if (src && !isIgnored(src, img)) {
      return resolve(src.trim());
    }
  }

  return null;
}

/**
 * 透過 fetch 獲取指定 URL 的 HTML 並解析代表性圖片 (Fallback 機制)
 * @param {string} pageUrl 
 * @param {Object} options 
 * @returns {Promise<string|null>}
 */
export async function fetchImageFromHtml(pageUrl, { fetchImpl = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
  if (!pageUrl || typeof fetchImpl !== 'function') return null;

  try {
    const response = await fetchImpl(pageUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
    });

    if (!response || !response.ok) return null;
    const htmlText = await response.text();
    return extractImageFromHtml(htmlText, pageUrl);
  } catch (err) {
    return null;
  }
}

/**
 * 取得指定 URL 的代表性圖片 (優先查詢已開啟分頁 DOM，失敗或無分頁時使用 fetch Fallback)
 * @param {string} url 
 * @param {Object} options 
 * @returns {Promise<string|null>}
 */
export async function getImageForUrl(url, { tabAdapter = defaultTabAdapter, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
  if (!url) return null;

  // 1. 優先嘗試透過 tabAdapter 查詢已開啟分頁並執行 DOM 擷取
  try {
    if (tabAdapter && typeof tabAdapter.findTabByUrl === 'function') {
      const matchedTab = await tabAdapter.findTabByUrl(url);
      if (matchedTab && matchedTab.id && typeof tabAdapter.executeScript === 'function') {
        try {
          const results = await tabAdapter.executeScript({
            target: { tabId: matchedTab.id },
            func: extractImageFromDom
          });
          if (results && results[0] && results[0].result) {
            return results[0].result;
          }
        } catch (err) {
          // ignore tab script execution error and fallback to fetch
        }
      }
    }
  } catch (err) {
    // ignore tab query error and fallback
  }

  // 2. Fallback: 透過 fetch 取得 HTML
  return await fetchImageFromHtml(url, { fetchImpl });
}

/**
 * 檢查是否為可收藏的一般網頁 URL (排除 chrome://, about:, file:// 等)
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
 * 顯示保存成功的視覺反饋 (委派至 tabAdapter)
 * @param {Object} tab 
 * @param {Object} options 
 * @param {BrowserTabAdapter} [tabAdapter]
 */
export async function showSaveFeedback(tab, { isExisting = false, title = '' } = {}, tabAdapter = defaultTabAdapter) {
  if (tabAdapter && typeof tabAdapter.showSaveFeedback === 'function') {
    return await tabAdapter.showSaveFeedback(tab, { isExisting, title });
  }
  return false;
}

/**
 * 從分頁物件中提取中繼資料並比對既有項目 (供 background 快速儲存與 sidebar 預填共用)
 * @param {Object|null} tab 
 * @param {Object} options 
 * @returns {Promise<Object>}
 */
export async function captureTabMetadata(tab, {
  store = collectionStore,
  tabAdapter = defaultTabAdapter,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
  resolveCover = false
} = {}) {
  if (!tab || !isValidWebUrl(tab.url)) {
    return { valid: false, reason: 'invalid_url' };
  }

  let existingItem = null;
  if (store) {
    if (typeof store.load === 'function' && !store.isLoaded) {
      await store.load();
    }
    if (typeof store.getItemByUrl === 'function') {
      existingItem = store.getItemByUrl(tab.url);
    }
  }

  const title = (tab.title && tab.title.trim()) || existingItem?.title || tab.url;
  const tags = existingItem && Array.isArray(existingItem.tags) ? [...existingItem.tags] : [];
  const actors = existingItem && Array.isArray(existingItem.actors) ? [...existingItem.actors] : [];

  let imageUrl = existingItem && existingItem.imageUrl ? existingItem.imageUrl : null;
  if (!imageUrl && resolveCover) {
    imageUrl = await getImageForUrl(tab.url, { tabAdapter, fetchImpl });
  }

  return {
    valid: true,
    isExisting: !!existingItem,
    existingItem,
    title,
    url: tab.url,
    imageUrl,
    tags,
    actors
  };
}

/**
 * 快速儲存作用中分頁至 Collection (供快捷鍵、Context Menu 或外部呼叫)
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function quickSaveActiveTab({
  tab = null,
  store = collectionStore,
  tabAdapter = defaultTabAdapter,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
  feedback = true
} = {}) {
  let targetTab = tab;
  if (!targetTab && tabAdapter && typeof tabAdapter.getActiveTab === 'function') {
    targetTab = await tabAdapter.getActiveTab();
  }

  const metadata = await captureTabMetadata(targetTab, {
    store,
    tabAdapter,
    fetchImpl,
    resolveCover: true
  });

  if (!metadata.valid) {
    return { success: false, reason: metadata.reason };
  }

  if (store && typeof store.load === 'function' && !store.isLoaded) {
    await store.load();
  }

  const savedItem = await store.saveItem({
    id: metadata.existingItem ? metadata.existingItem.id : undefined,
    title: metadata.title,
    url: metadata.url,
    imageUrl: metadata.imageUrl || null,
    tags: metadata.tags,
    actors: metadata.actors
  });

  if (feedback && tabAdapter && typeof tabAdapter.showSaveFeedback === 'function') {
    await tabAdapter.showSaveFeedback(targetTab, {
      isExisting: metadata.isExisting,
      title: savedItem.title
    });
  }

  return {
    success: true,
    item: savedItem,
    isExisting: metadata.isExisting
  };
}

/**
 * 直接保存作用中分頁至 Collection (向後相容簽章)
 * @param {Object|null} tab 
 * @param {Object} store 
 * @param {Object} options 
 * @returns {Promise<Object>}
 */
export async function saveActiveTabDirectly(tab = null, store = collectionStore, options = {}) {
  return await quickSaveActiveTab({
    tab,
    store,
    ...options
  });
}
