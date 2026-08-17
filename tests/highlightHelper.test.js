import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightAndScrollToItem,
  clearActiveHighlight,
  getActiveHighlightElement,
  resetHighlightState
} from '../sidebar/highlightHelper.js';

// Lightweight Mock Element helper for DOM-independent Node test execution
function createMockElement(id = 'item-1', options = {}) {
  const classSet = new Set();
  let scrolledWith = null;

  const mockImg = options.hasImage ? {
    complete: options.imageComplete ?? false,
    _listeners: {},
    addEventListener(event, handler, opts) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push({ handler, once: opts?.once ?? false });
    },
    removeEventListener(event, handler) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(l => l.handler !== handler);
      }
    },
    trigger(event) {
      if (this._listeners[event]) {
        const listeners = [...this._listeners[event]];
        listeners.forEach(l => {
          l.handler();
          if (l.once) {
            this.removeEventListener(event, l.handler);
          }
        });
      }
    }
  } : null;

  const element = {
    id,
    classList: {
      add(cls) { classSet.add(cls); },
      remove(cls) { classSet.delete(cls); },
      contains(cls) { return classSet.has(cls); },
      get size() { return classSet.size; },
      toString() { return Array.from(classSet).join(' '); }
    },
    scrollIntoView(options) {
      scrolledWith = options;
    },
    querySelector(selector) {
      if (selector === 'img' || selector.includes('img')) {
        return mockImg;
      }
      return null;
    },
    getScrolledOptions() {
      return scrolledWith;
    },
    getMockImage() {
      return mockImg;
    }
  };

  return element;
}

