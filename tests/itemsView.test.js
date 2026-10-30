import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderItemElement,
  toggleFilter,
  getActiveFilters,
  resetFilters
} from '../sidebar/itemsView.js';
import { tabAdapter } from '../tabAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sidebarHtml = fs.readFileSync(path.resolve(__dirname, '../sidebar/sidebar.html'), 'utf8');

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
        contains: (name) => classes.has(name)
      },
      get innerText() {
        return _text || childNodes.map(n => n.textContent || n.innerText || '').join('');
      },
      set innerText(val) {
        _text = String(val);
      },
      get textContent() {
        return _text || childNodes.map(n => n.textContent || n.innerText || '').join('');
      },
      set textContent(val) {
        _text = String(val);
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
        if (!event.propagationStopped) {
          if (_parentElement && typeof _parentElement.dispatchEvent === 'function') {
            _parentElement.dispatchEvent(event);
          } else if (doc && typeof doc.dispatchEvent === 'function') {
            doc.dispatchEvent(event);
          }
        }
        return !event.defaultPrevented;
      },
      click() {
        let propagationStopped = false;
        let defaultPrevented = false;
        const event = {
          type: 'click',
          target: el,
          currentTarget: el,
          get propagationStopped() {
            return propagationStopped;
          },
          get defaultPrevented() {
            return defaultPrevented;
          },
          stopPropagation() {
            propagationStopped = true;
          },
          preventDefault() {
            defaultPrevented = true;
          }
        };
        this.dispatchEvent(event);
        return event;
      },
      closest(selector) {
        let current = el;
        while (current) {
          if (current.nodeType === 1 && matches(current, selector)) {
            return current;
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
            if (matches(child, selector)) {
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

  function matches(node, selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return node.classList.contains(cls);
    }
    if (selector.startsWith('#')) {
      return node.id === selector.slice(1);
    }
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }

  const doc = {
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
      event.currentTarget = doc;
      const handlers = [...(docListeners.get(event.type) || [])];
      for (const handler of handlers) {
        handler.call(doc, event);
      }
      return !event.defaultPrevented;
    }
  };

  return doc;
}

describe('Collection Item Card Tag Rendering (Ticket #14)', () => {
  let originalDocument;

  beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = createMockDocument();
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  describe('Tag Formatting & Subsetting', () => {
    it('renders up to the first 3 assigned tags with # prefix', () => {
      const item = {
        id: 'item-1',
        title: 'Multi Tag Item',
        url: 'https://example.com/item',
        tags: ['Frontend', 'JavaScript', 'CSS', 'Design', 'Web']
      };

      const card = renderItemElement(item);
      assert.ok(card, 'Card element should be created');

      const tagsContainer = card.querySelector('.item-tags');
      assert.ok(tagsContainer, 'Tag container with class .item-tags should exist');
      assert.strictEqual(tagsContainer.classList.contains('item-tags'), true);

      const tagSpans = tagsContainer.querySelectorAll('.item-tag');
      assert.strictEqual(tagSpans.length, 3, 'Should render at most 3 tags');
      assert.strictEqual(tagSpans[0].innerText, '#Frontend');
      assert.strictEqual(tagSpans[1].innerText, '#JavaScript');
      assert.strictEqual(tagSpans[2].innerText, '#CSS');
      assert.strictEqual(tagsContainer.textContent, '#Frontend #JavaScript #CSS');
    });

    it('renders single tag with # prefix when item has only 1 tag', () => {
      const item = {
        id: 'item-2',
        title: 'Single Tag Item',
        url: 'https://example.com/item-2',
        tags: ['SoloTag']
      };

      const card = renderItemElement(item);
      const tagsContainer = card.querySelector('.item-tags');
      assert.ok(tagsContainer, 'Tag container should exist');

      const tagSpans = tagsContainer.querySelectorAll('.item-tag');
      assert.strictEqual(tagSpans.length, 1);
      assert.strictEqual(tagSpans[0].innerText, '#SoloTag');
      assert.strictEqual(tagsContainer.textContent, '#SoloTag');
    });

    it('preserves existing # prefix if tag already begins with #', () => {
      const item = {
        id: 'item-hash',
        title: 'Pre-hashed Tag',
        url: 'https://example.com/hash',
        tags: ['#AlreadyHashed']
      };

      const card = renderItemElement(item);
      const tagsContainer = card.querySelector('.item-tags');
      const tagSpans = tagsContainer.querySelectorAll('.item-tag');
      assert.strictEqual(tagSpans[0].innerText, '#AlreadyHashed');
    });
  });

  describe('Untagged Items (No Container or Placeholder)', () => {
    it('does not render any tag container when item.tags is empty array', () => {
      const item = {
        id: 'item-untagged-empty',
        title: 'Untagged Item',
        url: 'https://example.com/untagged',
        tags: []
      };

      const card = renderItemElement(item);
      const tagsContainer = card.querySelector('.item-tags');
      assert.strictEqual(tagsContainer, null, 'No .item-tags container should be rendered');
      assert.strictEqual(card.querySelectorAll('.item-tag').length, 0);
    });

    it('does not render any tag container when item.tags is undefined or null', () => {
      const itemUndefined = {
        id: 'item-undefined-tags',
        title: 'Item without tags property',
        url: 'https://example.com/notags'
      };
      const cardUndefined = renderItemElement(itemUndefined);
      assert.strictEqual(cardUndefined.querySelector('.item-tags'), null);

      const itemNull = {
        id: 'item-null-tags',
        title: 'Item with null tags',
        url: 'https://example.com/nulltags',
        tags: null
      };
      const cardNull = renderItemElement(itemNull);
      assert.strictEqual(cardNull.querySelector('.item-tags'), null);
    });
  });

  describe('Card DOM Hierarchy', () => {
    it('places Tag line below Actor element when item has Actors', () => {
      const item = {
        id: 'item-hierarchy-with-actors',
        title: 'Hierarchy Test With Actors',
        url: 'https://example.com/hier-actors',
        actors: ['Alice', 'Bob'],
        tags: ['Alpha', 'Beta']
      };

      const card = renderItemElement(item);
      const textContainer = card.children.find(child => child.tagName === 'DIV');
      assert.ok(textContainer, 'Text container div should exist');

      const childClasses = textContainer.children.map(child => child.className);
      assert.deepStrictEqual(childClasses, ['item-title', 'item-actor', 'item-tags']);
    });

    it('places Tag line directly below Title when item has no Actors', () => {
      const item = {
        id: 'item-hierarchy-no-actors',
        title: 'Hierarchy Test Without Actors',
        url: 'https://example.com/hier-no-actors',
        actors: [],
        tags: ['Alpha', 'Beta']
      };

      const card = renderItemElement(item);
      const textContainer = card.children.find(child => child.tagName === 'DIV');
      assert.ok(textContainer, 'Text container div should exist');

      const childClasses = textContainer.children.map(child => child.className);
      assert.deepStrictEqual(childClasses, ['item-title', 'item-tags']);
    });
  });

  describe('Single-Line Ellipsis CSS Styles (sidebar/sidebar.html)', () => {
    it('defines .item-tags styles with single-line ellipsis, small font size, and muted color in sidebar.html', () => {
      const ruleMatch = sidebarHtml.match(/(?:^|[,\s}])([^{}]*\.item-tags[^{]*)\{([^}]+)\}/);
      assert.ok(ruleMatch, 'CSS rule for .item-tags should exist in sidebar.html');

      const ruleBody = ruleMatch[2];
      assert.match(ruleBody, /white-space\s*:\s*nowrap/i, 'Must have white-space: nowrap');
      assert.match(ruleBody, /overflow\s*:\s*hidden/i, 'Must have overflow: hidden');
      assert.match(ruleBody, /text-overflow\s*:\s*ellipsis/i, 'Must have text-overflow: ellipsis');
      assert.match(ruleBody, /font-size\s*:\s*0\.85em/i, 'Must have font-size: 0.85em');
      assert.match(ruleBody, /color\s*:\s*(#666|#777)/i, 'Must have gray color (#666 or #777)');
    });
  });
});

describe('Collection Item Card Tag Click-to-Filter & Event Isolation (Ticket #15)', () => {
  let originalDocument;

  beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = createMockDocument();
    resetFilters();
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    resetFilters();
  });

  describe('Tag Click Callback & Filtering', () => {
    it('invokes custom onTagClick callback with clean tag name and event when an .item-tag is clicked', () => {
      const item = {
        id: 'item-click-1',
        title: 'Clickable Tag Item',
        url: 'https://example.com/click-1',
        tags: ['Frontend']
      };

      const calls = [];
      const onTagClick = (tag, event) => {
        calls.push({ tag, event });
      };

      const card = renderItemElement(item, globalThis.document, { onTagClick });
      const tagSpan = card.querySelector('.item-tag');
      assert.ok(tagSpan, 'Tag span should exist');

      const clickEvent = tagSpan.click();
      assert.strictEqual(calls.length, 1, 'onTagClick should be called once');
      assert.strictEqual(calls[0].tag, 'Frontend');
      assert.strictEqual(calls[0].event, clickEvent);
    });

    it('invokes onTagClick for each specific tag among multiple rendered tags', () => {
      const item = {
        id: 'item-multi-click',
        title: 'Multi Tag Click Item',
        url: 'https://example.com/multi',
        tags: ['Frontend', 'JavaScript', 'CSS']
      };

      const calls = [];
      const card = renderItemElement(item, globalThis.document, {
        onTagClick: (tag) => calls.push(tag)
      });

      const tagSpans = card.querySelectorAll('.item-tag');
      assert.strictEqual(tagSpans.length, 3);

      tagSpans[0].click();
      assert.deepStrictEqual(calls, ['Frontend']);

      tagSpans[1].click();
      assert.deepStrictEqual(calls, ['Frontend', 'JavaScript']);

      tagSpans[2].click();
      assert.deepStrictEqual(calls, ['Frontend', 'JavaScript', 'CSS']);
    });

    it('preserves exact tag identity when tag already begins with #', () => {
      const item = {
        id: 'item-hash-click',
        title: 'Pre-hashed Click Item',
        url: 'https://example.com/hash-click',
        tags: ['#PreHashed']
      };

      let clickedTag = null;
      const card = renderItemElement(item, globalThis.document, {
        onTagClick: (tag) => {
          clickedTag = tag;
        }
      });

      const tagSpan = card.querySelector('.item-tag');
      tagSpan.click();
      assert.strictEqual(clickedTag, '#PreHashed');
    });

    it('invokes default toggleFilter and updates active tag filters when no onTagClick option is provided', () => {
      const item = {
        id: 'item-toggle-default',
        title: 'Default Toggle Item',
        url: 'https://example.com/toggle-default',
        tags: ['WebDev']
      };

      const card = renderItemElement(item, globalThis.document);
      const tagSpan = card.querySelector('.item-tag');

      assert.deepStrictEqual(getActiveFilters(), []);
      tagSpan.click();
      assert.deepStrictEqual(getActiveFilters(), ['WebDev']);

      // Clicking again toggles off
      tagSpan.click();
      assert.deepStrictEqual(getActiveFilters(), []);
    });
  });

  describe('Event Isolation & Propagation Control', () => {
    it('calls stopPropagation() on the click event when clicking an .item-tag', () => {
      const item = {
        id: 'item-stop-prop',
        title: 'Stop Propagation Item',
        url: 'https://example.com/stop-prop',
        tags: ['Isolation']
      };

      const card = renderItemElement(item, globalThis.document);
      const tagSpan = card.querySelector('.item-tag');

      const clickEvent = tagSpan.click();
      assert.strictEqual(clickEvent.propagationStopped, true, 'propagationStopped must be true');
    });

    it('does NOT trigger parent card click listener when clicking an .item-tag', () => {
      const item = {
        id: 'item-card-isolation',
        title: 'Card Isolation Test',
        url: 'https://example.com/card-isolation',
        tags: ['IsolatedTag']
      };

      let cardListenerInvoked = false;
      let tagClickInvoked = false;

      const card = renderItemElement(item, globalThis.document, {
        onTagClick: () => {
          tagClickInvoked = true;
        }
      });

      card.addEventListener('click', () => {
        cardListenerInvoked = true;
      });

      const tagSpan = card.querySelector('.item-tag');
      tagSpan.click();

      assert.strictEqual(tagClickInvoked, true, 'Tag click callback should be invoked');
      assert.strictEqual(cardListenerInvoked, false, 'Card direct click listener MUST NOT be invoked');
    });

    it('allows click event to bubble to card when clicking non-tag elements (title, actor, image, card root)', () => {
      const item = {
        id: 'item-non-tag',
        title: 'Non Tag Elements Test',
        url: 'https://example.com/non-tag',
        actors: ['Alice', 'Bob'],
        imageUrl: 'https://example.com/cover.png',
        tags: ['SampleTag']
      };

      const clickedUrls = [];
      const card = renderItemElement(item, globalThis.document);
      card.addEventListener('click', (e) => {
        const li = e.target.closest('.listItem');
        if (li && li.dataset.url) {
          clickedUrls.push(li.dataset.url);
        }
      });

      const titleSpan = card.querySelector('.item-title');
      const actorSpan = card.querySelector('.item-actor');
      const imageEl = card.querySelector('.item-image');
      const tagsContainer = card.querySelector('.item-tags');

      // 1. Click title
      titleSpan.click();
      assert.strictEqual(clickedUrls.length, 1);
      assert.strictEqual(clickedUrls[0], item.url);

      // 2. Click actor
      actorSpan.click();
      assert.strictEqual(clickedUrls.length, 2);
      assert.strictEqual(clickedUrls[1], item.url);

      // 3. Click image
      imageEl.click();
      assert.strictEqual(clickedUrls.length, 3);
      assert.strictEqual(clickedUrls[2], item.url);

      // 4. Click tags container outside tag span (whitespace)
      tagsContainer.click();
      assert.strictEqual(clickedUrls.length, 4);
      assert.strictEqual(clickedUrls[3], item.url);

      // 5. Click card root directly
      card.click();
      assert.strictEqual(clickedUrls.length, 5);
      assert.strictEqual(clickedUrls[4], item.url);
    });

    it('prevents tabAdapter.openAdjacent in list container delegation when clicking .item-tag', async () => {
      const doc = globalThis.document;
      const itemList = doc.createElement('ul');
      itemList.id = 'itemList';

      const openedTabs = [];
      const originalOpenAdjacent = tabAdapter.openAdjacent;
      tabAdapter.openAdjacent = async (url) => {
        openedTabs.push(url);
      };

      try {
        // List event delegation matching sidebar itemsView behavior
        itemList.addEventListener('click', async (e) => {
          if (e.target && typeof e.target.closest === 'function' && e.target.closest('.item-tag')) {
            return;
          }
          const li = e.target.closest('.listItem');
          if (li && li.dataset.url) {
            tabAdapter.openAdjacent(li.dataset.url);
          }
        });

        const item = {
          id: 'item-delegation',
          title: 'Delegation Test Item',
          url: 'https://example.com/delegation-item',
          tags: ['DelegatedTag']
        };

        const card = renderItemElement(item, doc);
        itemList.appendChild(card);

        const tagSpan = card.querySelector('.item-tag');
        const titleSpan = card.querySelector('.item-title');

        // Clicking tag must NOT open tab
        tagSpan.click();
        assert.strictEqual(openedTabs.length, 0, 'Tag click must not trigger tabAdapter.openAdjacent');

        // Clicking title MUST open tab
        titleSpan.click();
        assert.strictEqual(openedTabs.length, 1, 'Title click must trigger tabAdapter.openAdjacent');
        assert.strictEqual(openedTabs[0], item.url);
      } finally {
        tabAdapter.openAdjacent = originalOpenAdjacent;
      }
    });
  });

  describe('Interactive Tag CSS Styles (sidebar/sidebar.html)', () => {
    it('defines cursor: pointer for .item-tag in sidebar.html', () => {
      const tagRuleMatch = sidebarHtml.match(/(?:^|[,\s}])([^{}]*\.item-tag\b[^{]*)\{([^}]+)\}/);
      assert.ok(tagRuleMatch, 'CSS rule for .item-tag should exist in sidebar.html');
      assert.match(tagRuleMatch[2], /cursor\s*:\s*pointer/i, 'Must have cursor: pointer');
    });

    it('defines hover styling for .item-tag:hover in sidebar.html', () => {
      const hoverRuleMatch = sidebarHtml.match(/(?:^|[,\s}])([^{}]*\.item-tag:hover[^{]*)\{([^}]+)\}/);
      assert.ok(hoverRuleMatch, 'CSS rule for .item-tag:hover should exist in sidebar.html');
      assert.match(hoverRuleMatch[2], /text-decoration\s*:\s*underline/i, 'Must have text-decoration: underline');
    });
  });
});
