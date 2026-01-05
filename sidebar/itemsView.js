// itemsView.js - 負責渲染項目列表、處理搜尋、過濾、右鍵選單
import { state, saveData } from './store.js';

// --- Local State for this view ---
let currentTag = "All Items"; // 預設為 All Items
let activeFilters = [];
let currentActorFilter = "";

// --- DOM Elements ---
let itemList, itemSearchInput, tagFilterContainer;
let actorFilterContainer, actorFilterInput, actorFilterDatalist;
let callbacks = {};

/**
 * 初始化項目視圖 (綁定事件監聽器)
 */
export function initItemsView(injectedCallbacks) {
  callbacks = injectedCallbacks;

  itemList = document.getElementById('itemList');
  // Removed: itemTitle = document.getElementById('itemTitle'); 
  itemSearchInput = document.getElementById('itemSearchInput');
  tagFilterContainer = document.getElementById('tagFilterContainer');
  actorFilterContainer = document.getElementById('actorFilterContainer');
  actorFilterInput = document.getElementById('actorFilterInput');
  actorFilterDatalist = document.getElementById('actorFilterDatalist');

  // 綁定搜尋框事件
  itemSearchInput.addEventListener('input', () => refreshItemsList());

  const clearSearchButton = document.getElementById('clearSearchButton');
  clearSearchButton.addEventListener('click', () => {
    itemSearchInput.value = '';
    refreshItemsList();
  });

  // 綁定演員過濾事件
  actorFilterInput.addEventListener('input', (e) => {
    currentActorFilter = e.target.value.trim();
    refreshItemsList();
  });

  // 綁定全域點擊以關閉右鍵選單
  document.addEventListener('click', removeCustomContextMenu);

  // 綁定工具列按鈕 (確保 HTML 中有這些 ID)
  const randomBtn = document.getElementById('randomButton');
  if (randomBtn) randomBtn.addEventListener('click', randomItem);

  // Open All 被移除了或需要移到其他地方，這裡暫時保留邏輯，如果 HTML 有按鈕就會運作
  const openAllBtn = document.getElementById('openAllButton');
  if (openAllBtn) openAllBtn.addEventListener('click', openAllItems);
}

/**
 * 顯示項目 (現在主要用於重置過濾器或初始化)
 * @param {String} tag - 永遠傳入 "All Items"
 */
export function displayItemsByTag(tag) {
  currentTag = tag;

  // 更新過濾器 UI
  populateTagFilterBar();
  populateActorFilterOptions();

  refreshItemsList();
}

/**
 * 重新渲染列表 (當數據變更或搜尋條件變更時呼叫)
 */
export function refreshItemsList() {
  renderFilteredList();
}

// --- Internal Helper Functions ---

function populateActorFilterOptions() {
  const allActorsSet = new Set();
  state.items.forEach(item => {
    if (item.actors && Array.isArray(item.actors)) {
      item.actors.forEach(a => allActorsSet.add(a));
    }
  });
  const allActors = [...allActorsSet].sort();

  if (actorFilterDatalist) {
    actorFilterDatalist.innerHTML = '';
    allActors.forEach(actor => {
      const option = document.createElement('option');
      option.value = actor;
      actorFilterDatalist.appendChild(option);
    });
  }
}

function populateTagFilterBar() {
  if (!tagFilterContainer) return;

  tagFilterContainer.innerHTML = '';
  state.tags.forEach(tag => {
    const button = document.createElement('button');
    button.className = 'tag-button';
    button.innerText = tag;
    if (activeFilters.includes(tag)) {
      button.classList.add('selected');
    }

    button.addEventListener('click', () => {
      if (activeFilters.includes(tag)) {
        activeFilters = activeFilters.filter(f => f !== tag);
        button.classList.remove('selected');
      } else {
        activeFilters.push(tag);
        button.classList.add('selected');
      }
      refreshItemsList();
    });

    tagFilterContainer.appendChild(button);
  });
}

