import { loadData } from './store.js';
import { renderTagsList } from './tagsView.js';
import { initItemsView, displayItemsByTag, refreshItemsList } from './itemsView.js';
import { initAddItemView, showAddItemView, isEditingMode } from './addItemView.js';
import { initManageTagsView, showManageTagsView, displayManageTagList } from './manageTagsView.js';

document.addEventListener('DOMContentLoaded', async () => {
  // --- Elements (Layout) ---
  const tagsView = document.getElementById('tagsView');
  const itemsView = document.getElementById('itemsView');
  const addItemView = document.getElementById('addItemView');
  const manageTagsView = document.getElementById('manageTagsView');

  // Toolbar Buttons
  const manageTagsButton = document.getElementById('manageTagsButton');
  const addItemButton = document.getElementById('addItemButton');
  const exportButton = document.getElementById('exportButton');
  const importButton = document.getElementById('importButton');
  const fileInput = document.getElementById('fileInput');
  const backButton = document.getElementById('backButton');

  // --- Global Controller State ---
  let currentViewName = 'tags'; // 'tags', 'items', 'add', 'manage'
  let currentTag = null; // 紀錄當前正在瀏覽的標籤 (如果有的話)

  // --- Initialization ---

  // 1. 初始化項目列表視圖
  initItemsView({
    onEditItem: (itemId) => {
      showView(addItemView);
      showAddItemView(itemId); // 進入編輯模式
    }
  });

  // 2. 初始化新增/編輯視圖
  initAddItemView({
    onSave: () => handleAddEditFinished(),
    onCancel: () => handleAddEditFinished(),
    onDelete: () => handleAddEditFinished()
  });

  // 3. 初始化標籤管理視圖
  initManageTagsView({
    onClose: () => {
      displayTags(); // 關閉管理介面，回到首頁
    }
  });


  // --- Event Listeners (Main Navigation) ---
  manageTagsButton.addEventListener('click', () => {
    showView(manageTagsView);
    showManageTagsView();
  });

  addItemButton.addEventListener('click', () => {
    showView(addItemView);
    showAddItemView(null); // 進入新增模式
  });

  backButton.addEventListener('click', () => {
    displayTags();
  });

  exportButton.addEventListener('click', exportData);
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', importData);


  // --- Navigation Logic ---

  function showView(viewToShow) {
    [tagsView, itemsView, addItemView, manageTagsView].forEach(view => {
      view.style.display = view === viewToShow ? 'block' : 'none';
    });

    if (viewToShow === tagsView) currentViewName = 'tags';
    else if (viewToShow === itemsView) currentViewName = 'items';
    else if (viewToShow === addItemView) currentViewName = 'add';
    else if (viewToShow === manageTagsView) currentViewName = 'manage';
  }

  function displayTags() {
    showView(tagsView);
    currentTag = null;
    renderTagsList((selectedTag) => {
      // Callback: 當使用者在標籤列表點擊某個標籤
      currentTag = selectedTag;
      showView(itemsView);
      displayItemsByTag(selectedTag);
    });
  }

  function handleAddEditFinished() {
    // 邏輯：如果是「編輯」現有項目，通常希望回到原本的列表
    // 如果是「新增」項目，原本的邏輯是回到 Tags 首頁，但也可以根據需求調整
    if (isEditingMode() && currentTag) {
      // 編輯模式且原本就在某個 Tag 下 -> 回到該 Tag 列表
      showView(itemsView);
      displayItemsByTag(currentTag);
    } else {
      // 新增模式或原本不在特定 Tag 下 -> 回到首頁
      displayTags();
    }
  }

  // --- Import/Export Logic ---
  // (這部分比較獨立，暫時保留在 Controller，如果要再拆分可以移到 utils.js)
  function exportData() {
    // 為了確保拿到最新資料，這裡可以再呼叫一次 browser.storage，或者直接用 store.js 的 export
    import('./store.js').then(({ state }) => {
      const dataToExport = { items: state.items || [], tags: state.tags || [] };
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const filename = `collection_backup_${new Date().toISOString().split('T')[0]}.json`;
      browser.downloads.download({ url: url, filename: filename, saveAs: true })
        .then(() => URL.revokeObjectURL(url), () => URL.revokeObjectURL(url));
    });
  }

  function importData(event) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedData = JSON.parse(e.target.result);
          if (importedData.items && importedData.tags) {
            if (confirm("Overwrite collections?")) {
              import('./store.js').then(({ state, saveData }) => {
                state.items = importedData.items;
                state.tags = importedData.tags;
                saveData();
                displayTags();
              });
            }
          } else { alert("Invalid format."); }
        } catch (err) { alert("Error reading file."); }
      };
      reader.readAsText(file);
    }
    fileInput.value = '';
  }

  // --- Storage Listener ---
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      // 當資料變更時，通知當前活躍的視圖進行更新
      if (currentViewName === 'manage') {
        displayManageTagList();
      } else if (currentViewName === 'items' && currentTag) {
        refreshItemsList();
      } else if (currentViewName === 'tags') {
        displayTags(); // 雖然 displayTags 會重繪，但在 tagsView 其實只需要呼叫 renderTagsList
      }
    }
  });

  // --- Initial Load ---
  try {
    await loadData();
    displayTags();
  } catch (e) {
    console.error("Failed to load data:", e);
  }
});
