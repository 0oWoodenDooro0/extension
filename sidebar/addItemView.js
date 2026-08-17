// addItemView.js - 負責新增與編輯項目的表單邏輯
import { collectionStore } from './store.js';

// --- DOM Elements ---
let itemTitleInput, itemUrlInput, itemImageUrlInput;
let itemActorInput, addActorButton, selectedActorsContainer, actorSuggestions;
let existingTagsContainer, saveItemButton, cancelButton, deleteItemButton;

// --- Local State ---
let editingItemId = null;
let currentEditingActors = [];
let callbacks = {}; // { onSave, onCancel, onDelete }

/**
 * 初始化新增/編輯視圖
 * @param {Object} injectedCallbacks - 回呼函數 { onSave, onCancel, onDelete }
 */
export function initAddItemView(injectedCallbacks) {
  callbacks = injectedCallbacks;

  // 獲取 DOM 元素
  itemTitleInput = document.getElementById('itemTitleInput');
  itemUrlInput = document.getElementById('itemUrlInput');
  itemImageUrlInput = document.getElementById('itemImageUrlInput');
  itemActorInput = document.getElementById('itemActorInput');
  addActorButton = document.getElementById('addActorButton');
  selectedActorsContainer = document.getElementById('selectedActorsContainer');
  actorSuggestions = document.getElementById('actorSuggestions');
  existingTagsContainer = document.getElementById('existingTagsContainer');
  saveItemButton = document.getElementById('saveItemButton');
  cancelButton = document.getElementById('cancelButton');
  deleteItemButton = document.getElementById('deleteItemButton');

  // 綁定事件
  if (addActorButton) {
    addActorButton.addEventListener('click', handleAddActor);
  }
  if (itemActorInput) {
    itemActorInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddActor();
      }
    });
  }

  if (saveItemButton) saveItemButton.addEventListener('click', handleSave);
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      if (callbacks.onCancel) callbacks.onCancel();
    });
  }

  if (deleteItemButton) deleteItemButton.addEventListener('click', handleDelete);
}

/**
 * 顯示新增或編輯視圖
 * @param {String|null} itemId - 如果是編輯模式，傳入 itemId；如果是新增模式，傳入 null
 */
export function showAddItemView(itemId = null) {
  // 重置表單
  if (itemTitleInput) itemTitleInput.value = '';
  if (itemUrlInput) itemUrlInput.value = '';
  if (itemImageUrlInput) itemImageUrlInput.value = '';
  if (itemActorInput) itemActorInput.value = '';
  currentEditingActors = [];

  populateActorSuggestions();

  if (itemId) {
    // --- 編輯模式 ---
    const itemToEdit = collectionStore.getItemById(itemId);
    if (!itemToEdit) return; // 找不到項目，可能已被刪除

    editingItemId = itemId;
    if (itemTitleInput) itemTitleInput.value = itemToEdit.title;
    if (itemUrlInput) itemUrlInput.value = itemToEdit.url;
    if (itemImageUrlInput) itemImageUrlInput.value = itemToEdit.imageUrl || '';
    currentEditingActors = itemToEdit.actors ? [...itemToEdit.actors] : [];

    if (deleteItemButton) deleteItemButton.style.display = 'block';
    populateTagSelector(itemToEdit.tags || []);

    // 如果沒有圖片，嘗試自動抓取
    if (!itemToEdit.imageUrl && itemToEdit.url) {
      tryFetchImage(itemToEdit.url);
    }

  } else {
    // --- 新增模式 ---
    editingItemId = null;
    if (deleteItemButton) deleteItemButton.style.display = 'none';

    // 從當前分頁抓取資訊
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        const currentTab = tabs && tabs[0];
        if (!currentTab) return;

        if (itemTitleInput) itemTitleInput.value = currentTab.title || '';
        if (itemUrlInput) itemUrlInput.value = currentTab.url || '';

        // 檢查是否已存在
        const existingItem = currentTab.url ? collectionStore.getItemByUrl(currentTab.url) : null;
        if (existingItem) {
          populateTagSelector(existingItem.tags || []);
          if (itemImageUrlInput) itemImageUrlInput.value = existingItem.imageUrl || '';
          currentEditingActors = existingItem.actors ? [...existingItem.actors] : [];
        } else {
          populateTagSelector([]);
          currentEditingActors = [];
        }

        renderActorChips();

        if (currentTab.url) {
          tryFetchImage(currentTab.url);
        }
      });
    } else {
      populateTagSelector([]);
      currentEditingActors = [];
      renderActorChips();
    }
  }

  renderActorChips();
}

