// addItemView.js - 負責新增與編輯項目的表單邏輯
import { collectionStore } from './store.js';
import { tabAdapter } from '../tabAdapter.js';

// --- DOM Elements ---
let itemTitleInput, itemUrlInput, itemImageUrlInput;
let fetchImageButton, imagePreviewContainer, imagePreview, imagePreviewStatus;
let itemActorInput, addActorButton, selectedActorsContainer, actorSuggestions;
let existingTagsContainer, saveItemButton, cancelButton, deleteItemButton;

// --- Local State ---
let editingItemId = null;
let currentEditingActors = [];
let callbacks = {}; // { onSave, onCancel, onDelete }
let urlDebounceTimer = null;

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
  fetchImageButton = document.getElementById('fetchImageButton');
  imagePreviewContainer = document.getElementById('imagePreviewContainer');
  imagePreview = document.getElementById('imagePreview');
  imagePreviewStatus = document.getElementById('imagePreviewStatus');

  itemActorInput = document.getElementById('itemActorInput');
  addActorButton = document.getElementById('addActorButton');
  selectedActorsContainer = document.getElementById('selectedActorsContainer');
  actorSuggestions = document.getElementById('actorSuggestions');
  existingTagsContainer = document.getElementById('existingTagsContainer');
  saveItemButton = document.getElementById('saveItemButton');
  cancelButton = document.getElementById('cancelButton');
  deleteItemButton = document.getElementById('deleteItemButton');

  // 綁定事件
  if (fetchImageButton) {
    fetchImageButton.addEventListener('click', () => {
      const url = itemUrlInput ? itemUrlInput.value.trim() : '';
      if (url) {
        tryFetchImage(url, true);
      }
    });
  }

  if (itemImageUrlInput) {
    itemImageUrlInput.addEventListener('input', () => {
      const imgUrl = itemImageUrlInput.value.trim();
      updateImagePreview(imgUrl);
    });
  }

  if (itemUrlInput) {
    itemUrlInput.addEventListener('input', () => {
      if (urlDebounceTimer) clearTimeout(urlDebounceTimer);
      urlDebounceTimer = setTimeout(() => {
        const url = itemUrlInput.value.trim();
        // 只有在尚未填寫圖片或圖片為空時自動觸發抓取
        if (url && itemImageUrlInput && !itemImageUrlInput.value) {
          tryFetchImage(url, false);
        }
      }, 500);
    });
  }

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
  updateImagePreview('');

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

    if (itemToEdit.imageUrl) {
      updateImagePreview(itemToEdit.imageUrl);
    } else if (itemToEdit.url) {
      tryFetchImage(itemToEdit.url, false);
    }

  } else {
    // --- 新增模式 ---
    editingItemId = null;
    if (deleteItemButton) deleteItemButton.style.display = 'none';

    // 從當前分頁抓取資訊
    tabAdapter.getActiveTab().then(currentTab => {
      if (!currentTab) {
        populateTagSelector([]);
        currentEditingActors = [];
        renderActorChips();
        updateImagePreview('');
        return;
      }

      if (itemTitleInput) itemTitleInput.value = currentTab.title || '';
      if (itemUrlInput) itemUrlInput.value = currentTab.url || '';

      // 檢查是否已存在
      const existingItem = currentTab.url ? collectionStore.getItemByUrl(currentTab.url) : null;
      if (existingItem) {
        populateTagSelector(existingItem.tags || []);
        if (itemImageUrlInput) itemImageUrlInput.value = existingItem.imageUrl || '';
        currentEditingActors = existingItem.actors ? [...existingItem.actors] : [];
        if (existingItem.imageUrl) {
          updateImagePreview(existingItem.imageUrl);
        }
      } else {
        populateTagSelector([]);
        currentEditingActors = [];
      }

      renderActorChips();

      if (currentTab.url && (!existingItem || !existingItem.imageUrl)) {
        tryFetchImage(currentTab.url, false);
      }
    });
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

/**
 * 更新圖片即時預覽狀態與縮圖
 */
function updateImagePreview(url, statusText = '') {
  if (!imagePreviewContainer || !imagePreview || !imagePreviewStatus) return;

  if (url) {
    imagePreviewContainer.style.display = 'flex';
    imagePreview.style.display = 'block';
    imagePreview.src = url;
    imagePreviewStatus.innerText = statusText || 'Preview';

    imagePreview.onload = () => {
      imagePreview.style.display = 'block';
      if (!statusText) imagePreviewStatus.innerText = 'Preview';
    };

    imagePreview.onerror = () => {
      imagePreview.style.display = 'none';
      imagePreviewStatus.innerText = 'Unable to load image preview';
    };
  } else if (statusText) {
    imagePreviewContainer.style.display = 'flex';
    imagePreview.style.display = 'none';
    imagePreviewStatus.innerText = statusText;
  } else {
    imagePreviewContainer.style.display = 'none';
    imagePreview.src = '';
    imagePreviewStatus.innerText = '';
  }
}

/**
 * 透過背景 Service Worker 嘗試獲取封面圖片
 * @param {string} url - 要抓取的網址
 * @param {boolean} forceUpdate - 是否強制覆蓋輸入框現有值
 */
function tryFetchImage(url, forceUpdate = false) {
  if (!url || typeof url !== 'string') return;

  updateImagePreview('', 'Fetching preview image...');

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'getImage', url: url })
      .then(response => {
        if (response && response.imageUrl) {
          if (forceUpdate || (itemImageUrlInput && !itemImageUrlInput.value)) {
            if (itemImageUrlInput) itemImageUrlInput.value = response.imageUrl;
            updateImagePreview(response.imageUrl, 'Cover fetched');
          } else if (itemImageUrlInput && itemImageUrlInput.value) {
            updateImagePreview(itemImageUrlInput.value);
          }
        } else {
          if (itemImageUrlInput && itemImageUrlInput.value) {
            updateImagePreview(itemImageUrlInput.value);
          } else {
            updateImagePreview('', 'No cover image detected');
            setTimeout(() => {
              if (itemImageUrlInput && !itemImageUrlInput.value) {
                updateImagePreview('');
              }
            }, 3000);
          }
        }
      })
      .catch(error => {
        console.error("Error fetching image:", error);
        if (itemImageUrlInput && itemImageUrlInput.value) {
          updateImagePreview(itemImageUrlInput.value);
        } else {
          updateImagePreview('');
        }
      });
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
