// store.js - 負責管理應用程式的資料狀態與持久化

// 使用 state 物件來集中管理資料，方便其他模組引用
export const state = {
  items: [],
  tags: []
};

// 從瀏覽器儲存區載入資料
export function loadData() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['items', 'tags'], (data) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        // 更新 state 物件中的內容
        state.items = data.items || [];
        state.tags = data.tags || [];
        resolve(state);
      }
    });
  });
}

// 將資料存回瀏覽器儲存區
export function saveData() {
  return chrome.storage.local.set({
    items: state.items,
    tags: state.tags
  });
}

// 監聽 storage 變化 (同步多個視窗或是外部修改)
// 注意：這個監聽器只會收到"其他"上下文的變更，不會收到自己 set 的變更
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.items) state.items = changes.items.newValue || [];
    if (changes.tags) state.tags = changes.tags.newValue || [];
    // 注意：UI 的自動更新邏輯需要由 UI 層自己決定如何訂閱，
    // 在第一階段我們暫時透過 sidebar.js 內部的監聽器來處理 UI 重繪
  }
});