/**
 * 回傳當前是否為編輯模式 (用於 Controller 判斷返回路徑)
 */
export function isEditingMode() {
  return editingItemId !== null;
}

// --- Internal Logic ---

function tryFetchImage(url) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'getImage', url: url })
      .then(response => {
        if (response && response.imageUrl) {
          if (itemImageUrlInput && !itemImageUrlInput.value) {
            itemImageUrlInput.value = response.imageUrl;
          }
        }
      })
      .catch(error => console.error("Error fetching image:", error));
  }
}

async function handleSave() {
  const title = itemTitleInput ? itemTitleInput.value.trim() : '';
  const url = itemUrlInput ? itemUrlInput.value.trim() : '';
  const imageUrl = itemImageUrlInput ? itemImageUrlInput.value.trim() : '';
  const actors = currentEditingActors;

  if (!title || !url) return;

  const selectedTags = Array.from(existingTagsContainer.querySelectorAll('.tag-button.selected'))
    .map(btn => btn.dataset.tag);

  try {
    await collectionStore.saveItem({
      id: editingItemId,
      title,
      url,
      tags: selectedTags,
      imageUrl: imageUrl || null,
      actors: actors
    });

    editingItemId = null;
    if (callbacks.onSave) callbacks.onSave();
  } catch (err) {
    console.error("Failed to save item:", err);
  }
}

async function handleDelete() {
  if (!editingItemId) return;
  if (confirm("Are you sure you want to delete this item?")) {
    const success = await collectionStore.deleteItem(editingItemId);
    if (success) {
      editingItemId = null;
      if (callbacks.onDelete) callbacks.onDelete();
    }
  }
}

function handleAddActor() {
  const val = itemActorInput ? itemActorInput.value.trim() : '';
  if (val) {
    const names = val.split(',').map(s => s.trim()).filter(Boolean);
    names.forEach(name => {
      if (!currentEditingActors.includes(name)) {
        currentEditingActors.push(name);
      }
    });
    itemActorInput.value = '';
    renderActorChips();
  }
}

function renderActorChips() {
  if (!selectedActorsContainer) return;
  selectedActorsContainer.innerHTML = '';
  currentEditingActors.forEach(actor => {
    const chip = document.createElement('span');
    chip.className = 'actor-chip';

    const nameSpan = document.createElement('span');
    nameSpan.innerText = actor;

    const removeBtn = document.createElement('span');
    removeBtn.className = 'remove-actor';
    removeBtn.innerText = '×';
    removeBtn.title = 'Remove actor';
    removeBtn.addEventListener('click', () => {
      currentEditingActors = currentEditingActors.filter(a => a !== actor);
      renderActorChips();
    });

    chip.appendChild(nameSpan);
    chip.appendChild(removeBtn);
    selectedActorsContainer.appendChild(chip);
  });
}

function populateActorSuggestions() {
  if (!actorSuggestions) return;
  actorSuggestions.innerHTML = '';
  const allActors = collectionStore.getAllActors();

  allActors.forEach(actor => {
    const option = document.createElement('option');
    option.value = actor;
    actorSuggestions.appendChild(option);
  });
}

function populateTagSelector(selectedTags) {
  if (!existingTagsContainer) return;
  existingTagsContainer.innerHTML = '';
  const tags = collectionStore.getTags();
  tags.forEach(tag => {
    const button = document.createElement('button');
    button.className = 'tag-button';
    button.innerText = tag;
    button.dataset.tag = tag;
    if (selectedTags.includes(tag)) {
      button.classList.add('selected');
    }
    button.addEventListener('click', () => {
      button.classList.toggle('selected');
    });
    existingTagsContainer.appendChild(button);
  });
}
