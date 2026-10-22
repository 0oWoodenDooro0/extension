// chipHelper.js - 共用 Actor Chip 解析與 DOM 渲染輔助模組

/**
 * 解析使用者輸入的演員字串（支援以逗號一次輸入多位演員、去頭尾空白、濾除空字串與去重）
 * @param {string|null|undefined} input
 * @returns {string[]}
 */
export function parseActorInput(input) {
  if (!input || typeof input !== 'string') return [];
  const seen = new Set();
  const result = [];

  input.split(',').forEach((raw) => {
    const trimmed = raw.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  });

  return result;
}

/**
 * 渲染 Actor Chips 列表至指定容器中
 * @param {HTMLElement} container - 容器 DOM 元素
 * @param {string[]} actors - 演員清單
 * @param {Object} options
 * @param {(actor: string) => void} options.onRemove - 點擊刪除按鈕時的回呼
 * @param {string} [options.removeButtonClass='remove-actor-filter'] - 刪除按鈕樣式 class
 * @param {string} [options.removeTitle='Remove actor filter'] - 刪除按鈕 title
 * @param {boolean} [options.hideWhenEmpty=true] - 清單為空時是否隱藏容器
 */
export function renderActorChips(
  container,
  actors = [],
  {
    onRemove,
    removeButtonClass = 'remove-actor-filter',
    removeTitle = 'Remove actor filter',
    hideWhenEmpty = true
  } = {}
) {
  if (!container) return;
  container.innerHTML = '';

  if (!actors || actors.length === 0) {
    if (hideWhenEmpty) {
      container.style.display = 'none';
    }
    return;
  }

  container.style.display = 'flex';

  actors.forEach((actor) => {
    const chip = document.createElement('span');
    chip.className = 'actor-chip';

    const nameSpan = document.createElement('span');
    nameSpan.innerText = actor;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = removeButtonClass;
    removeBtn.innerText = '×';
    removeBtn.title = removeTitle;
    removeBtn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }
      if (typeof onRemove === 'function') {
        onRemove(actor);
      }
    });

    chip.appendChild(nameSpan);
    chip.appendChild(removeBtn);
    container.appendChild(chip);
  });
}
