// itemsView.js - 負責渲染項目列表、處理搜尋、過濾、右鍵選單
import { collectionStore, UNTAGGED_TAG } from './store.js';
import { tabAdapter } from '../tabAdapter.js';
import { highlightAndScrollToItem } from './highlightHelper.js';
import { renderActorChips } from './chipHelper.js';

// --- DOM Elements ---
let itemList, itemSearchInput, tagFilterContainer;
let actorFilterContainer, actorFilterInput, actorFilterDatalist;
let addActorFilterButton, selectedActorFiltersContainer;
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
  addActorFilterButton = document.getElementById('addActorFilterButton');
  selectedActorFiltersContainer = document.getElementById('selectedActorFiltersContainer');

  // 搜尋防抖：延遲執行 refreshItemsList
  if (itemSearchInput) {
    itemSearchInput.addEventListener('input', () => {
      collectionStore.setSearchQuery(itemSearchInput.value);
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
      collectionStore.setSearchQuery('');
      refreshItemsList();
    });
  }

  if (actorFilterInput) {
    actorFilterInput.addEventListener('input', (e) => {
      collectionStore.setPendingActorInput(e.target.value);
      refreshItemsList();
    });

    actorFilterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddActorFilter();
      }
    });
  }

  if (addActorFilterButton) {
    addActorFilterButton.addEventListener('click', handleAddActorFilter);
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
    if (li && li.dataset.url) {
      tabAdapter.openAdjacent(li.dataset.url);
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
  if (tag === 'All Items') {
    collectionStore.setAllItemsFilter();
  } else if (tag) {
    collectionStore.toggleTagFilter(tag);
  }
  populateTagFilterBar();
  populateActorFilterOptions();
  renderActorFilterChips();
  refreshItemsList();
}

export function refreshItemsList() {
  renderFilteredList();
}

// --- Internal Helper Functions ---

function handleAddActorFilter() {
  const val = actorFilterInput ? actorFilterInput.value : '';
  if (!val || !val.trim()) return;

  collectionStore.addActorFilter(val);
  collectionStore.setPendingActorInput('');

  if (actorFilterInput) actorFilterInput.value = '';
  renderActorFilterChips();
  refreshItemsList();
}

function renderActorFilterChips() {
  renderActorChips(selectedActorFiltersContainer, collectionStore.getActiveActorFilters(), {
    removeButtonClass: 'remove-actor-filter',
    removeTitle: 'Remove actor filter',
    onRemove: (actor) => {
      collectionStore.removeActorFilter(actor);
      renderActorFilterChips();
      refreshItemsList();
    }
  });
}

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
  const activeTags = collectionStore.getActiveTags();

  // 1. Untagged 按鈕
  const untaggedBtn = createFilterButton('Untagged', activeTags.includes(UNTAGGED_TAG));
  untaggedBtn.addEventListener('click', () => toggleFilter(UNTAGGED_TAG));
  fragment.appendChild(untaggedBtn);

  // 2. 一般標籤按鈕
  const tags = collectionStore.getTags();
  tags.forEach(tag => {
    const button = createFilterButton(tag, activeTags.includes(tag));
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
  collectionStore.toggleTagFilter(filterKey);
  populateTagFilterBar();
  refreshItemsList();
}

function getFilteredItems() {
  return collectionStore.getFilteredItems({
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
  if (itemsToOpen.length > 0) {
    if (confirm(`Open ${itemsToOpen.length} tabs?`)) {
      await tabAdapter.openBatchAdjacent(itemsToOpen.map(item => item.url), { active: false });
    }
  }
}

async function randomItem() {
  const randomItem = collectionStore.getRandomFilteredItem();

  if (randomItem && randomItem.url) {
    await tabAdapter.openAdjacent(randomItem.url);

    const listItem = document.getElementById(`item-${randomItem.id}`);
    if (listItem) {
      highlightAndScrollToItem(listItem, {
        duration: 3000,
        scrollBehavior: 'smooth',
        scrollBlock: 'center',
        realignOnImageLoad: true
      });
    }
  }
}