function getFilteredItems() {
  let filtered = state.items;

  // 1. Tag Scope (Simplified: Always allow all, unless actively filtering)
  // 這裡邏輯改為：如果不選 tag filter，就顯示全部。如果選了 tag filter，必須符合所有選中的 tag。

  if (activeFilters.length > 0) {
    filtered = filtered.filter(item =>
      activeFilters.every(filterTag => item.tags && item.tags.includes(filterTag))
    );
  }

  // 2. Actor Filter
  if (currentActorFilter) {
    filtered = filtered.filter(item => {
      const actors = item.actors || [];
      // 這裡做模糊搜尋比較好用
      return actors.some(a => a.toLowerCase().includes(currentActorFilter.toLowerCase()));
    });
  }

  // 3. Search Text
  const searchTerm = itemSearchInput.value.toLowerCase();
  if (searchTerm) {
    filtered = filtered.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(searchTerm);
      const urlMatch = item.url.toLowerCase().includes(searchTerm);
      const actors = item.actors || [];
      const actorMatch = actors.some(a => a.toLowerCase().includes(searchTerm));
      return titleMatch || urlMatch || actorMatch;
    });
  }
  return filtered;
}

function renderFilteredList() {
  let itemsToDisplay = getFilteredItems();
  // 依加入時間反序排列 (新的在上面)
  itemsToDisplay.sort((a, b) => b.addDate - a.addDate);

  itemList.innerHTML = '';
  itemsToDisplay.forEach(item => {
    const listItem = document.createElement('li');
    listItem.className = "listItem";
    listItem.id = `item-${item.id}`;

    const textContainer = document.createElement('div');
    const itemTitleSpan = document.createElement('span');
    itemTitleSpan.className = 'item-title';
    itemTitleSpan.innerText = item.title;
    textContainer.appendChild(itemTitleSpan);

    const actors = item.actors || [];
    if (actors.length > 0) {
      const itemActorSpan = document.createElement('span');
      itemActorSpan.className = 'item-actor';
      itemActorSpan.innerText = `${actors.join(', ')}`; // Removed "Actors:" prefix for cleaner look
      textContainer.appendChild(itemActorSpan);
    }

    listItem.appendChild(textContainer);

    if (item.imageUrl) {
      const itemImage = document.createElement('img');
      itemImage.className = 'item-image';
      itemImage.src = item.imageUrl;
      itemImage.onerror = (e) => { e.target.style.display = 'none'; };
      listItem.appendChild(itemImage);
    }

    // Left Click: Open Tab
    listItem.addEventListener('click', () => {
      browser.tabs.create({ url: item.url });
    });

    // Right Click: Context Menu
    listItem.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      removeCustomContextMenu();
      const menu = createCustomContextMenu(item.id);
      document.body.appendChild(menu);

      const menuHeight = menu.offsetHeight;
      const windowHeight = window.innerHeight;
      if (e.clientY + menuHeight > windowHeight) {
        menu.style.top = `${e.clientY - menuHeight}px`;
      } else {
        menu.style.top = `${e.clientY}px`;
      }
      menu.style.left = `${e.clientX}px`;
    });
    itemList.appendChild(listItem);
  });
}

function createCustomContextMenu(itemId) {
  const menu = document.createElement('div');
  menu.id = 'customContextMenu';

  const editItem = document.createElement('div');
  editItem.className = 'context-menu-item';
  editItem.innerText = 'Edit';
  editItem.addEventListener('click', () => {
    if (callbacks.onEditItem) callbacks.onEditItem(itemId);
  });

  const deleteItem = document.createElement('div');
  deleteItem.className = 'context-menu-item';
  deleteItem.innerText = 'Delete';
  deleteItem.addEventListener('click', () => {
    if (confirm("Are you sure you want to delete this item?")) {
      const itemIndex = state.items.findIndex(i => i.id === itemId);
      if (itemIndex > -1) {
        state.items.splice(itemIndex, 1);
        saveData();
        refreshItemsList();
      }
    }
  });

  menu.appendChild(editItem);
  menu.appendChild(deleteItem);
  return menu;
}

function removeCustomContextMenu() {
  const existingMenu = document.getElementById('customContextMenu');
  if (existingMenu) existingMenu.remove();
}

function openAllItems() {
  const itemsToOpen = getFilteredItems();
  if (itemsToOpen.length > 0) {
    if (confirm(`Open ${itemsToOpen.length} tabs?`)) {
      itemsToOpen.forEach(item => {
        browser.tabs.create({ url: item.url, active: false });
      });
    }
  }
}

function randomItem() {
  const itemsToChooseFrom = getFilteredItems();
  if (itemsToChooseFrom.length > 0) {
    const randomItem = itemsToChooseFrom[Math.floor(Math.random() * itemsToChooseFrom.length)];
    browser.tabs.create({ url: randomItem.url });

    const listItem = document.getElementById(`item-${randomItem.id}`);
    if (listItem) {
      listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      listItem.classList.add('highlighted');
      setTimeout(() => listItem.classList.remove('highlighted'), 2000);
    }
  }
}
