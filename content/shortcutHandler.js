// content/shortcutHandler.js
// In-page keyboard shortcut listener for custom Search Shortcuts.
// Monitors keydown events, checks against configured engine shortcuts,
// validates editable context, and triggers adjacent search or in-page HUD toast.

/**
 * Normalizes a KeyboardEvent into a canonical shortcut string representation
 * (e.g. "Alt+M", "Ctrl+Shift+S", "Alt+1").
 * Returns an empty string if only modifier keys are pressed.
 * 
 * @param {KeyboardEvent} event 
 * @returns {string}
 */
export function formatKeyboardEvent(event) {
  if (!event || typeof event !== 'object') return '';

  const key = event.key || '';
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    return '';
  }

  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');

  let mainKey = '';
  if (event.code && event.code.startsWith('Key')) {
    mainKey = event.code.slice(3).toUpperCase();
  } else if (event.code && event.code.startsWith('Digit')) {
    mainKey = event.code.slice(5);
  } else if (event.code && event.code.startsWith('Numpad') && event.code.length > 6) {
    mainKey = event.code.slice(6);
  } else if (key && key.length === 1) {
    mainKey = key.toUpperCase();
  } else if (key) {
    mainKey = key;
  }

  if (!mainKey) return '';
  if (modifiers.length === 0) {
    return mainKey;
  }
  return `${modifiers.join('+')}+${mainKey}`;
}

/**
 * Checks whether an element is an editable input or textarea or has contentEditable enabled.
 * 
 * @param {Element|null} target 
 * @returns {boolean}
 */
export function isEditableElement(target) {
  if (!target || target.nodeType !== 1) return false;
  const tagName = target.tagName ? target.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return false;
}

/**
 * Checks if key event is a standard text editing command (e.g. Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+Z, Ctrl+X).
 * 
 * @param {KeyboardEvent} event 
 * @param {string} mainKey 
 * @returns {boolean}
 */
export function isStandardEditingCommand(event, mainKey) {
  if (!event) return false;
  const isCtrlOrMeta = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (!isCtrlOrMeta) return false;
  const upperKey = (mainKey || '').toUpperCase();
  return ['A', 'C', 'V', 'X', 'Z', 'Y'].includes(upperKey);
}

/**
 * In-page HUD toast notification for keyboard shortcut feedback.
 * 
 * @param {string} message 
 * @param {Object} [options={}]
 */
export function showShortcutToast(message, options = {}) {
  if (typeof document === 'undefined' || !document.body) return;

  const TOAST_ID = '__collection_search_shortcut_toast__';
  const existingToast = document.getElementById(TOAST_ID);
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.textContent = message;

  const isWarning = options.isWarning !== false;
  const bgColor = isWarning ? 'rgba(217, 119, 6, 0.95)' : 'rgba(30, 64, 175, 0.94)';

  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    padding: '10px 18px',
    background: bgColor,
    border: isWarning ? '1px solid rgba(253, 230, 138, 0.4)' : 'none',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.1)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    opacity: '0',
    transform: 'translateY(-10px) scale(0.96)',
    pointerEvents: 'none'
  });

  document.body.appendChild(toast);

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0) scale(1)';
    });
  } else {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  }

  const timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px) scale(0.96)';
    const subTimer = setTimeout(() => toast.remove(), 260);
    if (subTimer && typeof subTimer.unref === 'function') subTimer.unref();
  }, 2000);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

/**
 * Deep module for managing in-page custom keyboard shortcuts for Search Shortcuts.
 */
export class ShortcutHandler {
  constructor(options = {}) {
    this.engines = Array.isArray(options.engines) ? options.engines : [];
    this.storageAdapter = options.storageAdapter || null;
    this.targetWindow = options.targetWindow || (typeof window !== 'undefined' ? window : null);
    this.onExecute = options.onExecute || null;
    this.onToast = options.onToast || null;
    this.getSelection = options.getSelection || null;

    this.shortcutMap = new Map();
    this.keydownListener = null;
    this.storageListener = null;

    this.updateShortcutMap();
  }

  updateShortcutMap() {
    this.shortcutMap.clear();
    for (const engine of this.engines) {
      if (engine && typeof engine.shortcut === 'string' && engine.shortcut.trim()) {
        const canonical = engine.shortcut.trim().toLowerCase();
        this.shortcutMap.set(canonical, engine);
      }
    }
  }

