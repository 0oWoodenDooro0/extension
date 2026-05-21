import { loadData } from './store.js';
import { initItemsView, displayItemsByTag, refreshItemsList } from './itemsView.js';
import { initAddItemView, showAddItemView, isEditingMode } from './addItemView.js';
import { initManageTagsView, showManageTagsView, displayManageTagList } from './manageTagsView.js';

document.addEventListener('DOMContentLoaded', async () => {
  // --- Elements (Layout) ---
  const itemsView = document.getElementById('itemsView');
  const addItemView = document.getElementById('addItemView');
  const manageTagsView = document.getElementById('manageTagsView');

  // Toolbar Buttons
  const manageTagsButton = document.getElementById('manageTagsButton');
  const addItemButton = document.getElementById('addItemButton');
  const exportButton = document.getElementById('exportButton');
  const importButton = document.getElementById('importButton');
  const fileInput = document.getElementById('fileInput');

  // --- Global Controller State ---
  let currentViewName = 'items'; // 'items', 'add', 'manage'

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
      displayMainLibrary(); // 關閉管理介面，回到主頁
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

  exportButton.addEventListener('click', exportData);
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', importData);


  // --- Navigation Logic ---

  function showView(viewToShow) {
    [itemsView, addItemView, manageTagsView].forEach(view => {
      if (view) {
        // [重要修改] 使用 'flex' 而不是 'block'，以確保 CSS flex-grow 生效
        view.style.display = view === viewToShow ? 'flex' : 'none';
      }
    });

    if (viewToShow === itemsView) currentViewName = 'items';
    else if (viewToShow === addItemView) currentViewName = 'add';
    else if (viewToShow === manageTagsView) currentViewName = 'manage';
  }

  function displayMainLibrary() {
    showView(itemsView);
    displayItemsByTag("All Items");
  }

  function handleAddEditFinished() {
    displayMainLibrary();
  }

  // --- Import/Export Logic ---
  function exportData() {
    import('./store.js').then(({ state }) => {
      const dataToExport = { items: state.items || [], tags: state.tags || [] };
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const filename = `collection_backup_${new Date().toISOString().split('T')[0]}.json`;
      chrome.downloads.download({ url: url, filename: filename, saveAs: true })
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
                displayMainLibrary();
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (currentViewName === 'manage') {
        displayManageTagList();
      } else if (currentViewName === 'items') {
        refreshItemsList();
      }
    }
  });

  // --- Initial Load ---
  try {
    await loadData();
    displayMainLibrary();
  } catch (e) {
    console.error("Failed to load data:", e);
  }
});