describe('HighlightHelper (Deep Module & DOM Interaction)', () => {
  beforeEach(() => {
    resetHighlightState();
  });

  afterEach(() => {
    clearActiveHighlight();
    resetHighlightState();
  });

  describe('highlightAndScrollToItem - Happy Path & Basic Styling', () => {
    it('applies default highlighted class and scrolls into view with smooth center options', () => {
      const el = createMockElement('item-101');
      const handle = highlightAndScrollToItem(el);

      assert.ok(handle);
      assert.strictEqual(el.classList.contains('highlighted'), true);
      assert.deepStrictEqual(el.getScrolledOptions(), { behavior: 'smooth', block: 'center' });
      assert.strictEqual(getActiveHighlightElement(), el);
    });

    it('supports custom duration, class name, and scroll options', () => {
      const el = createMockElement('item-102');
      const handle = highlightAndScrollToItem(el, {
        highlightClass: 'custom-active',
        scrollBehavior: 'auto',
        scrollBlock: 'nearest',
        duration: 1500
      });

      assert.ok(handle);
      assert.strictEqual(el.classList.contains('custom-active'), true);
      assert.strictEqual(el.classList.contains('highlighted'), false);
      assert.deepStrictEqual(el.getScrolledOptions(), { behavior: 'auto', block: 'nearest' });
    });

    it('removes highlight class automatically after duration expires', async () => {
      const el = createMockElement('item-103');
      highlightAndScrollToItem(el, { duration: 50 });

      assert.strictEqual(el.classList.contains('highlighted'), true);

      await new Promise(resolve => setTimeout(resolve, 80));

      assert.strictEqual(el.classList.contains('highlighted'), false);
      assert.strictEqual(getActiveHighlightElement(), null);
    });
  });

  describe('Consecutive Calls & Timer Cancellation (Race Condition Prevention)', () => {
    it('clears previous highlight class and cancels previous timer when a new item is highlighted', async () => {
      const el1 = createMockElement('item-1');
      const el2 = createMockElement('item-2');

      // Highlight item 1 with short duration
      highlightAndScrollToItem(el1, { duration: 60 });
      assert.strictEqual(el1.classList.contains('highlighted'), true);
      assert.strictEqual(getActiveHighlightElement(), el1);

      // Rapidly highlight item 2 at 20ms
      await new Promise(resolve => setTimeout(resolve, 20));
      highlightAndScrollToItem(el2, { duration: 100 });

      // Item 1 should immediately lose highlight, Item 2 should have highlight
      assert.strictEqual(el1.classList.contains('highlighted'), false);
      assert.strictEqual(el2.classList.contains('highlighted'), true);
      assert.strictEqual(getActiveHighlightElement(), el2);

      // Wait until 70ms (when Item 1's original timer would have fired)
      await new Promise(resolve => setTimeout(resolve, 50));

      // Item 2 should STILL be highlighted because Item 1's timer was cancelled
      assert.strictEqual(el2.classList.contains('highlighted'), true);
      assert.strictEqual(getActiveHighlightElement(), el2);

      // Wait for Item 2's timer to expire (at 100ms total after item 2 was highlighted)
      await new Promise(resolve => setTimeout(resolve, 60));
      assert.strictEqual(el2.classList.contains('highlighted'), false);
      assert.strictEqual(getActiveHighlightElement(), null);
    });

    it('cancels highlight manually via handle.cancel()', () => {
      const el = createMockElement('item-cancel');
      const handle = highlightAndScrollToItem(el, { duration: 5000 });

      assert.strictEqual(el.classList.contains('highlighted'), true);

      handle.cancel();

      assert.strictEqual(el.classList.contains('highlighted'), false);
      assert.strictEqual(getActiveHighlightElement(), null);
    });
  });

  describe('Image Load Event & Layout Shift Realignment', () => {
    it('re-scrolls when incomplete image finishes loading', () => {
      const el = createMockElement('item-with-img', { hasImage: true, imageComplete: false });
      const img = el.getMockImage();

      highlightAndScrollToItem(el, { realignOnImageLoad: true, scrollBehavior: 'smooth', scrollBlock: 'center' });

      // Initial scroll occurred
      assert.deepStrictEqual(el.getScrolledOptions(), { behavior: 'smooth', block: 'center' });

      // Reset scroll tracking
      el.scrollIntoView({ behavior: 'reset' });

      // Trigger image load event (simulating slow network image finish)
      img.complete = true;
      img.trigger('load');

      // Scroll into view was called again upon image load to preserve alignment
      assert.deepStrictEqual(el.getScrolledOptions(), { behavior: 'smooth', block: 'center' });
    });

    it('does not attach listener if image is already complete', () => {
      const el = createMockElement('item-complete-img', { hasImage: true, imageComplete: true });
      const img = el.getMockImage();

      highlightAndScrollToItem(el, { realignOnImageLoad: true });

      // No listeners should be attached to already completed images
      assert.strictEqual(Object.keys(img._listeners).length, 0);
    });

    it('respects realignOnImageLoad: false option', () => {
      const el = createMockElement('item-no-realign', { hasImage: true, imageComplete: false });
      const img = el.getMockImage();

      highlightAndScrollToItem(el, { realignOnImageLoad: false });

      assert.strictEqual(Object.keys(img._listeners).length, 0);
    });
  });

  describe('Edge Cases & Defensive Validation', () => {
    it('handles null or undefined element gracefully without throwing', () => {
      assert.doesNotThrow(() => {
        const handle1 = highlightAndScrollToItem(null);
        assert.strictEqual(handle1, null);

        const handle2 = highlightAndScrollToItem(undefined);
        assert.strictEqual(handle2, null);
      });
    });

    it('handles element without classList or scrollIntoView gracefully', () => {
      const badElement = {};
      assert.doesNotThrow(() => {
        const handle = highlightAndScrollToItem(badElement);
        assert.strictEqual(handle, null);
      });
    });

    it('supports autoScroll: false to apply highlight without scrolling', () => {
      const el = createMockElement('item-no-scroll');
      highlightAndScrollToItem(el, { autoScroll: false });

      assert.strictEqual(el.classList.contains('highlighted'), true);
      assert.strictEqual(el.getScrolledOptions(), null);
    });
  });
});
