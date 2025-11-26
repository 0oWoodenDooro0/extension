// tagsView.js - 負責渲染首頁的標籤列表
import { state } from './store.js';

// DOM Elements (將在 init 時或 render 時獲取)
const tagList = document.getElementById('tagList');

/**
 * 渲染標籤列表
 * @param {Function} onTagClick - 當使用者點擊標籤時的回呼函數，通常是用來切換到 ItemsView
 */
export function renderTagsList(onTagClick) {
  tagList.innerHTML = '';

  // 1. All Items
  const allItemsCount = state.items.length;
  const allItemsLi = createTagListItem("All Items", allItemsCount, () => onTagClick("All Items"));
  tagList.appendChild(allItemsLi);

  // 2. Untagged
  const untaggedItemsCount = state.items.filter(item => !item.tags || item.tags.length === 0).length;
  if (untaggedItemsCount > 0) {
    const untaggedLi = createTagListItem("Untagged", untaggedItemsCount, () => onTagClick("Untagged"));
    tagList.appendChild(untaggedLi);
  }

  // 3. 一般標籤
  state.tags.forEach(tag => {
    const count = state.items.filter(item => item.tags && item.tags.includes(tag)).length;
    const li = createTagListItem(tag, count, () => onTagClick(tag));
    tagList.appendChild(li);
  });
}

function createTagListItem(tagName, count, onClick) {
  const listItem = document.createElement('li');
  listItem.className = "listItem";

  const tagText = document.createElement('span');
  tagText.innerText = `${tagName} (${count})`;
  tagText.style.fontWeight = '500';

  listItem.appendChild(tagText);
  listItem.addEventListener('click', onClick);
  return listItem;
}
