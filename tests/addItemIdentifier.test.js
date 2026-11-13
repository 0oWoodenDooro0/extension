import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function createChromeMock(initialStorage, activeTab) {
  const storage = JSON.parse(JSON.stringify(initialStorage));
  const changeListeners = new Set();

  return {
    storage: {
      local: {
        get(keys, cb) {
          const result = {};
          const keyList = Array.isArray(keys)
            ? keys
            : (typeof keys === 'string' ? [keys] : Object.keys(storage));
          for (const key of keyList) {
            if (key in storage) {
              result[key] = JSON.parse(JSON.stringify(storage[key]));
            }
          }
          if (cb) cb(result);
          return Promise.resolve(result);
        },
        set(items, cb) {
          const changes = {};
          for (const [key, val] of Object.entries(items)) {
            changes[key] = { oldValue: storage[key], newValue: val };
            storage[key] = JSON.parse(JSON.stringify(val));
          }
          for (const fn of changeListeners) {
            fn(changes, 'local');
          }
          if (cb) cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(fn) { changeListeners.add(fn); },
        removeListener(fn) { changeListeners.delete(fn); }
      }
    },
    tabs: {
      query(_queryInfo, cb) {
        cb(activeTab ? [{ ...activeTab }] : []);
      }
    },
    runtime: {
      lastError: null,
      connect() { return { onDisconnect: { addListener() {} } }; },
      sendMessage(_msg, cb) {
        if (cb) {
          cb({ ok: true });
          return;
        }
        return Promise.resolve({ imageUrl: 'https://example.com/cover.png' });
      },
      onMessage: { addListener() {} }
    }
  };
}

function createMockDom() {
  const registry = new Map();
  const docListeners = new Map();

  function createElement(tagName) {
    const listeners = new Map();
    const classes = new Set();
    const children = [];
    const childNodes = [];
    let _id = '';
    let _text = '';

    const el = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      style: {},
      dataset: {},
      value: '',
      checked: false,
      get id() { return _id; },
      set id(val) {
        _id = String(val);
        if (_id) registry.set(_id, el);
      },
      className: '',
      classList: {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: (name) => classes.has(name),
        toggle: (name) => (classes.has(name) ? (classes.delete(name), false) : (classes.add(name), true))
      },
      get innerText() { return _text; },
      set innerText(val) {
        _text = String(val);
        childNodes.length = 0;
        children.length = 0;
      },
      get textContent() { return _text; },
      set textContent(val) {
        _text = String(val);
        childNodes.length = 0;
        children.length = 0;
      },
      get innerHTML() { return ''; },
      set innerHTML(_val) {
        _text = '';
        childNodes.length = 0;
        children.length = 0;
      },
      children,
      childNodes,
      appendChild(child) {
        if (child) {
          childNodes.push(child);
          children.push(child);
        }
        return child;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      dispatchEvent(type, ev = {}) {
        const set = listeners.get(type);
        if (set) {
          for (const fn of set) {
            fn({ target: el, preventDefault() {}, stopPropagation() {}, ...ev });
          }
        }
      },
      click() { el.dispatchEvent('click'); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; }
    };
    return el;
  }

  const doc = {
    visibilityState: 'visible',
    createElement,
    createDocumentFragment() {
      return {
        nodeType: 11,
        childNodes: [],
        children: [],
        appendChild(c) {
          this.childNodes.push(c);
          return c;
        }
      };
    },
    getElementById(id) {
      if (!registry.has(id)) {
        const tag = id.includes('Button') ? 'button' : id.includes('Input') ? 'input' : 'div';
        const el = createElement(tag);
        el.id = id;
      }
      return registry.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    async triggerDOMContentLoaded() {
      const set = docListeners.get('DOMContentLoaded');
      if (set) {
        for (const fn of set) {
          await fn();
        }
      }
    }
  };

  const win = {
    addEventListener() {}
  };

  return { doc, win };
}

describe('Sidebar Add Collection Item automatic identifier extraction', () => {
  let originalDocument;
  let originalWindow;
  let originalChrome;

  beforeEach(() => {
    originalDocument = globalThis.document;
    originalWindow = globalThis.window;
    originalChrome = globalThis.chrome;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
  });

  it('automatically extracts identifier on sidebar startup when opening Add Item view and typing URL', async () => {
    globalThis.chrome = createChromeMock(
      {
        items: [],
        tags: [],
        identifierRules: [
          {
            id: 'rule-1',
            name: 'Item Code',
            urlPattern: '*example.com/item/*',
            extractionRegex: 'item/([A-Z0-9-]+)',
            captureGroup: 1,
            enabled: true
          }
        ]
      },
      {
        id: 1,
        title: 'Example Collection Item',
        url: 'https://example.com/item/ABC-123'
      }
    );

    const { doc, win } = createMockDom();
    globalThis.document = doc;
    globalThis.window = win;

    // Import sidebar.js after chrome/DOM mocks are installed so stores bind ChromeStorageAdapter
    await import('../sidebar/sidebar.js');
    await doc.triggerDOMContentLoaded();
    await new Promise(r => setTimeout(r, 20));

    const addItemButton = doc.getElementById('addItemButton');
    const itemUrlInput = doc.getElementById('itemUrlInput');
    const itemIdentifierInput = doc.getElementById('itemIdentifierInput');

    // 1. Opening Add Item view extracts identifier from active tab URL
    addItemButton.click();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(itemUrlInput.value, 'https://example.com/item/ABC-123');
    assert.strictEqual(itemIdentifierInput.value, 'ABC-123');

    // 2. Typing/updating URL in Add Item form extracts updated identifier
    itemUrlInput.value = 'https://example.com/item/XYZ-999';
    itemUrlInput.dispatchEvent('input');
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(itemIdentifierInput.value, 'XYZ-999');
  });

  it('lazy-loads identifierRuleStore inside addItemView if not yet loaded before add', async () => {
    const { MemoryStorageAdapter } = await import('../sidebar/store.js');
    const { identifierRuleStore } = await import('../identifierRuleStore.js');
    const { initAddItemView, showAddItemView } = await import('../sidebar/addItemView.js');
    const { tabAdapter } = await import('../tabAdapter.js');

    const { doc, win } = createMockDom();
    globalThis.document = doc;
    globalThis.window = win;

    identifierRuleStore.adapter = new MemoryStorageAdapter({
      identifierRules: [
        {
          id: 'rule-lazy',
          name: 'Lazy Rule',
          urlPattern: 'github.com',
          extractionRegex: 'issues/(\\d+)',
          captureGroup: 1,
          enabled: true
        }
      ]
    });
    identifierRuleStore.rules = [];
    identifierRuleStore.isLoaded = false;

    const originalGetActiveTab = tabAdapter.getActiveTab.bind(tabAdapter);
    tabAdapter.getActiveTab = async () => ({
      id: 2,
      title: 'GitHub Issue 42',
      url: 'https://github.com/owner/repo/issues/42'
    });

    try {
      initAddItemView({});
      showAddItemView(null);
      await new Promise(r => setTimeout(r, 20));

      const itemIdentifierInput = doc.getElementById('itemIdentifierInput');
      assert.strictEqual(itemIdentifierInput.value, '42');

      const itemUrlInput = doc.getElementById('itemUrlInput');
      itemUrlInput.value = 'https://github.com/owner/repo/issues/77';
      itemUrlInput.dispatchEvent('input');
      await new Promise(r => setTimeout(r, 20));

      assert.strictEqual(itemIdentifierInput.value, '77');
    } finally {
      tabAdapter.getActiveTab = originalGetActiveTab;
    }
  });
});
