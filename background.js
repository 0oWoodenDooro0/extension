import { initializeSearchShortcuts } from './utils.js'

initializeSearchShortcuts();


// This script acts as the central communicator.

// 尋找主網域與路徑匹配的已開啟分頁，並直接注入腳本提取 og:image (支援 JS 動態渲染 DOM)
async function getImageFromExistingTab(url) {
  try {
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
          const metas = document.querySelectorAll("meta[property='og:image']");
          if (metas && metas.length > 0) {
            // 對於動態 SPA 網站，切換頁面後動態新增的最新 og:image 會排在最後面，因此取最後一個
            const meta = metas[metas.length - 1];
            if (meta && meta.content) {
              let imageUrl = meta.content;
              if (imageUrl.startsWith('/')) {
                // 自動轉換為絕對路徑
                imageUrl = window.location.origin + imageUrl;
              }
              return imageUrl;
            }
          }
          return null;
        }
      });
      return (results && results[0]) ? results[0].result : null;
    }
  } catch (error) {
    // 忽略錯誤以保持主控台完全乾淨
  }
  return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 監聽側邊欄的 'getImage' 請求
  if (request.action === 'getImage' && request.url) {
    getImageFromExistingTab(request.url).then(imageUrl => {
      sendResponse({ imageUrl: imageUrl });
    });

    // 異步回傳指示
    return true;
  }
});


