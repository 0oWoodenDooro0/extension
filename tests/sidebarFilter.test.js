import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { collectionStore, MemoryStorageAdapter, UNTAGGED_TAG } from '../sidebar/store.js';
import {
  initItemsView,
  displayItemsByTag,
  refreshItemsView,
  getActiveFilters,
  toggleFilter
} from '../sidebar/itemsView.js';
import { initAddItemView, showAddItemView } from '../sidebar/addItemView.js';

function createMockDocument() {
  const elementRegistry = new Map();
  const docListeners = new Map();

  function createElement(tagName) {
    const classes = new Set();
    const children = [];
    const childNodes = [];
    const listeners = new Map();
    let _text = '';
    let _parentElement = null;
    let _id = '';

    const el = {
      tagName: tagName.toUpperCase(),
      style: {},
      dataset: {},
      value: '',
      get id() {
        return _id;
      },
      set id(val) {
        _id = String(val);
        if (_id) {
          elementRegistry.set(_id, el);
        }
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
        contains: (name) => classes.has(name),
        toggle: (name) => {
          if (classes.has(name)) {
            classes.delete(name);
            return false;
          } else {
            classes.add(name);
            return true;
          }
        }
      },
      get innerText() {
        return _text || childNodes.map(n => n.textContent || n.innerText || '').join('');
      },
      set innerText(val) {
        _text = String(val);
        childNodes.length = 0;
        children.length = 0;
      },
      get textContent() {
        return _text || childNodes.map(n => n.textContent || n.innerText || '').join('');
      },
      set textContent(val) {
        _text = String(val);
        childNodes.length = 0;
        children.length = 0;
      },
      get innerHTML() {
        return childNodes.map(n => n.textContent || '').join('');
      },
      set innerHTML(val) {
        _text = '';
        childNodes.length = 0;
        children.length = 0;
      },
      get children() {
        return children;
      },
      get childNodes() {
        return childNodes;
      },
      appendChild(child) {
        if (!child) return child;
        if (child.nodeType === 11) { // DocumentFragment
          const fragChildren = [...child.childNodes];
          for (const fc of fragChildren) {
            el.appendChild(fc);
          }
          child.childNodes.length = 0;
          child.children.length = 0;
          return child;
        }
        child.parentElement = el;
        child.parentNode = el;
        childNodes.push(child);
        if (child.nodeType === 1) {
          children.push(child);
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
        return !event.defaultPrevented;
      },
      click() {
        let _propagationStopped = false;
        let _defaultPrevented = false;
        const event = {
          type: 'click',
          target: el,
          currentTarget: el,
          stopPropagation() { _propagationStopped = true; },
          preventDefault() { _defaultPrevented = true; }
        };
        this.dispatchEvent(event);
        return event;
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const results = [];
        function walk(node) {
          for (const child of node.children) {
            if (matches(child, selector)) results.push(child);
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

  function matches(node, selector) {
    if (selector.startsWith('.')) {
      const classes = selector.split('.').filter(Boolean);
      return classes.every(cls => node.classList.contains(cls));
    }
    if (selector.startsWith('#')) {
      return node.id === selector.slice(1);
    }
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }

  function createTextNode(text) {
    return {
      nodeType: 3,
      nodeValue: String(text),
      textContent: String(text)
    };
  }

  function createDocumentFragment() {
    const children = [];
    const childNodes = [];
    return {
      nodeType: 11,
      children,
      childNodes,
      appendChild(child) {
        if (!child) return child;
        childNodes.push(child);
        if (child.nodeType === 1) {
          children.push(child);
        }
        return child;
      }
    };
  }

  function getElementById(id) {
    return elementRegistry.get(id) || null;
  }

  return {
    createElement,
    createTextNode,
    createDocumentFragment,
    getElementById,
    addEventListener(type, handler) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (docListeners.has(type)) {
        docListeners.set(type, docListeners.get(type).filter(h => h !== handler));
      }
    },
    dispatchEvent(event) {
      const handlers = [...(docListeners.get(event.type) || [])];
      for (const handler of handlers) {
        handler.call(docListeners, event);
      }
    }
  };
}

describe('Sidebar Filter Persistence on Item Detail Navigation', () => {
  let originalDocument;
  let mockDoc;
  let elements;
  let currentViewName;

  function showView(viewToShow) {
    [elements.itemsView, elements.addItemView, elements.manageTagsView].forEach(view => {
      if (view) {
        view.style.display = view === viewToShow ? 'flex' : 'none';
      }
    });
    if (viewToShow === elements.itemsView) currentViewName = 'items';
    else if (viewToShow === elements.addItemView) currentViewName = 'add';
    else if (viewToShow === elements.manageTagsView) currentViewName = 'manage';
  }

  function displayMainLibrary() {
    showView(elements.itemsView);
    displayItemsByTag('All Items');
  }

  function handleAddEditFinished() {
    showView(elements.itemsView);
    refreshItemsView();
  }

  beforeEach(async () => {
    originalDocument = globalThis.document;
    mockDoc = createMockDocument();
    globalThis.document = mockDoc;

    const elementIds = [
      'itemsView', 'addItemView', 'manageTagsView',
      'itemList', 'itemSearchInput', 'clearSearchButton', 'tagFilterContainer',
      'actorFilterInput', 'actorFilterDatalist', 'addActorFilterButton', 'selectedActorFiltersContainer',
      'itemTitleInput', 'itemUrlInput', 'itemIdentifierInput', 'identifierWarning',
      'itemImageUrlInput', 'fetchImageButton', 'imagePreviewContainer', 'imagePreview', 'imagePreviewStatus',
      'itemActorInput', 'addActorButton', 'selectedActorsContainer', 'actorSuggestions',
      'existingTagsContainer', 'saveItemButton', 'cancelButton', 'deleteItemButton'
    ];

    elements = {};
    for (const id of elementIds) {
      const tag = id.includes('Button') ? 'button' : id.includes('Input') ? 'input' : id.includes('List') ? 'ul' : 'div';
      const el = mockDoc.createElement(tag);
      el.id = id;
      elements[id] = el;
    }

    const adapter = new MemoryStorageAdapter({
      items: [
        { id: 'item-1', title: 'React Guide', url: 'https://react.dev', tags: ['Frontend'], actors: ['Dan'] },
        { id: 'item-2', title: 'Node Guide', url: 'https://nodejs.org', tags: ['Backend'], actors: ['Ryan'] },
        { id: 'item-3', title: 'Untagged Item', url: 'https://example.com', tags: [], actors: [] }
      ],
      tags: ['Frontend', 'Backend']
    });
    collectionStore.adapter = adapter;
    collectionStore.items = [];
    collectionStore.tags = [];
    await collectionStore.load();

    initItemsView({
      onEditItem: (itemId) => {
        showView(elements.addItemView);
        showAddItemView(itemId);
      }
    });

    initAddItemView({
      onSave: () => handleAddEditFinished(),
      onCancel: () => handleAddEditFinished(),
      onDelete: () => handleAddEditFinished()
    });
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it('preserves active tag filter when entering item detail and clicking Cancel', async () => {
    displayMainLibrary();

    // User selects 'Frontend' tag filter
    toggleFilter('Frontend');
    assert.deepStrictEqual(getActiveFilters(), ['Frontend'], 'Frontend filter should be active');

    // User enters item detail page
    showView(elements.addItemView);
    showAddItemView('item-1');
    assert.strictEqual(currentViewName, 'add');

    // User cancels editing
    elements.cancelButton.click();
    assert.strictEqual(currentViewName, 'items');

    // Filter must be preserved
    assert.deepStrictEqual(getActiveFilters(), ['Frontend'], 'Active tag filter should remain Frontend');

    // Tag button in tagFilterContainer must still have .selected class
    const selectedBtn = elements.tagFilterContainer.querySelector('.tag-button.selected');
    assert.ok(selectedBtn, 'Selected tag button should exist');
    assert.strictEqual(selectedBtn.innerText, 'Frontend');
  });

  it('preserves Untagged filter when entering item detail and clicking Cancel', async () => {
    displayMainLibrary();

    // User selects 'Untagged' scope
    toggleFilter(UNTAGGED_TAG);
    assert.deepStrictEqual(getActiveFilters(), [UNTAGGED_TAG]);

    // User enters item detail page
    showView(elements.addItemView);
    showAddItemView('item-3');

    // User cancels editing
    elements.cancelButton.click();

    // Untagged filter must be preserved
    assert.deepStrictEqual(getActiveFilters(), [UNTAGGED_TAG]);
    const selectedBtn = elements.tagFilterContainer.querySelector('.tag-button.selected');
    assert.ok(selectedBtn);
    assert.strictEqual(selectedBtn.innerText, 'Untagged');
  });

  it('preserves active tag filter when entering item detail, saving edits, and returning', async () => {
    displayMainLibrary();

    // User selects 'Frontend' filter
    toggleFilter('Frontend');
    assert.deepStrictEqual(getActiveFilters(), ['Frontend']);

    // User enters item detail page to edit item-1
    showView(elements.addItemView);
    showAddItemView('item-1');

    // User changes title
    elements.itemTitleInput.value = 'Updated React Guide';
    elements.saveItemButton.click();
    await new Promise(r => setTimeout(r, 10));

    // After save, return to items view
    assert.strictEqual(currentViewName, 'items');
    assert.deepStrictEqual(getActiveFilters(), ['Frontend']);

    // Items list is updated with new title and still filtered
    assert.strictEqual(elements.itemList.children.length, 1);
    assert.match(elements.itemList.children[0].innerText, /Updated React Guide/);
  });
});