  setEngines(engines) {
    this.engines = Array.isArray(engines) ? engines : [];
    this.updateShortcutMap();
  }

  /**
   * Processes a keydown event and triggers matching search shortcut.
   * 
   * @param {KeyboardEvent} event 
   * @returns {boolean} True if a shortcut was intercepted and processed.
   */
  handleKeyDown(event) {
    if (!event) return false;
    if (this.shortcutMap.size === 0) return false;

    const formatted = formatKeyboardEvent(event);
    if (!formatted) return false;

    const matchedEngine = this.shortcutMap.get(formatted.toLowerCase());
    if (!matchedEngine) return false;

    // Editable element conflict prevention (Q3)
    if (isEditableElement(event.target)) {
      // If shortcut has no modifier, do not intercept while typing
      if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        return false;
      }
      // Do not hijack standard editing commands like Ctrl+C, Ctrl+V, etc.
      const mainKey = formatted.split('+').pop();
      if (isStandardEditingCommand(event, mainKey)) {
        return false;
      }
    }

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }

    // Get selected text
    let selectedText = '';
    if (typeof this.getSelection === 'function') {
      selectedText = (this.getSelection() || '').toString();
    } else if (this.targetWindow && typeof this.targetWindow.getSelection === 'function') {
      selectedText = (this.targetWindow.getSelection()?.toString() || '');
    }
    selectedText = selectedText.trim();

    if (selectedText.length > 0) {
      if (typeof this.onExecute === 'function') {
        this.onExecute(matchedEngine, selectedText);
      } else if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({
          action: 'executeSearchShortcut',
          engineId: matchedEngine.id,
          query: selectedText
        });
      }
    } else {
      const warningMsg = '⚠️ 請先選取欲搜尋的文字';
      if (typeof this.onToast === 'function') {
        this.onToast(warningMsg, { isWarning: true });
      } else {
        showShortcutToast(warningMsg, { isWarning: true });
      }
    }

    return true;
  }

  /**
   * Initializes the shortcut handler with DOM and storage listeners.
   */
  async init() {
    // 1. Attach keydown listener to target window
    if (this.targetWindow && typeof this.targetWindow.addEventListener === 'function') {
      this.keydownListener = (event) => this.handleKeyDown(event);
      this.targetWindow.addEventListener('keydown', this.keydownListener, true);
    }

    // 2. Fetch initial search engines from storage
    if (this.storageAdapter && typeof this.storageAdapter.get === 'function') {
      try {
        const data = await this.storageAdapter.get('searchEngines');
        if (data && Array.isArray(data.searchEngines)) {
          this.setEngines(data.searchEngines);
        }
      } catch (err) {
        console.error('[ShortcutHandler] Failed to load engines from storage:', err);
      }
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['searchEngines'], (result) => {
        if (result && Array.isArray(result.searchEngines)) {
          this.setEngines(result.searchEngines);
        }
      });
    }

    // 3. Listen to storage changes to update shortcuts dynamically
    if (this.storageAdapter && typeof this.storageAdapter.onChanged === 'function') {
      this.storageListener = this.storageAdapter.onChanged((changes) => {
        if (changes.searchEngines && Array.isArray(changes.searchEngines.newValue)) {
          this.setEngines(changes.searchEngines.newValue);
        }
      });
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      this.storageListener = (changes, area) => {
        if (area === 'local' && changes.searchEngines && Array.isArray(changes.searchEngines.newValue)) {
          this.setEngines(changes.searchEngines.newValue);
        }
      };
      chrome.storage.onChanged.addListener(this.storageListener);
    }
  }

  /**
   * Destroys the handler and unbinds all listeners.
   */
  destroy() {
    if (this.targetWindow && this.keydownListener && typeof this.targetWindow.removeEventListener === 'function') {
      this.targetWindow.removeEventListener('keydown', this.keydownListener, true);
      this.keydownListener = null;
    }

    if (typeof this.storageListener === 'function') {
      this.storageListener();
      this.storageListener = null;
    } else if (this.storageListener && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }
  }
}

/**
 * Entrypoint helper called by content script loader.
 */
export async function initShortcutHandler() {
  const handler = new ShortcutHandler();
  await handler.init();
  return handler;
}
