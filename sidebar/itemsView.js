// itemsView.js - 負責渲染項目列表、處理搜尋、過濾、右鍵選單
import { collectionStore, UNTAGGED_TAG } from './store.js';
import { tabAdapter } from '../tabAdapter.js';
import { highlightAndScrollToItem } from './highlightHelper.js';

// --- Local State for this view ---
let activeFilters = [];
let activeActorFilters = [];
let currentActorFilter = "";

// --- DOM Elements ---
let itemList, itemSearchInput, tagFilterContainer;
let actorFilterInput, actorFilterDatalist;
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
  actorFilterInput = document.getElementById('actorFilterInput');
  actorFilterDatalist = document.getElementById('actorFilterDatalist');
  addActorFilterButton = document.getElementById('addActorFilterButton');
  selectedActorFiltersContainer = document.getElementById('selectedActorFiltersContainer');

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
    if (e.target && typeof e.target.closest === 'function' && e.target.closest('.item-tag')) {
      return;
    }
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
  if (tag && tag !== "All Items") {
    activeFilters = [tag];
  } else {
    activeFilters = [];
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
  const val = actorFilterInput ? actorFilterInput.value.trim() : '';
  if (!val) return;

  const names = val.split(',').map(s => s.trim()).filter(Boolean);
  names.forEach(name => {
    if (!activeActorFilters.includes(name)) {
      activeActorFilters.push(name);
    }
  });

  if (actorFilterInput) actorFilterInput.value = '';
  currentActorFilter = '';
  renderActorFilterChips();
  refreshItemsList();
}

function renderActorFilterChips() {
  if (!selectedActorFiltersContainer) return;
  selectedActorFiltersContainer.innerHTML = '';

  if (activeActorFilters.length === 0) {
    selectedActorFiltersContainer.style.display = 'none';
    return;
  }

  selectedActorFiltersContainer.style.display = 'flex';
  activeActorFilters.forEach(actor => {
    const chip = document.createElement('span');
    chip.className = 'actor-chip';

    const nameSpan = document.createElement('span');
    nameSpan.innerText = actor;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-actor-filter';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove actor filter';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      activeActorFilters = activeActorFilters.filter(a => a !== actor);
      renderActorFilterChips();
      refreshItemsList();
    });

    chip.appendChild(nameSpan);
    chip.appendChild(removeBtn);
    selectedActorFiltersContainer.appendChild(chip);
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

export function getActiveFilters() {
  return [...activeFilters];
}

export function resetFilters() {
  activeFilters = [];
  activeActorFilters = [];
  currentActorFilter = "";
  if (itemSearchInput) itemSearchInput.value = "";
}

export function toggleFilter(filterKey) {
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
  const actorsToQuery = [...activeActorFilters];
  if (currentActorFilter && !actorsToQuery.includes(currentActorFilter)) {
    actorsToQuery.push(currentActorFilter);
  }
  return collectionStore.queryItems({
    tags: activeFilters,
    actors: actorsToQuery,
    search: searchTerm,
    sortBy: 'addDate',
    sortOrder: 'desc'
  });
}

/**
 * 渲染單個項目卡片元素
 * @param {Object} item 項目資料物件
 * @param {Document} [doc] DOM Document 物件（預設為全域 document）
 * @param {Object} [options] 選項物件
 * @param {Function} [options.onTagClick] 點擊標籤時的回呼函數（預設為 toggleFilter）
 * @returns {HTMLElement} 項目卡片 DOM 節點
 */
export function renderItemElement(item, doc = globalThis.document, options = {}) {
  const onTagClick = options?.onTagClick;

  const listItem = doc.createElement('li');
  listItem.className = 'listItem';
  listItem.id = `item-${item.id}`;

  listItem.dataset.id = item.id;
  listItem.dataset.url = item.url;

  const textContainer = doc.createElement('div');
  const itemTitleSpan = doc.createElement('span');
  itemTitleSpan.className = 'item-title';
  itemTitleSpan.innerText = item.title;
  textContainer.appendChild(itemTitleSpan);

  const actors = item.actors || [];
  if (actors.length > 0) {
    const itemActorSpan = doc.createElement('span');
    itemActorSpan.className = 'item-actor';
    itemActorSpan.innerText = `${actors.join(', ')}`;
    textContainer.appendChild(itemActorSpan);
  }

  const rawTags = Array.isArray(item.tags)
    ? item.tags.filter(t => typeof t === 'string' && t.trim().length > 0)
    : [];
  if (rawTags.length > 0) {
    const itemTagsContainer = doc.createElement('div');
    itemTagsContainer.className = 'item-tags';
    const displayTags = rawTags.slice(0, 3);
    displayTags.forEach((tag, idx) => {
      if (idx > 0) {
        itemTagsContainer.appendChild(doc.createTextNode(' '));
      }
      const tagSpan = doc.createElement('span');
      tagSpan.className = 'item-tag';
      const cleanTag = tag.trim();
      tagSpan.dataset.tag = cleanTag;
      tagSpan.innerText = cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;

      if (typeof tagSpan.addEventListener === 'function') {
        tagSpan.addEventListener('click', (e) => {
          if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
          }
          if (typeof onTagClick === 'function') {
            onTagClick(cleanTag, e);
          } else {
            toggleFilter(cleanTag);
          }
        });
      }
      itemTagsContainer.appendChild(tagSpan);
    });
    textContainer.appendChild(itemTagsContainer);
  }

  listItem.appendChild(textContainer);

  if (item.imageUrl) {
    const itemImage = doc.createElement('img');
    itemImage.className = 'item-image';
    itemImage.src = item.imageUrl;
    itemImage.loading = 'lazy';
    itemImage.onerror = (e) => { e.target.style.display = 'none'; };
    listItem.appendChild(itemImage);
  }

  return listItem;
}

function renderFilteredList() {
  if (!itemList) return;
  const itemsToDisplay = getFilteredItems();

  itemList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  itemsToDisplay.forEach(item => {
    const listItem = renderItemElement(item, document);
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
  const searchTerm = itemSearchInput ? itemSearchInput.value : '';
  const actorsToQuery = [...activeActorFilters];
  if (currentActorFilter && !actorsToQuery.includes(currentActorFilter)) {
    actorsToQuery.push(currentActorFilter);
  }
  const randomItem = collectionStore.getRandomItem({
    tags: activeFilters,
    actors: actorsToQuery,
    search: searchTerm
  });

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
