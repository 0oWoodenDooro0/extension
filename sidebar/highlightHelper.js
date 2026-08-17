// highlightHelper.js - 統一管理項目的高亮狀態、捲動與圖片載入後的視角對齊

let activeTimerId = null;
let activeElement = null;
let activeClassName = 'highlighted';
let activeImageListenerCleanup = null;

/**
 * 清除當前啟用的高亮狀態與計時器
 */
export function clearActiveHighlight() {
  if (activeTimerId !== null) {
    clearTimeout(activeTimerId);
    activeTimerId = null;
  }

  if (activeImageListenerCleanup) {
    activeImageListenerCleanup();
    activeImageListenerCleanup = null;
  }

  if (activeElement && activeElement.classList && typeof activeElement.classList.remove === 'function') {
    activeElement.classList.remove(activeClassName);
  }

  activeElement = null;
}

/**
 * 取得當前高亮的 DOM 元素
 */
export function getActiveHighlightElement() {
  return activeElement;
}

/**
 * 重置高亮模組的所有內部狀態 (供測試與重置使用)
 */
export function resetHighlightState() {
  clearActiveHighlight();
  activeClassName = 'highlighted';
}

/**
 * 對指定的 DOM 元素套用高亮並平滑捲動至視窗中心
 *
 * @param {HTMLElement|null} element - 要高亮顯示的項目元素
 * @param {Object} [options={}] - 設定選項
 * @param {number} [options.duration=3000] - 高亮維持毫秒數
 * @param {string} [options.highlightClass='highlighted'] - 高亮 CSS class
 * @param {string} [options.scrollBehavior='smooth'] - 捲動動畫方式 ('smooth' | 'auto')
 * @param {string} [options.scrollBlock='center'] - 捲動垂直對齊位置 ('center' | 'nearest' | 'start' | 'end')
 * @param {boolean} [options.autoScroll=true] - 是否自動捲動至視窗
 * @param {boolean} [options.realignOnImageLoad=true] - 圖片載入完成後是否重新對齊
 * @returns {Object|null} 控制控制代碼或 null (若 element 無效)
 */
export function highlightAndScrollToItem(element, options = {}) {
  if (!element || !element.classList || typeof element.classList.add !== 'function') {
    return null;
  }

  const {
    duration = 3000,
    highlightClass = 'highlighted',
    scrollBehavior = 'smooth',
    scrollBlock = 'center',
    autoScroll = true,
    realignOnImageLoad = true
  } = options;

  // 1. 清除先前的任何高亮與計時器，避免連續點擊時的競爭條件 (Race Condition)
  clearActiveHighlight();

  // 2. 套用新高亮
  activeElement = element;
  activeClassName = highlightClass;
  element.classList.add(highlightClass);

  // 3. 執行置中捲動
  const doScroll = () => {
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: scrollBehavior, block: scrollBlock });
    }
  };

  if (autoScroll) {
    doScroll();
  }

  // 4. 監聽尚未載入完成的圖片，在圖片下載完成時重新對齊捲動位置
  if (realignOnImageLoad && typeof element.querySelector === 'function') {
    const img = element.querySelector('img');
    if (img && img.complete === false && typeof img.addEventListener === 'function') {
      const onImageLoad = () => {
        if (activeElement === element) {
          doScroll();
        }
      };

      img.addEventListener('load', onImageLoad, { once: true });
      activeImageListenerCleanup = () => {
        if (typeof img.removeEventListener === 'function') {
          img.removeEventListener('load', onImageLoad);
        }
      };
    }
  }

  // 5. 設定自動移除計時器
  activeTimerId = setTimeout(() => {
    if (activeElement === element) {
      clearActiveHighlight();
    }
  }, duration);

  return {
    element,
    cancel: () => {
      if (activeElement === element) {
        clearActiveHighlight();
      }
    }
  };
}
