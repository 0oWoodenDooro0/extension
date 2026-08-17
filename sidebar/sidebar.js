import { collectionStore } from './store.js';
import { searchEngineStore } from '../searchEngineStore.js';
import { tabAdapter } from '../tabAdapter.js';
import { exportBackupFile, restoreUnifiedBackup } from './backupCoordinator.js';
import { initItemsView, displayItemsByTag, refreshItemsList } from './itemsView.js';
import { initAddItemView, showAddItemView } from './addItemView.js';
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
  if (manageTagsButton) {
    manageTagsButton.addEventListener('click', () => {
      showView(manageTagsView);
      showManageTagsView();
    });
  }

  if (addItemButton) {
    addItemButton.addEventListener('click', () => {
      showView(addItemView);
      showAddItemView(null); // 進入新增模式
    });
  }

  if (exportButton) exportButton.addEventListener('click', exportData);
  if (importButton) importButton.addEventListener('click', () => fileInput && fileInput.click());
  if (fileInput) fileInput.addEventListener('change', importData);

  // --- Navigation Logic ---

  function showView(viewToShow) {
    [itemsView, addItemView, manageTagsView].forEach(view => {
      if (view) {
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
  async function exportData() {
    await exportBackupFile(collectionStore, searchEngineStore, tabAdapter);
  }

  async function importData(event) {
    const file = event.target.files && event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const importedData = JSON.parse(e.target.result);
          const hasSearchEngines = importedData && Array.isArray(importedData.searchEngines);
          const confirmMsg = hasSearchEngines
            ? "Overwrite collections and search shortcuts?"
            : "Overwrite collections?";

          if (confirm(confirmMsg)) {
            const result = await restoreUnifiedBackup(importedData, { collectionStore, searchEngineStore });
            if (result.success) {
              displayMainLibrary();
            } else {
              alert(`Failed to import backup: ${result.error || 'Invalid format'}`);
            }
          }
        } catch (err) {
          alert("Error reading backup file.");
        }
      };
      reader.readAsText(file);
    }
    if (fileInput) fileInput.value = '';
  }

  // --- Store Subscription (Multi-window sync and internal event listener) ---
  collectionStore.subscribe((event) => {
    if (currentViewName === 'manage') {
      displayManageTagList();
    } else if (currentViewName === 'items') {
      refreshItemsList();
    }
  });

  // --- Initial Load ---
  try {
    await collectionStore.load();
    displayMainLibrary();
  } catch (e) {
    console.error("Failed to load data:", e);
  }
});
