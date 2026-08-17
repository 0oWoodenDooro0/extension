// manageTagsView.js - 負責標籤管理（新增、改名、刪除、排序）
import { collectionStore } from './store.js';

// --- DOM Elements ---
let manageTagList, newTagInput, addNewTagButton, closeManageTagsButton;
let callbacks = {}; // { onClose }
let draggedTag = null;

/**
 * 初始化標籤管理視圖
 * @param {Object} injectedCallbacks - { onClose }
 */
export function initManageTagsView(injectedCallbacks) {
  callbacks = injectedCallbacks;

  manageTagList = document.getElementById('manageTagList');
  newTagInput = document.getElementById('newTagInput');
  addNewTagButton = document.getElementById('addNewTagButton');
  closeManageTagsButton = document.getElementById('closeManageTagsButton');

  addNewTagButton.addEventListener('click', handleAddNewTag);
  closeManageTagsButton.addEventListener('click', () => {
    if (callbacks.onClose) callbacks.onClose();
  });
}

/**
 * 顯示並渲染標籤管理列表
 */
export function showManageTagsView() {
  displayManageTagList();
}

/**
 * 渲染列表 (公開函數，供 Controller 在 storage 更新時呼叫)
 */
export function displayManageTagList() {
  if (!manageTagList) return;
  manageTagList.innerHTML = '';
  
  const tags = collectionStore.getTags();
  tags.forEach(tag => {
    const li = document.createElement('li');
    li.className = 'manage-tag-item';
    li.dataset.tag = tag;
    li.draggable = true;

    // Drag Events
    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragend', handleDragEnd);

    const handle = document.createElement('span');
    handle.className = 'drag-handle';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tag-name';
    nameSpan.innerText = tag;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'tag-actions';

    const renameButton = document.createElement('button');
    renameButton.innerText = 'Rename';
    renameButton.addEventListener('click', () => promptRenameTag(tag));

    const deleteButton = document.createElement('button');
    deleteButton.innerText = 'Delete';
    deleteButton.addEventListener('click', () => handleDeleteTag(tag));

    actionsDiv.appendChild(renameButton);
    actionsDiv.appendChild(deleteButton);

    li.appendChild(handle);
    li.appendChild(nameSpan);
    li.appendChild(actionsDiv);
    manageTagList.appendChild(li);
  });
}

// --- Internal Logic ---

async function handleAddNewTag() {
  const newTagName = newTagInput.value.trim();
  if (!newTagName) return;

  const success = await collectionStore.addTag(newTagName);
  if (success) {
    displayManageTagList();
    newTagInput.value = '';
  } else {
    alert(`Tag "${newTagName}" already exists or is invalid.`);
  }
}

async function promptRenameTag(oldTag) {
  const newTagName = prompt(`Rename tag "${oldTag}" to:`, oldTag);
  if (newTagName && newTagName.trim() !== oldTag) {
    const trimmed = newTagName.trim();
    const success = await collectionStore.renameTag(oldTag, trimmed);
    if (success) {
      displayManageTagList();
    } else {
      alert(`Tag "${trimmed}" already exists or could not be renamed.`);
    }
  }
}

async function handleDeleteTag(tagToDelete) {
  if (confirm(`Are you sure you want to delete the tag "${tagToDelete}"? This will remove the tag from all items.`)) {
    const success = await collectionStore.deleteTag(tagToDelete);
    if (success) {
      displayManageTagList();
    }
  }
}

// --- Drag and Drop Logic ---

function handleDragStart(e) {
  draggedTag = e.target.dataset.tag;
  e.target.classList.add('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
  const target = e.target.closest('.manage-tag-item');
  if (target && target.dataset.tag !== draggedTag) {
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const target = e.target.closest('.manage-tag-item');
  if (target && target.dataset.tag !== draggedTag) {
    const tags = collectionStore.getTags();
    const fromIndex = tags.indexOf(draggedTag);
    const toIndex = tags.indexOf(target.dataset.tag);

    if (fromIndex !== -1 && toIndex !== -1) {
      await collectionStore.reorderTags(fromIndex, toIndex);
      displayManageTagList();
    }
  }
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedTag = null;
}
