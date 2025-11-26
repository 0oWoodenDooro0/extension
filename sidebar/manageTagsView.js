// manageTagsView.js - 負責標籤管理（新增、改名、刪除、排序）
import { state, saveData } from './store.js';

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

  addNewTagButton.addEventListener('click', addNewTag);
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
  manageTagList.innerHTML = '';
  state.tags.forEach(tag => {
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
    deleteButton.addEventListener('click', () => deleteTag(tag));

    actionsDiv.appendChild(renameButton);
    actionsDiv.appendChild(deleteButton);

    li.appendChild(handle);
    li.appendChild(nameSpan);
    li.appendChild(actionsDiv);
    manageTagList.appendChild(li);
  });
}

// --- Internal Logic ---

function addNewTag() {
  const newTagName = newTagInput.value.trim();
  if (newTagName && !state.tags.includes(newTagName)) {
    state.tags.push(newTagName);
    saveData();
    displayManageTagList();
    newTagInput.value = '';
  }
}

function promptRenameTag(oldTag) {
  const newTagName = prompt(`Rename tag "${oldTag}" to:`, oldTag);
  if (newTagName && newTagName.trim() !== oldTag) {
    renameTag(oldTag, newTagName.trim());
  }
}

function renameTag(oldTag, newTag) {
  if (state.tags.includes(newTag)) {
    alert(`Tag "${newTag}" already exists.`);
    return;
  }
  const tagIndex = state.tags.indexOf(oldTag);
  if (tagIndex > -1) {
    state.tags[tagIndex] = newTag;
  }
  // 更新所有 Item 中的標籤
  state.items.forEach(item => {
    if (item.tags && item.tags.includes(oldTag)) {
      const itemTagIndex = item.tags.indexOf(oldTag);
      item.tags[itemTagIndex] = newTag;
    }
  });
  saveData();
  displayManageTagList();
}

function deleteTag(tagToDelete) {
  if (confirm(`Are you sure you want to delete the tag "${tagToDelete}"? This will remove the tag from all items.`)) {
    state.tags = state.tags.filter(tag => tag !== tagToDelete);
    // 移除 Item 中的標籤
    state.items.forEach(item => {
      if (item.tags) {
        item.tags = item.tags.filter(tag => tag !== tagToDelete);
      }
    });
    saveData();
    displayManageTagList();
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

function handleDrop(e) {
  e.preventDefault();
  const target = e.target.closest('.manage-tag-item');
  if (target && target.dataset.tag !== draggedTag) {
    const fromIndex = state.tags.indexOf(draggedTag);
    const toIndex = state.tags.indexOf(target.dataset.tag);

    const [movedTag] = state.tags.splice(fromIndex, 1);
    state.tags.splice(toIndex, 0, movedTag);

    saveData();
    displayManageTagList();
  }
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedTag = null;
}
