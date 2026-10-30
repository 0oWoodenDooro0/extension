// content/indicatorScanner.js
// In-page DOM text scanner that inspects visible text nodes and anchor tags against collected identifiers
// and injects isolated inline checkmark indicator badges directly behind matches.

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TEXTAREA',
  'INPUT',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'CANVAS',
  'IFRAME',
  'SELECT',
  'OPTION'
]);

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a regex pattern matching an identifier as a token
 */
function buildTokenPattern(identifier) {
  const escaped = escapeRegExp(identifier.trim());
  const startsWithWord = /^\w/.test(escaped);
  const endsWithWord = /\w$/.test(escaped);

  const prefix = startsWithWord ? '(?<!\\w)' : '';
  const suffix = endsWithWord ? '(?!\\w)' : '';
  return `${prefix}${escaped}${suffix}`;
}

/**
 * Checks whether an element is visible
 */
function isElementVisible(el) {
  if (!el || el.nodeType !== 1) return true;
  if (el.hidden) return false;
  if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) {
    return false;
  }
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const style = window.getComputedStyle(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return false;
      }
    } catch {
      // ignore
    }
  }
  return true;
}

export class IndicatorScanner {
  constructor(options = {}) {
    this.root = options.root || (typeof document !== 'undefined' ? document.body : null);
    this.storageAdapter = options.storageAdapter || null;
    this.onBadgeClick = options.onBadgeClick || null;
    this.debounceMs = options.debounceMs !== undefined ? options.debounceMs : 150;
    this.isScanning = false;
    this.debounceTimer = null;
    this.observer = null;
    this.storageUnsubscribe = null;
    this.messageListener = null;

    this.setItems(options.items || []);
  }

  setItems(items) {
    if (!Array.isArray(items)) {
      this.items = [];
      this.identifierMap = new Map();
      this.combinedRegex = null;
      return;
    }

    // Keep active Collection Items with non-empty identifiers
    this.items = items.filter(
      (item) => item && typeof item.identifier === 'string' && item.identifier.trim().length > 0
    );

    this.identifierMap = new Map();
    const patterns = [];

    for (const item of this.items) {
      const cleanIdent = item.identifier.trim();
      const lower = cleanIdent.toLowerCase();
      if (!this.identifierMap.has(lower)) {
        this.identifierMap.set(lower, item);
        patterns.push(buildTokenPattern(cleanIdent));
      }
    }

    if (patterns.length > 0) {
      // Sort patterns by length descending to match longer identifiers first
      patterns.sort((a, b) => b.length - a.length);
      this.combinedRegex = new RegExp(patterns.join('|'), 'gi');
    } else {
      this.combinedRegex = null;
    }
  }

  createBadgeElement(item) {
    const doc = (this.root && this.root.ownerDocument) || globalThis.document;
    const badge = doc.createElement('span');
    badge.className = 'collection-identifier-mark';
    badge.setAttribute('title', item.title || '');
    badge.title = item.title || '';
    badge.dataset.itemId = item.id || '';
    badge.dataset.identifier = item.identifier || '';

    // Visible checkmark
    const checkmarkNode = doc.createTextNode('✓');
    badge.appendChild(checkmarkNode);

    // Styled Tooltip element
    const tooltip = doc.createElement('span');
    tooltip.className = 'collection-identifier-tooltip';
    tooltip.textContent = item.title || '';
    badge.appendChild(tooltip);

    // Hover tooltip handlers
    badge.addEventListener('mouseenter', () => {
      badge.classList.add('tooltip-visible');
    });
    badge.addEventListener('mouseleave', () => {
      badge.classList.remove('tooltip-visible');
    });

    // Click handler with propagation and navigation prevention
    badge.addEventListener('click', (e) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }
      if (e && typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      if (typeof this.onBadgeClick === 'function') {
        this.onBadgeClick(item, e);
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        try {
          chrome.runtime.sendMessage({
            action: 'revealItem',
            itemId: item.id,
            identifier: item.identifier,
            title: item.title,
            item
          }, () => {
            if (chrome.runtime.lastError) {
              // Ignore error if sidebar is not open
            }
          });
        } catch {
          // ignore
        }
      }
    });

