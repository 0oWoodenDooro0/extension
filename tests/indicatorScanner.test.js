import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IndicatorScanner, initIndicatorScanner } from '../content/indicatorScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indicatorScannerCss = fs.readFileSync(path.resolve(__dirname, '../content/indicatorScanner.css'), 'utf8');

// DOM test helpers
function createTestDom() {
  function createTextNode(text) {
    const node = {
      nodeType: 3,
      nodeValue: String(text),
      get textContent() {
        return this.nodeValue;
      },
      set textContent(val) {
        this.nodeValue = String(val);
      },
      parentElement: null,
      parentNode: null,
      splitText(offset) {
        const fullText = this.nodeValue;
        const before = fullText.slice(0, offset);
        const after = fullText.slice(offset);
        this.nodeValue = before;
        const newTextNode = createTextNode(after);
        if (this.parentNode && typeof this.parentNode.insertBefore === 'function') {
          this.parentNode.insertBefore(newTextNode, this.nextSibling);
        }
        return newTextNode;
      },
      get nextSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.childNodes;
        const idx = siblings.indexOf(this);
        return idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
      },
      get previousSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.childNodes;
        const idx = siblings.indexOf(this);
        return idx > 0 ? siblings[idx - 1] : null;
      }
    };
    return node;
  }

  function createElement(tagName) {
    const classes = new Set();
    const children = [];
    const childNodes = [];
    const listeners = new Map();
    const attributes = new Map();
    let _parentElement = null;
    let _id = '';

    const el = {
      tagName: tagName.toUpperCase(),
      style: {},
      dataset: {},
      get id() {
        return _id;
      },
      set id(val) {
        _id = String(val);
      },
      get parentElement() {
        return _parentElement;
      },
      set parentElement(val) {
        _parentElement = val;
      },
      get parentNode() {
        return _parentElement;
      },
      set parentNode(val) {
        _parentElement = val;
      },
      get nextSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.childNodes;
        const idx = siblings.indexOf(this);
        return idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
      },
      get previousSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.childNodes;
        const idx = siblings.indexOf(this);
        return idx > 0 ? siblings[idx - 1] : null;
      },
      get className() {
        return Array.from(classes).join(' ');
      },
      set className(val) {
        classes.clear();
        if (val) {
          val.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
        }
      },
      classList: {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: (name) => classes.has(name)
      },
      setAttribute(name, val) {
        attributes.set(name, String(val));
        if (name === 'title') el.title = String(val);
        if (name === 'href') el.href = String(val);
      },
      getAttribute(name) {
        if (name === 'title' && el.title !== undefined) return el.title;
        if (name === 'href' && el.href !== undefined) return el.href;
        return attributes.get(name) || null;
      },
      hasAttribute(name) {
        return attributes.has(name) || (name === 'title' && el.title !== undefined);
      },
      get textContent() {
        return childNodes.map(n => (n.nodeType === 3 ? n.nodeValue : n.textContent || '')).join('');
      },
      set textContent(val) {
        while (childNodes.length > 0) {
          this.removeChild(childNodes[0]);
        }
        if (val) {
          this.appendChild(createTextNode(val));
        }
      },
      get children() {
        return children;
      },
      get childNodes() {
        return childNodes;
      },
      appendChild(child) {
        if (!child) return child;
        child.parentElement = el;
        child.parentNode = el;
        childNodes.push(child);
        if (child.nodeType === 1) {
          children.push(child);
        }
        return child;
      },
      insertBefore(newNode, referenceNode) {
        if (!newNode) return newNode;
        newNode.parentElement = el;
        newNode.parentNode = el;
        if (!referenceNode) {
          return this.appendChild(newNode);
        }
        const index = childNodes.indexOf(referenceNode);
        if (index === -1) {
          return this.appendChild(newNode);
        }
        childNodes.splice(index, 0, newNode);
        if (newNode.nodeType === 1) {
          const childIndex = children.indexOf(referenceNode);
          if (childIndex !== -1) {
            children.splice(childIndex, 0, newNode);
          } else {
            children.push(newNode);
          }
        }
        return newNode;
      },
      insertAdjacentElement(position, element) {
        if (position === 'afterend' && el.parentNode) {
          return el.parentNode.insertBefore(element, el.nextSibling);
        }
        if (position === 'beforebegin' && el.parentNode) {
          return el.parentNode.insertBefore(element, el);
        }
        if (position === 'afterbegin') {
          return el.insertBefore(element, el.childNodes[0] || null);
        }
        if (position === 'beforeend') {
          return el.appendChild(element);
        }
        return null;
      },
      removeChild(child) {
        const idx = childNodes.indexOf(child);
        if (idx !== -1) {
          childNodes.splice(idx, 1);
          child.parentElement = null;
          child.parentNode = null;
        }
        const cIdx = children.indexOf(child);
        if (cIdx !== -1) {
          children.splice(cIdx, 1);
        }
        return child;
      },
      addEventListener(type, handler) {
        if (!listeners.has(type)) {
          listeners.set(type, []);
        }
        listeners.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        if (listeners.has(type)) {
          listeners.set(type, listeners.get(type).filter(h => h !== handler));
        }
      },
      dispatchEvent(event) {
        if (!event.target) event.target = el;
        event.currentTarget = el;
        const handlers = [...(listeners.get(event.type) || [])];
        for (const handler of handlers) {
          handler.call(el, event);
        }
        if (!event.propagationStopped && !event.immediatePropagationStopped) {
          if (_parentElement && typeof _parentElement.dispatchEvent === 'function') {
            _parentElement.dispatchEvent(event);
          }
        }
        return !event.defaultPrevented;
      },
      closest(selector) {
        let current = el;
        while (current) {
          if (current.nodeType === 1) {
            if (selector.startsWith('.') && current.classList.contains(selector.slice(1))) {
              return current;
            }
            if (selector.startsWith('#') && current.id === selector.slice(1)) {
              return current;
            }
            if (current.tagName.toLowerCase() === selector.toLowerCase()) {
              return current;
            }
          }
          current = current.parentElement;
        }
        return null;
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const results = [];
        function walk(node) {
          for (const child of node.children) {
            let matched;
            if (selector.startsWith('.')) {
              matched = child.classList.contains(selector.slice(1));
            } else if (selector.startsWith('#')) {
              matched = child.id === selector.slice(1);
            } else {
              matched = child.tagName.toLowerCase() === selector.toLowerCase();
            }
            if (matched) {
              results.push(child);
            }
            walk(child);
          }
        }
        walk(el);
        return results;
      },
      nodeType: 1
    };
    return el;
  }

  const doc = {
    createElement,
    createTextNode,
    body: createElement('body')
  };

  return { doc, createElement, createTextNode };
}

