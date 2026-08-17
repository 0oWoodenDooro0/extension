// itemsView.js - 負責渲染項目列表、處理搜尋、過濾、右鍵選單
import { collectionStore, UNTAGGED_TAG } from './store.js';

// --- Local State for this view ---
let currentTag = "All Items";
let activeFilters = [];
let currentActorFilter = "";

// --- DOM Elements ---
let itemList, itemSearchInput, tagFilterContainer;
let actorFilterContainer, actorFilterInput, actorFilterDatalist;
let callbacks = {};
let searchDebounceTimer = null; // 用於搜尋防抖

/**
 * 初始化項目視圖
 */
export function initItemsView(injectedCallbacks) {
  callbacks = injectedCallbacks;

  itemList = document.getElementById('itemList');
  itemSearchInput = document.getElementById('itemSearchInput');
  tagFilterContainer = document.getElementById('tagFilterContainer');
  actorFilterContainer = document.getElementById('actorFilterContainer');
  actorFilterInput = document.getElementById('actorFilterInput');
  actorFilterDatalist = document.getElementById('actorFilterDatalist');

  // 搜尋防抖：延遲執行 refreshItemsList
  if (itemSearchInput) {
    itemSearchInput.addEventListener('input', () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        refreshItemsList();
      }, 300);
    });
  }

  const clearBtn = document.getElementById('clearSearchButton');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (itemSearchInput) itemSearchInput.value = '';
      refreshItemsList();
    });
  }

  if (actorFilterInput) {
    actorFilterInput.addEventListener('input', (e) => {
      currentActorFilter = e.target.value.trim();
      refreshItemsList();
    });
  }

  // 事件委派：統一在 itemList (父層) 監聽點擊
  setupListEventDelegation();

  document.addEventListener('click', removeCustomContextMenu);

  const randomBtn = document.getElementById('randomButton');
  if (randomBtn) randomBtn.addEventListener('click', randomItem);

  const openAllBtn = document.getElementById('openAllButton');
  if (openAllBtn) openAllBtn.addEventListener('click', openAllItems);
}

// 設置事件委派函數
function setupListEventDelegation() {
  if (!itemList) return;

  // 左鍵點擊：開啟連結
  itemList.addEventListener('click', async (e) => {
    const li = e.target.closest('.listItem');
    if (li) {
      const url = li.dataset.url;
      if (url && typeof chrome !== 'undefined' && chrome.tabs) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs && tabs[0];

        chrome.tabs.create({
          url: url,
          index: currentTab ? currentTab.index + 1 : undefined,
          openerTabId: currentTab ? currentTab.id : undefined
        });
      }
    }
  });

  // 右鍵點擊：自定義選單
  itemList.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.listItem');
    if (li) {
      e.preventDefault();
      removeCustomContextMenu();
      const itemId = li.dataset.id;

      const menu = createCustomContextMenu(itemId);
      document.body.appendChild(menu);

      const menuHeight = menu.offsetHeight || 100;
      const windowHeight = window.innerHeight;

      let top = e.clientY;
      if (e.clientY + menuHeight > windowHeight) {
        top = e.clientY - menuHeight;
      }
      menu.style.top = `${top}px`;
      menu.style.left = `${e.clientX}px`;
    }
  });
}

export function displayItemsByTag(tag) {
  currentTag = tag;
  populateTagFilterBar();
  populateActorFilterOptions();
  refreshItemsList();
}

export function refreshItemsList() {
  renderFilteredList();
}

// --- Internal Helper Functions ---

function populateActorFilterOptions() {
  const allActors = collectionStore.getAllActors();

  if (actorFilterDatalist) {
    actorFilterDatalist.innerHTML = '';
    const fragment = document.createDocumentFragment();
    allActors.forEach(actor => {
      const option = document.createElement('option');
      option.value = actor;
      fragment.appendChild(option);
    });
    actorFilterDatalist.appendChild(fragment);
  }
}

function populateTagFilterBar() {
  if (!tagFilterContainer) return;
  tagFilterContainer.innerHTML = '';

  const fragment = document.createDocumentFragment();

  // 1. Untagged 按鈕
  const untaggedBtn = createFilterButton('Untagged', activeFilters.includes(UNTAGGED_TAG));
  untaggedBtn.addEventListener('click', () => toggleFilter(UNTAGGED_TAG));
  fragment.appendChild(untaggedBtn);

  // 2. 一般標籤按鈕
  const tags = collectionStore.getTags();
  tags.forEach(tag => {
    const button = createFilterButton(tag, activeFilters.includes(tag));
    button.addEventListener('click', () => toggleFilter(tag));
    fragment.appendChild(button);
  });

  tagFilterContainer.appendChild(fragment);
}