    return badge;
  }

  scan(targetNode = null) {
    if (!this.combinedRegex || this.items.length === 0) return;
    const rootNode = targetNode || this.root;
    if (!rootNode) return;

    this.isScanning = true;
    try {
      this.scanTextNodes(rootNode);
      this.scanAnchorTags(rootNode);
    } finally {
      this.isScanning = false;
    }
  }

  scanTextNodes(container) {
    const textNodes = [];

    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) { // ELEMENT_NODE
        const tag = node.tagName.toUpperCase();
        if (IGNORED_TAGS.has(tag)) return;
        if (node.classList && (node.classList.contains('collection-identifier-mark') || node.classList.contains('collection-identifier-tooltip'))) {
          return;
        }
        if (!isElementVisible(node)) return;
      } else if (node.nodeType === 3) { // TEXT_NODE
        textNodes.push(node);
        return;
      }

      if (node.childNodes) {
        const children = Array.from(node.childNodes);
        for (const child of children) {
          walk(child);
        }
      }
    };

    walk(container);

    for (const textNode of textNodes) {
      this.processTextNode(textNode);
    }
  }

  processTextNode(textNode) {
    if (!textNode || !textNode.parentNode || !textNode.nodeValue) return;

    // Check parent element
    const parent = textNode.parentElement || textNode.parentNode;
    if (parent && parent.classList && (parent.classList.contains('collection-identifier-mark') || parent.classList.contains('collection-identifier-tooltip'))) {
      return;
    }

    let currentNode = textNode;
    const regex = new RegExp(this.combinedRegex.source, this.combinedRegex.flags);

    let match;
    while (currentNode && currentNode.nodeValue && (match = regex.exec(currentNode.nodeValue)) !== null) {
      const matchText = match[0];
      const matchIndex = match.index;
      const matchLength = matchText.length;

      const item = this.identifierMap.get(matchText.toLowerCase());
      if (!item) {
        // No item matched this token
        continue;
      }

      // Check if node is already badged directly behind
      if (
        matchIndex + matchLength === currentNode.nodeValue.length &&
        currentNode.nextSibling &&
        currentNode.nextSibling.classList &&
        currentNode.nextSibling.classList.contains('collection-identifier-mark')
      ) {
        break;
      }

      // Split text node:
      // 1. Text before match
      const matchedNode = currentNode.splitText(matchIndex);
      // 2. Text after match
      const remainingNode = matchedNode.splitText(matchLength);

      // Create and inject badge directly behind matchedNode
      const badge = this.createBadgeElement(item);
      if (matchedNode.parentNode) {
        matchedNode.parentNode.insertBefore(badge, remainingNode);
      }

      currentNode = remainingNode;
      regex.lastIndex = 0;
    }
  }

  scanAnchorTags(container) {
    if (!container) return;
    const anchors = typeof container.querySelectorAll === 'function' ? container.querySelectorAll('a') : [];
    for (const a of anchors) {
      if (a.classList && a.classList.contains('collection-identifier-mark')) continue;
      // If anchor already contains a checkmark badge or has one directly after, skip
      if (typeof a.querySelector === 'function' && a.querySelector('.collection-identifier-mark')) continue;
      if (a.nextSibling && a.nextSibling.classList && a.nextSibling.classList.contains('collection-identifier-mark')) continue;

      const href = a.getAttribute('href') || a.href || '';
      if (!href) continue;

      for (const item of this.items) {
        const cleanIdent = item.identifier.trim();
        const pattern = new RegExp(buildTokenPattern(cleanIdent), 'i');
        if (pattern.test(href)) {
          const badge = this.createBadgeElement(item);
          if (typeof a.insertAdjacentElement === 'function') {
            a.insertAdjacentElement('afterend', badge);
          } else if (a.parentNode) {
            a.parentNode.insertBefore(badge, a.nextSibling);
          }
          break;
        }
      }
    }
  }

  debouncedScan() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.scan();
    }, this.debounceMs);
  }

  startObserver(targetNode = null) {
    const rootNode = targetNode || this.root;
    if (!rootNode) return;
    const ObserverClass = typeof MutationObserver !== 'undefined'
      ? MutationObserver
      : (typeof globalThis !== 'undefined' ? globalThis.MutationObserver : null);

    if (!ObserverClass) return;

    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new ObserverClass((mutations) => {
      if (this.isScanning) return;

      let hasRelevantChange = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const added = mutation.addedNodes || [];
          for (const node of added) {
            if (
              node.nodeType === 1 &&
              node.classList &&
              (node.classList.contains('collection-identifier-mark') ||
                node.classList.contains('collection-identifier-tooltip'))
            ) {
              continue;
            }
            hasRelevantChange = true;
            break;
          }
        }
        if (hasRelevantChange) break;
      }

      if (hasRelevantChange) {
        this.debouncedScan();
      }
    });

    this.observer.observe(rootNode, {
      childList: true,
      subtree: true
    });
  }

  disconnect() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (typeof this.storageUnsubscribe === 'function') {
      this.storageUnsubscribe();
      this.storageUnsubscribe = null;
    }
    if (this.messageListener && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }
  }

  async loadFromStorage() {
    let items = [];
    if (this.storageAdapter && typeof this.storageAdapter.get === 'function') {
      const res = await this.storageAdapter.get(['items']);
      items = res?.items || [];
      if (typeof this.storageAdapter.onChanged === 'function' && !this.storageUnsubscribe) {
        this.storageUnsubscribe = this.storageAdapter.onChanged((changes) => {
          if (changes && changes.items && changes.items.newValue) {
            this.setItems(changes.items.newValue);
            this.scan();
          }
        });
      }
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      items = await new Promise((resolve) => {
        chrome.storage.local.get(['items'], (result) => {
          resolve(result?.items || []);
        });
      });
      if (chrome.storage.onChanged && !this.storageUnsubscribe) {
        const listener = (changes, area) => {
          if (area === 'local' && changes.items && changes.items.newValue) {
            this.setItems(changes.items.newValue);
            this.scan();
          }
        };
        chrome.storage.onChanged.addListener(listener);
        this.storageUnsubscribe = () => chrome.storage.onChanged.removeListener(listener);
      }
    }

    this.setItems(items);
  }

  startMessageListener() {
    if (this.messageListener) return;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      this.messageListener = (request, sender, sendResponse) => {
        if (!request || typeof request !== 'object') return false;
        if (request.action === 'updateIdentifiers' && Array.isArray(request.items)) {
          this.setItems(request.items);
          this.scan();
          if (typeof sendResponse === 'function') sendResponse({ success: true });
          return true;
        }
        if (request.action === 'rescanIdentifiers') {
          this.scan();
          if (typeof sendResponse === 'function') sendResponse({ success: true });
          return true;
        }
        return false;
      };
      chrome.runtime.onMessage.addListener(this.messageListener);
    }
  }
}

/**
 * Initializes the in-page DOM text scanner with storage synchronization and MutationObserver.
 */
export async function initIndicatorScanner(options = {}) {
  const scanner = new IndicatorScanner(options);
  await scanner.loadFromStorage();
  scanner.scan();
  scanner.startObserver();
  scanner.startMessageListener();
  return scanner;
}

// Auto-initialize when loaded in an active browser tab (and not in unit tests)
if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof chrome !== 'undefined' &&
  chrome.runtime &&
  chrome.runtime.id &&
  !globalThis.__IS_UNIT_TEST__
) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initIndicatorScanner().catch((err) => {
        console.error('[IndicatorScanner] Auto-initialization error:', err);
      });
    });
  } else {
    initIndicatorScanner().catch((err) => {
      console.error('[IndicatorScanner] Auto-initialization error:', err);
    });
  }
}

