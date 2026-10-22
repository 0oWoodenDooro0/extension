import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseActorInput, renderActorChips } from '../sidebar/chipHelper.js';

describe('ChipHelper (Shared View Helper)', () => {
  describe('parseActorInput', () => {
    it('returns empty array for null, undefined, or empty string', () => {
      assert.deepStrictEqual(parseActorInput(null), []);
      assert.deepStrictEqual(parseActorInput(undefined), []);
      assert.deepStrictEqual(parseActorInput(''), []);
      assert.deepStrictEqual(parseActorInput('   '), []);
    });

    it('parses a single actor name trimming whitespace', () => {
      assert.deepStrictEqual(parseActorInput('  Keanu Reeves  '), ['Keanu Reeves']);
    });

    it('parses comma-separated actor names with trimming and deduplication', () => {
      assert.deepStrictEqual(
        parseActorInput('Keanu Reeves, Laurence Fishburne, Carrie-Anne Moss, Keanu Reeves'),
        ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss']
      );
    });

    it('filters out empty segments between commas', () => {
      assert.deepStrictEqual(
        parseActorInput('Tom Hanks, , , Matt Damon,  '),
        ['Tom Hanks', 'Matt Damon']
      );
    });
  });

  describe('renderActorChips', () => {
    function createMockContainer() {
      const children = [];
      return {
        children,
        style: {},
        innerHTML: '',
        appendChild(child) {
          children.push(child);
        }
      };
    }

    function createMockDocument() {
      return {
        createElement(tag) {
          const listeners = {};
          const el = {
            tagName: tag,
            className: '',
            innerText: '',
            title: '',
            type: '',
            children: [],
            appendChild(c) {
              this.children.push(c);
            },
            addEventListener(event, fn) {
              listeners[event] = fn;
            },
            trigger(event, e = {}) {
              if (listeners[event]) listeners[event](e);
            }
          };
          return el;
        }
      };
    }

    it('hides container when actor list is empty by default, and respects hideWhenEmpty: false', () => {
      const container = createMockContainer();
      renderActorChips(container, [], { onRemove: () => {} });
      assert.strictEqual(container.style.display, 'none');
      assert.strictEqual(container.innerHTML, '');

      const visibleContainer = createMockContainer();
      visibleContainer.style.display = 'flex';
      renderActorChips(visibleContainer, [], { hideWhenEmpty: false, onRemove: () => {} });
      assert.strictEqual(visibleContainer.style.display, 'flex');
      assert.strictEqual(visibleContainer.innerHTML, '');
    });

    it('renders chips with name and remove button, and handles removal', () => {
      global.document = createMockDocument();
      try {
        const container = createMockContainer();
        const removed = [];
        renderActorChips(container, ['Keanu Reeves', 'Carrie-Anne Moss'], {
          onRemove: (actor) => removed.push(actor)
        });

        assert.strictEqual(container.style.display, 'flex');
        assert.strictEqual(container.children.length, 2);

        const firstChip = container.children[0];
        assert.strictEqual(firstChip.className, 'actor-chip');
        assert.strictEqual(firstChip.children[0].innerText, 'Keanu Reeves');

        // Test remove button click
        const removeBtn = firstChip.children[1];
        removeBtn.trigger('click', { stopPropagation: () => {} });

        assert.deepStrictEqual(removed, ['Keanu Reeves']);
      } finally {
        delete global.document;
      }
    });
  });
});
