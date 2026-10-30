import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderItemElement } from '../sidebar/itemsView.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMockDocument() {
  function createElement(tagName) {
    const classes = new Set();
    const children = [];
    const childNodes = [];
    let _text = '';

    const el = {
      tagName: tagName.toUpperCase(),
      style: {},
      dataset: {},
      id: '',
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
        childNodes.push(child);
        if (child && child.nodeType === 1) {
          children.push(child);
        }
        return child;
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

  return {
    createElement,
    createTextNode
  };
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
        title: 'Multi Tag Article',
        url: 'https://example.com/article',
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
        title: 'Single Tag Article',
        url: 'https://example.com/article-2',
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
      const htmlPath = path.resolve(__dirname, '../sidebar/sidebar.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Check for .item-tags rule in sidebar.html
      const ruleMatch = htmlContent.match(/(?:^|[,\s}])([^{}]*\.item-tags[^{]*)\{([^}]+)\}/);
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