function createFilterButton(text, isSelected) {
  const button = document.createElement('button');
  button.className = 'tag-button';
  button.innerText = text;
  if (isSelected) button.classList.add('selected');
  return button;
}

function toggleFilter(filterKey) {
  if (filterKey === UNTAGGED_TAG) {
    if (activeFilters.includes(UNTAGGED_TAG)) {
      activeFilters = [];
    } else {
      activeFilters = [UNTAGGED_TAG];
    }
  } else {
    if (activeFilters.includes(UNTAGGED_TAG)) {
      activeFilters = [];
    }
    if (activeFilters.includes(filterKey)) {
      activeFilters = activeFilters.filter(f => f !== filterKey);
    } else {
      activeFilters.push(filterKey);
    }
  }
  populateTagFilterBar();
  refreshItemsList();
}

function getFilteredItems() {
  const searchTerm = itemSearchInput ? itemSearchInput.value : '';
  return collectionStore.queryItems({
    tags: activeFilters,
    actor: currentActorFilter,
    search: searchTerm,
    sortBy: 'addDate',
    sortOrder: 'desc'
  });
}

function renderFilteredList() {
  if (!itemList) return;
  const itemsToDisplay = getFilteredItems();

  itemList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  itemsToDisplay.forEach(item => {
    const listItem = document.createElement('li');
    listItem.className = "listItem";
    listItem.id = `item-${item.id}`;

    listItem.dataset.id = item.id;
    listItem.dataset.url = item.url;

    const textContainer = document.createElement('div');
    const itemTitleSpan = document.createElement('span');
    itemTitleSpan.className = 'item-title';
    itemTitleSpan.innerText = item.title;
    textContainer.appendChild(itemTitleSpan);

    const actors = item.actors || [];
    if (actors.length > 0) {
      const itemActorSpan = document.createElement('span');
      itemActorSpan.className = 'item-actor';
      itemActorSpan.innerText = `${actors.join(', ')}`;
      textContainer.appendChild(itemActorSpan);
    }

    listItem.appendChild(textContainer);

    if (item.imageUrl) {
      const itemImage = document.createElement('img');
      itemImage.className = 'item-image';
      itemImage.src = item.imageUrl;
      itemImage.loading = "lazy";
      itemImage.onerror = (e) => { e.target.style.display = 'none'; };
      listItem.appendChild(itemImage);
    }

    fragment.appendChild(listItem);
  });

  itemList.appendChild(fragment);
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
  deleteItem.addEventListener('click', async () => {
    if (confirm("Are you sure you want to delete this item?")) {
      const success = await collectionStore.deleteItem(itemId);
      if (success) {
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

async function openAllItems() {
  const itemsToOpen = getFilteredItems();
  if (itemsToOpen.length > 0 && typeof chrome !== 'undefined' && chrome.tabs) {
    if (confirm(`Open ${itemsToOpen.length} tabs?`)) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs && tabs[0];
      let startIndex = currentTab ? currentTab.index + 1 : undefined;

      itemsToOpen.forEach((item, i) => {
        chrome.tabs.create({
          url: item.url,
          active: false,
          index: startIndex !== undefined ? startIndex + i : undefined,
          openerTabId: currentTab ? currentTab.id : undefined
        });
      });
    }
  }
}

async function randomItem() {
  const searchTerm = itemSearchInput ? itemSearchInput.value : '';
  const randomItem = collectionStore.getRandomItem({
    tags: activeFilters,
    actor: currentActorFilter,
    search: searchTerm
  });

  if (randomItem && typeof chrome !== 'undefined' && chrome.tabs) {

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs && tabs[0];

    chrome.tabs.create({
      url: randomItem.url,
      index: currentTab ? currentTab.index + 1 : undefined,
      openerTabId: currentTab ? currentTab.id : undefined
    });

    const listItem = document.getElementById(`item-${randomItem.id}`);
    if (listItem) {
      listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      listItem.classList.add('highlighted');
      setTimeout(() => listItem.classList.remove('highlighted'), 2000);
    }
  }
}