describe('In-Page DOM Text Scanner & Checkmark Indicator (Ticket #21)', () => {
  let dom;
  let originalDocument;

  beforeEach(() => {
    dom = createTestDom();
    originalDocument = globalThis.document;
    globalThis.document = dom.doc;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  describe('Seam 1: Text Node & Link Traversal and Checkmark Badge Injection', () => {
    it('scans visible text nodes and injects checkmark badge directly behind matched identifier tokens', () => {
      const p = dom.createElement('p');
      p.appendChild(dom.createTextNode('Reference manual for item DOC-101 in library.'));
      dom.doc.body.appendChild(p);

      const items = [
        { id: 'item-1', title: 'API Documentation 101', identifier: 'DOC-101', url: 'https://docs.example.com/101' }
      ];

      const scanner = new IndicatorScanner({ root: dom.doc.body, items });
      scanner.scan();

      const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badges.length, 1, 'Should inject exactly 1 checkmark badge');

      const badge = badges[0];
      assert.strictEqual(badge.textContent.includes('✓'), true, 'Badge should display checkmark symbol');
      assert.strictEqual(badge.title, 'API Documentation 101', 'Badge title attribute should match Collection Item title');
      assert.strictEqual(badge.dataset.itemId, 'item-1', 'Badge should reference item ID');

      // Check text node splitting: node before badge must be "DOC-101"
      const prevNode = badge.previousSibling;
      assert.ok(prevNode, 'Badge should have previousSibling');
      assert.strictEqual(prevNode.nodeType, 3, 'previousSibling should be text node');
      assert.strictEqual(prevNode.nodeValue, 'DOC-101', 'Node directly preceding badge should be matched token');

      // Check full paragraph text remains intact
      assert.strictEqual(
        p.textContent.includes('Reference manual for item DOC-101'),
        true,
        'Original text content is preserved without corruption'
      );
    });

    it('matches multiple identifier tokens case-insensitively across text nodes', () => {
      const p = dom.createElement('p');
      p.appendChild(dom.createTextNode('Items doc-101 and RFC-202 both exist.'));
      dom.doc.body.appendChild(p);

      const items = [
        { id: 'item-1', title: 'API Documentation 101', identifier: 'DOC-101', url: 'https://docs.example.com/101' },
        { id: 'item-2', title: 'Network Protocol RFC 202', identifier: 'rfc-202', url: 'https://rfc.example.com/202' }
      ];

      const scanner = new IndicatorScanner({ root: dom.doc.body, items });
      scanner.scan();

      const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badges.length, 2, 'Should inject badges for both items');
      assert.strictEqual(badges[0].dataset.itemId, 'item-1');
      assert.strictEqual(badges[1].dataset.itemId, 'item-2');
    });

    it('injects badge directly behind anchor tags without mutating original href or breaking listeners', () => {
      const link = dom.createElement('a');
      link.setAttribute('href', 'https://example.com/spec/DOC-101');
      link.appendChild(dom.createTextNode('Specification Link'));
      let linkClicked = false;
      link.addEventListener('click', () => {
        linkClicked = true;
      });
      dom.doc.body.appendChild(link);

      const items = [
        { id: 'item-1', title: 'API Documentation 101', identifier: 'DOC-101', url: 'https://example.com/spec/DOC-101' }
      ];

      const scanner = new IndicatorScanner({ root: dom.doc.body, items });
      scanner.scan();

      // Original link href must not be mutated
      assert.strictEqual(link.getAttribute('href'), 'https://example.com/spec/DOC-101');

      // Check badge position: directly behind the link
      const badge = link.nextSibling;
      assert.ok(badge, 'Badge should be directly after link');
      assert.strictEqual(badge.classList.contains('collection-identifier-mark'), true);
      assert.strictEqual(badge.dataset.itemId, 'item-1');

      // Link listener must remain intact
      const clickEvent = { type: 'click', target: link };
      link.dispatchEvent(clickEvent);
      assert.strictEqual(linkClicked, true, 'Link event listener still works');
    });

    it('ignores script, style, textarea, input, and hidden tags', () => {
      const script = dom.createElement('script');
      script.appendChild(dom.createTextNode('const x = "DOC-101";'));
      dom.doc.body.appendChild(script);

      const input = dom.createElement('input');
      input.setAttribute('value', 'DOC-101');
      dom.doc.body.appendChild(input);

      const hiddenDiv = dom.createElement('div');
      hiddenDiv.style.display = 'none';
      hiddenDiv.appendChild(dom.createTextNode('Hidden DOC-101'));
      dom.doc.body.appendChild(hiddenDiv);

      const items = [
        { id: 'item-1', title: 'API Documentation 101', identifier: 'DOC-101', url: 'https://docs.example.com/101' }
      ];

      const scanner = new IndicatorScanner({ root: dom.doc.body, items });
      scanner.scan();

      const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badges.length, 0, 'Must not inject badges into ignored or hidden elements');
    });
  });

  describe('Seam 2: Tooltip Rendering & Click Isolation', () => {
    it('renders a styled tooltip element with item title and toggles visibility on hover', () => {
      const p = dom.createElement('p');
      p.appendChild(dom.createTextNode('Item ISBN-999 is stored.'));
      dom.doc.body.appendChild(p);

      const items = [
        { id: 'item-isbn', title: 'The Master Algorithm Book', identifier: 'ISBN-999', url: 'https://books.example.com/999' }
      ];

      const scanner = new IndicatorScanner({ root: dom.doc.body, items });
      scanner.scan();

      const badge = dom.doc.body.querySelector('.collection-identifier-mark');
      assert.ok(badge, 'Badge must exist');

      const tooltip = badge.querySelector('.collection-identifier-tooltip');
      assert.ok(tooltip, 'Tooltip element must be rendered inside badge');
      assert.strictEqual(tooltip.textContent, 'The Master Algorithm Book', 'Tooltip text matches Collection Item title');

      // Test hover interaction
      badge.dispatchEvent({ type: 'mouseenter', target: badge });
      assert.strictEqual(badge.classList.contains('tooltip-visible'), true, 'mouseenter should add tooltip-visible class');

      badge.dispatchEvent({ type: 'mouseleave', target: badge });
      assert.strictEqual(badge.classList.contains('tooltip-visible'), false, 'mouseleave should remove tooltip-visible class');
    });

    it('clicking badge stops propagation, prevents default navigation, and dispatches revealItem message', () => {
      // Simulate parent anchor with navigation listener
      const parentLink = dom.createElement('a');
      parentLink.setAttribute('href', 'https://outer-site.com/destination');
      let parentNavigated = false;
      parentLink.addEventListener('click', () => {
        parentNavigated = true;
      });

      const textNode = dom.createTextNode('Check SEC-42 details.');
      parentLink.appendChild(textNode);
      dom.doc.body.appendChild(parentLink);

      let dispatchedMessage = null;
      const originalChrome = globalThis.chrome;
      globalThis.chrome = {
        runtime: {
          sendMessage: (msg, callback) => {
            dispatchedMessage = msg;
            if (typeof callback === 'function') callback();
          }
        }
      };

      try {
        const items = [
          { id: 'item-sec', title: 'Security Protocol 42', identifier: 'SEC-42', url: 'https://security.example.com/42' }
        ];

        let badgeCallbackInvoked = false;
        const scanner = new IndicatorScanner({
          root: dom.doc.body,
          items,
          onBadgeClick: (item) => {
            badgeCallbackInvoked = true;
            assert.strictEqual(item.id, 'item-sec');
          }
        });
        scanner.scan();

        const badge = parentLink.querySelector('.collection-identifier-mark');
        assert.ok(badge, 'Badge should be inside parentLink behind SEC-42');

        // Click badge
        let defaultPrevented = false;
        let propagationStopped = false;
        let immediateStopped = false;
        const clickEvent = {
          type: 'click',
          target: badge,
          get defaultPrevented() { return defaultPrevented; },
          get propagationStopped() { return propagationStopped; },
          get immediatePropagationStopped() { return immediateStopped; },
          preventDefault: () => { defaultPrevented = true; },
          stopPropagation: () => { propagationStopped = true; },
          stopImmediatePropagation: () => { immediateStopped = true; }
        };

        badge.dispatchEvent(clickEvent);

        // Verification of click isolation
        assert.strictEqual(defaultPrevented, true, 'e.preventDefault() must be called to block parent link navigation');
        assert.strictEqual(propagationStopped, true, 'e.stopPropagation() must be called');
        assert.strictEqual(immediateStopped, true, 'e.stopImmediatePropagation() must be called');
        assert.strictEqual(parentNavigated, false, 'Parent link click handler must NOT be triggered');
        assert.strictEqual(badgeCallbackInvoked, true, 'onBadgeClick callback must be invoked');

        // Verification of runtime message
        assert.ok(dispatchedMessage, 'A runtime message must be dispatched');
        assert.strictEqual(dispatchedMessage.action, 'revealItem');
        assert.strictEqual(dispatchedMessage.itemId, 'item-sec');
      } finally {
        globalThis.chrome = originalChrome;
      }
    });
  });

  describe('Seam 3: Dynamic DOM Insertions & Debounced MutationObserver', () => {
    let originalMutationObserver;

    beforeEach(() => {
      originalMutationObserver = globalThis.MutationObserver;
    });

    afterEach(() => {
      globalThis.MutationObserver = originalMutationObserver;
    });

    it('observes dynamic node additions with debouncing and avoids re-badging', async () => {
      class MockMutationObserver {
        constructor(callback) {
          this.callback = callback;
          this.target = null;
          MockMutationObserver.instances.push(this);
        }
        observe(target, options) {
          this.target = target;
          this.options = options;
        }
        disconnect() {
          this.target = null;
          const idx = MockMutationObserver.instances.indexOf(this);
          if (idx !== -1) MockMutationObserver.instances.splice(idx, 1);
        }
        notify(mutations) {
          this.callback(mutations, this);
        }
      }
      MockMutationObserver.instances = [];
      globalThis.MutationObserver = MockMutationObserver;

      const items = [
        { id: 'item-spa', title: 'SPA Component Guide', identifier: 'SPA-800', url: 'https://spa.example.com/800' }
      ];

      const scanner = new IndicatorScanner({
        root: dom.doc.body,
        items,
        debounceMs: 20
      });

      scanner.startObserver();
      assert.strictEqual(MockMutationObserver.instances.length, 1, 'MutationObserver must be instantiated');

      // Dynamically add a container to the DOM
      const newDiv = dom.createElement('div');
      newDiv.appendChild(dom.createTextNode('Dynamic SPA content with SPA-800 loaded.'));
      dom.doc.body.appendChild(newDiv);

      // Trigger mutation observer callback
      const mockObserver = MockMutationObserver.instances[0];
      mockObserver.notify([
        {
          type: 'childList',
          addedNodes: [newDiv]
        }
      ]);

      // Before debounce fires, no badge yet
      assert.strictEqual(dom.doc.body.querySelectorAll('.collection-identifier-mark').length, 0);

      // Wait for debounce timer to fire
      await new Promise((r) => setTimeout(r, 40));

      const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badges.length, 1, 'Debounced observer should trigger scan on dynamic content');
      assert.strictEqual(badges[0].dataset.itemId, 'item-spa');

      // Trigger mutation again without changes to verify idempotent/safe re-scanning
      mockObserver.notify([
        {
          type: 'childList',
          addedNodes: [newDiv]
        }
      ]);
      await new Promise((r) => setTimeout(r, 40));

      const badgesAfter = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badgesAfter.length, 1, 'Must not create duplicate badges on re-scan');

      // Disconnect observer
      scanner.disconnect();
      assert.strictEqual(MockMutationObserver.instances.length, 0, 'disconnect() must tear down observer');
    });
  });

  describe('Seam 4: Storage & Runtime Message Synchronization', () => {
    it('retrieves active items with non-empty identifiers from storageAdapter', async () => {
      const storageData = {
        items: [
          { id: '1', title: 'Item 1', identifier: 'ID-001' },
          { id: '2', title: 'Item 2', identifier: '' },
          { id: '3', title: 'Item 3', identifier: null },
          { id: '4', title: 'Item 4' },
          { id: '5', title: 'Item 5', identifier: '  ID-005  ' }
        ]
      };

      const storageAdapter = {
        get: async (keys) => {
          if (keys.includes('items')) return { items: storageData.items };
          return {};
        },
        onChanged: () => () => {}
      };

      const p = dom.createElement('p');
      p.appendChild(dom.createTextNode('Found ID-001 and ID-005 here.'));
      dom.doc.body.appendChild(p);

      const scanner = new IndicatorScanner({
        root: dom.doc.body,
        storageAdapter
      });

      await scanner.loadFromStorage();
      scanner.scan();

      const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badges.length, 2, 'Should only match items with non-empty identifiers');
      assert.strictEqual(badges[0].dataset.itemId, '1');
      assert.strictEqual(badges[1].dataset.itemId, '5');
    });

    it('updates indicators when storage onChanged fires with new items', async () => {
      let storageChangeCallback = null;
      const storageAdapter = {
        get: async () => ({ items: [] }),
        onChanged: (cb) => {
          storageChangeCallback = cb;
          return () => { storageChangeCallback = null; };
        }
      };

      const p = dom.createElement('p');
      p.appendChild(dom.createTextNode('Document has NEW-777.'));
      dom.doc.body.appendChild(p);

      const scanner = new IndicatorScanner({
        root: dom.doc.body,
        storageAdapter
      });

      await scanner.loadFromStorage();
      scanner.scan();

      assert.strictEqual(dom.doc.body.querySelectorAll('.collection-identifier-mark').length, 0);

      // Trigger storage change
      assert.ok(storageChangeCallback, 'Storage onChanged listener should be registered');
      storageChangeCallback(
        {
          items: {
            newValue: [{ id: '777', title: 'New Item 777', identifier: 'NEW-777' }]
          }
        },
        'local'
      );

      const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badges.length, 1, 'Should scan and inject badge after storage update');
      assert.strictEqual(badges[0].dataset.itemId, '777');

      scanner.disconnect();
      assert.strictEqual(storageChangeCallback, null, 'disconnect() must remove storage listener');
    });

    it('listens for runtime messages to update identifiers', () => {
      let runtimeMessageListener = null;
      const originalChrome = globalThis.chrome;
      globalThis.chrome = {
        runtime: {
          onMessage: {
            addListener: (fn) => { runtimeMessageListener = fn; },
            removeListener: (fn) => {
              if (runtimeMessageListener === fn) runtimeMessageListener = null;
            }
          }
        }
      };

      try {
        const p = dom.createElement('p');
        p.appendChild(dom.createTextNode('Mentioning MSG-99 in content.'));
        dom.doc.body.appendChild(p);

        const scanner = new IndicatorScanner({
          root: dom.doc.body,
          items: []
        });

        scanner.startMessageListener();
        assert.ok(runtimeMessageListener, 'Message listener should be registered');

        let ack = null;
        runtimeMessageListener(
          {
            action: 'updateIdentifiers',
            items: [{ id: 'msg-item', title: 'Message Item 99', identifier: 'MSG-99' }]
          },
          {},
          (res) => { ack = res; }
        );

        assert.strictEqual(ack?.success, true);
        const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
        assert.strictEqual(badges.length, 1);
        assert.strictEqual(badges[0].dataset.itemId, 'msg-item');

        scanner.disconnect();
        assert.strictEqual(runtimeMessageListener, null, 'disconnect() must remove message listener');
      } finally {
        globalThis.chrome = originalChrome;
      }
    });

    it('initIndicatorScanner factory initializes scanner, loads storage, scans DOM, and attaches listeners', async () => {
      let storageRequested = false;
      const storageAdapter = {
        get: async () => {
          storageRequested = true;
          return {
            items: [{ id: 'init-1', title: 'Factory Item', identifier: 'FACT-1' }]
          };
        },
        onChanged: () => () => {}
      };

      const p = dom.createElement('p');
      p.appendChild(dom.createTextNode('Testing FACT-1 inline.'));
      dom.doc.body.appendChild(p);

      const scanner = await initIndicatorScanner({
        root: dom.doc.body,
        storageAdapter
      });

      assert.strictEqual(storageRequested, true, 'Storage must be queried during initialization');
      const badges = dom.doc.body.querySelectorAll('.collection-identifier-mark');
      assert.strictEqual(badges.length, 1, 'Initial scan must be executed upon initialization');
      assert.strictEqual(badges[0].dataset.itemId, 'init-1');

      scanner.disconnect();
    });
  });

  describe('CSS Isolation & Scoped Styles (content/indicatorScanner.css)', () => {
    it('defines isolated, scoped reset rules and styling for checkmark badge', () => {
      assert.strictEqual(indicatorScannerCss.includes('.collection-identifier-mark'), true);
      assert.strictEqual(indicatorScannerCss.includes('all: initial'), true, 'Should use all: initial for isolation');
      assert.strictEqual(indicatorScannerCss.includes('cursor: pointer'), true);
      assert.strictEqual(indicatorScannerCss.includes('border-radius: 50%'), true);
      assert.strictEqual(indicatorScannerCss.includes('.collection-identifier-mark:hover'), true);
    });

    it('defines isolated tooltip styles and hover visibility', () => {
      assert.strictEqual(indicatorScannerCss.includes('.collection-identifier-mark .collection-identifier-tooltip'), true);
      assert.strictEqual(indicatorScannerCss.includes('pointer-events: none'), true);
      assert.strictEqual(indicatorScannerCss.includes('visibility: hidden'), true);
      assert.strictEqual(indicatorScannerCss.includes('.collection-identifier-mark:hover .collection-identifier-tooltip'), true);
    });
  });
});
