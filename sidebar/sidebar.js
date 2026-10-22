import { collectionStore, ChromeStorageAdapter } from './store.js';
import { searchEngineStore } from '../searchEngineStore.js';
import { tabAdapter } from '../tabAdapter.js';
import { GoogleDriveAdapter } from './googleDriveAdapter.js';
import { SyncCoordinator } from './syncCoordinator.js';
import { initCloudSyncView } from './cloudSyncView.js';
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

  // --- Cloud Sync Setup ---
  const storageAdapter = new ChromeStorageAdapter();
  const googleDriveAdapter = new GoogleDriveAdapter({
    storage: storageAdapter
  });
  const syncCoordinator = new SyncCoordinator({
    cloudAdapter: googleDriveAdapter,
    collectionStore,
    searchEngineStore,
    storage: storageAdapter
  });
  await syncCoordinator.init();

  // 建立生命週期長連線至 background.js，當關閉側邊欄或瀏覽器時自動觸發背景 Flush Sync
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function') {
    try {
      chrome.runtime.connect({ name: 'sidebar-lifecycle' });
    } catch {
      // ignore
    }
  }

  // 當頁面隱藏或關閉時，主動通知背景立即保存未同步的變更 (Flush Sync)
  const handleCloseFlush = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      try {
        chrome.runtime.sendMessage({ action: 'flushSync' }, () => {
          if (chrome.runtime.lastError) {
            syncCoordinator.flushPendingSync().catch(() => {});
          }
        });
        return;
      } catch {
        // fallback below
      }
    }
    syncCoordinator.flushPendingSync().catch(() => {});
  };

  window.addEventListener('pagehide', handleCloseFlush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      handleCloseFlush();
    }
  });

  initCloudSyncView({
    googleDriveAdapter,
    syncCoordinator,
    onSyncComplete: () => {
      displayMainLibrary();
    },
    onClose: () => {}
  });

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
    await collectionStore.exportBackupFile(tabAdapter, { searchEngineStore });
  }

  async function importData(event) {
    const file = event.target.files && event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const importedData = JSON.parse(e.target.result);
          const validation = collectionStore.validateSnapshot(importedData);
          if (!validation.valid) {
            alert(`Failed to import backup: ${validation.error || 'Invalid format'}`);
            return;
          }

          const confirmMsg = validation.hasSearchEngines
            ? "Overwrite collections and search shortcuts?"
            : "Overwrite collections?";

          if (confirm(confirmMsg)) {
            const result = await collectionStore.restoreSnapshot(importedData, { searchEngineStore });
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

  // --- Initial Load & Startup Auto-Login Sync ---
  try {
    await collectionStore.load();
    displayMainLibrary();

    // 每次開啟側邊欄時，若已綁定雲端帳號則自動登入並執行 3-Way Sync
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      chrome.runtime.sendMessage(
        { action: 'autoLoginAndSync', allowInteractiveFallback: true },
        (res) => {
          if (chrome.runtime.lastError || !res) {
            syncCoordinator.autoLoginAndSync({ allowInteractiveFallback: true }).catch(() => {});
          }
        }
      );
    } else {
      syncCoordinator.autoLoginAndSync({ allowInteractiveFallback: true }).catch(() => {});
    }
  } catch (e) {
    console.error("Failed to load data:", e);
  }
});
