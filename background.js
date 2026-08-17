import { initializeSearchShortcuts } from './utils.js';

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
