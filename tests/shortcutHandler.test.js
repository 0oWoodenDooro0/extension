import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatKeyboardEvent,
  isEditableElement,
  isStandardEditingCommand,
  ShortcutHandler,
  showShortcutToast
} from '../content/shortcutHandler.js';
import { MemoryStorageAdapter } from '../searchEngineStore.js';

describe('ShortcutHandler & In-Page Keyboard Shortcuts', () => {
  describe('formatKeyboardEvent', () => {
    it('returns empty string for null or non-object events or lone modifier keys', () => {
      assert.strictEqual(formatKeyboardEvent(null), '');
      assert.strictEqual(formatKeyboardEvent(undefined), '');
      assert.strictEqual(formatKeyboardEvent({ key: 'Control' }), '');
      assert.strictEqual(formatKeyboardEvent({ key: 'Alt' }), '');
      assert.strictEqual(formatKeyboardEvent({ key: 'Shift' }), '');
      assert.strictEqual(formatKeyboardEvent({ key: 'Meta' }), '');
    });

    it('formats single keys without modifiers', () => {
      assert.strictEqual(formatKeyboardEvent({ key: 's', code: 'KeyS' }), 'S');
      assert.strictEqual(formatKeyboardEvent({ key: '1', code: 'Digit1' }), '1');
      assert.strictEqual(formatKeyboardEvent({ key: 'F2', code: 'F2' }), 'F2');
    });

    it('formats key combinations with modifiers in canonical order (Ctrl+Alt+Shift+Meta)', () => {
      assert.strictEqual(
        formatKeyboardEvent({ altKey: true, key: 'm', code: 'KeyM' }),
        'Alt+M'
      );
      assert.strictEqual(
        formatKeyboardEvent({ ctrlKey: true, shiftKey: true, key: 'S', code: 'KeyS' }),
        'Ctrl+Shift+S'
      );
      assert.strictEqual(
        formatKeyboardEvent({ ctrlKey: true, altKey: true, shiftKey: true, key: 'k', code: 'KeyK' }),
        'Ctrl+Alt+Shift+K'
      );
      assert.strictEqual(
        formatKeyboardEvent({ altKey: true, key: '1', code: 'Digit1' }),
        'Alt+1'
      );
      assert.strictEqual(
        formatKeyboardEvent({ metaKey: true, key: 'p', code: 'KeyP' }),
        'Meta+P'
      );
    });
  });

  describe('isEditableElement & isStandardEditingCommand', () => {
    it('identifies INPUT, TEXTAREA, SELECT and contentEditable as editable elements', () => {
      assert.strictEqual(isEditableElement(null), false);
      assert.strictEqual(isEditableElement({ nodeType: 3 }), false);
      assert.strictEqual(isEditableElement({ nodeType: 1, tagName: 'DIV' }), false);
      assert.strictEqual(isEditableElement({ nodeType: 1, tagName: 'INPUT' }), true);
      assert.strictEqual(isEditableElement({ nodeType: 1, tagName: 'TEXTAREA' }), true);
      assert.strictEqual(isEditableElement({ nodeType: 1, tagName: 'SELECT' }), true);
      assert.strictEqual(isEditableElement({ nodeType: 1, tagName: 'DIV', isContentEditable: true }), true);
    });

    it('identifies standard clipboard and text editing commands', () => {
      assert.strictEqual(isStandardEditingCommand({ ctrlKey: true }, 'C'), true);
      assert.strictEqual(isStandardEditingCommand({ ctrlKey: true }, 'V'), true);
      assert.strictEqual(isStandardEditingCommand({ ctrlKey: true }, 'A'), true);
      assert.strictEqual(isStandardEditingCommand({ ctrlKey: true }, 'Z'), true);
      assert.strictEqual(isStandardEditingCommand({ metaKey: true }, 'X'), true);

      // Custom Alt shortcuts are not standard editing commands
      assert.strictEqual(isStandardEditingCommand({ altKey: true }, 'C'), false);
      assert.strictEqual(isStandardEditingCommand({ ctrlKey: true }, 'M'), false);
    });
  });

  describe('ShortcutHandler Workflow', () => {
    let mockEngines;
    let mockWindow;
    let executionLog;
    let toastLog;

    beforeEach(() => {
      mockEngines = [
        {
          id: 'engine-mis',
          title: 'Search on Mis',
          urlTemplate: 'https://missav.ai/search/{id}',
          shortcut: 'Alt+M'
        },
        {
          id: 'engine-siro',
          title: 'Search on Siro',
          urlTemplate: 'https://sirowiki.com/search/?keyword={query}',
          shortcut: 'Ctrl+Shift+S'
        },
        {
          id: 'engine-plain',
          title: 'Search on Plain',
          urlTemplate: 'https://plain.example.com?q={query}',
          shortcut: 'P'
        }
      ];

      executionLog = [];
      toastLog = [];

      mockWindow = {
        listeners: {},
        addEventListener(event, fn) {
          this.listeners[event] = fn;
        },
        removeEventListener(event, fn) {
          if (this.listeners[event] === fn) {
            delete this.listeners[event];
          }
        }
      };
    });

    it('executes search via onExecute when matching shortcut is pressed with selected text', () => {
      let prevented = false;
      let stopped = false;

      const handler = new ShortcutHandler({
        engines: mockEngines,
        targetWindow: mockWindow,
        getSelection: () => '  ABC-123  ',
        onExecute: (engine, query) => {
          executionLog.push({ engineId: engine.id, query });
        },
        onToast: (msg, opts) => {
          toastLog.push({ msg, opts });
        }
      });

      const event = {
        altKey: true,
        key: 'm',
        code: 'KeyM',
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; }
      };

      const result = handler.handleKeyDown(event);
      assert.strictEqual(result, true);
      assert.strictEqual(prevented, true);
      assert.strictEqual(stopped, true);
      assert.strictEqual(executionLog.length, 1);
      assert.strictEqual(executionLog[0].engineId, 'engine-mis');
      assert.strictEqual(executionLog[0].query, 'ABC-123');
      assert.strictEqual(toastLog.length, 0);
    });

    it('displays warning HUD toast without opening search when no text is selected', () => {
      let prevented = false;
      let stopped = false;

      const handler = new ShortcutHandler({
        engines: mockEngines,
        targetWindow: mockWindow,
        getSelection: () => '    ',
        onExecute: (engine, query) => {
          executionLog.push({ engineId: engine.id, query });
        },
        onToast: (msg, opts) => {
          toastLog.push({ msg, opts });
        }
      });

      const event = {
        ctrlKey: true,
        shiftKey: true,
        key: 'S',
        code: 'KeyS',
        preventDefault: () => { prevented = true; },
        stopPropagation: () => { stopped = true; }
      };

      const result = handler.handleKeyDown(event);
      assert.strictEqual(result, true);
      assert.strictEqual(prevented, true);
      assert.strictEqual(stopped, true);
      assert.strictEqual(executionLog.length, 0);
      assert.strictEqual(toastLog.length, 1);
      assert.match(toastLog[0].msg, /請先選取/);
      assert.strictEqual(toastLog[0].opts.isWarning, true);
    });

    it('protects editable inputs by ignoring plain shortcuts without modifiers while typing', () => {
      const handler = new ShortcutHandler({
        engines: mockEngines,
        targetWindow: mockWindow,
        getSelection: () => 'some text',
        onExecute: (engine, query) => executionLog.push({ engine, query })
      });

      const inputElement = { nodeType: 1, tagName: 'INPUT' };

      // Pressing 'P' inside input should NOT trigger engine-plain
      const plainKeyEvent = {
        key: 'p',
        code: 'KeyP',
        target: inputElement
      };
      const result = handler.handleKeyDown(plainKeyEvent);
      assert.strictEqual(result, false);
      assert.strictEqual(executionLog.length, 0);
    });

    it('protects standard text editing commands like Ctrl+C inside editable elements', () => {
      const engineWithCtrlC = [
        {
          id: 'engine-copy',
          title: 'Copy Search',
          urlTemplate: 'https://example.com?q={query}',
          shortcut: 'Ctrl+C'
        }
      ];

      const handler = new ShortcutHandler({
        engines: engineWithCtrlC,
        targetWindow: mockWindow,
        getSelection: () => 'text',
        onExecute: (engine, query) => executionLog.push({ engine, query })
      });

      const textareaElement = { nodeType: 1, tagName: 'TEXTAREA' };
      const ctrlCEvent = {
        ctrlKey: true,
        key: 'c',
        code: 'KeyC',
        target: textareaElement
      };

      const result = handler.handleKeyDown(ctrlCEvent);
      assert.strictEqual(result, false);
      assert.strictEqual(executionLog.length, 0);
    });

    it('allows explicit Alt shortcuts even when focused on an editable element', () => {
      const handler = new ShortcutHandler({
        engines: mockEngines,
        targetWindow: mockWindow,
        getSelection: () => 'query-inside-input',
        onExecute: (engine, query) => executionLog.push({ engineId: engine.id, query })
      });

      const inputElement = { nodeType: 1, tagName: 'INPUT' };
      const altMEvent = {
        altKey: true,
        key: 'm',
        code: 'KeyM',
        target: inputElement,
        preventDefault: () => {},
        stopPropagation: () => {}
      };

      const result = handler.handleKeyDown(altMEvent);
      assert.strictEqual(result, true);
      assert.strictEqual(executionLog.length, 1);
      assert.strictEqual(executionLog[0].engineId, 'engine-mis');
    });

    it('dynamically updates shortcut map when storageAdapter emits onChanged', async () => {
      const storageAdapter = new MemoryStorageAdapter({
        searchEngines: mockEngines
      });

      const handler = new ShortcutHandler({
        storageAdapter,
        targetWindow: mockWindow,
        getSelection: () => 'target query',
        onExecute: (engine, query) => executionLog.push({ engineId: engine.id, query })
      });

      await handler.init();

      // Trigger initial shortcut Alt+M
      handler.handleKeyDown({
        altKey: true,
        key: 'm',
        code: 'KeyM',
        preventDefault: () => {},
        stopPropagation: () => {}
      });
      assert.strictEqual(executionLog.length, 1);

      // Update storage with new shortcut Alt+N for the engine
      await storageAdapter.set({
        searchEngines: [
          {
            id: 'engine-mis',
            title: 'Search on Mis',
            urlTemplate: 'https://missav.ai/search/{id}',
            shortcut: 'Alt+N'
          }
        ]
      });

      // Alt+M should no longer match
      const oldMatch = handler.handleKeyDown({
        altKey: true,
        key: 'm',
        code: 'KeyM'
      });
      assert.strictEqual(oldMatch, false);

      // Alt+N should match now
      const newMatch = handler.handleKeyDown({
        altKey: true,
        key: 'n',
        code: 'KeyN',
        preventDefault: () => {},
        stopPropagation: () => {}
      });
      assert.strictEqual(newMatch, true);
      assert.strictEqual(executionLog.length, 2);

      handler.destroy();
    });
  });

  describe('showShortcutToast DOM Rendering', () => {
    it('creates toast DOM element with warning style in global document', () => {
      // Setup mock DOM
      const originalDoc = globalThis.document;
      const elements = [];
      const mockDoc = {
        body: {
          appendChild: (el) => elements.push(el)
        },
        getElementById: (id) => elements.find(el => el.id === id) || null,
        createElement: (tag) => {
          return {
            tagName: tag.toUpperCase(),
            id: '',
            textContent: '',
            style: {},
            remove() {
              const idx = elements.indexOf(this);
              if (idx !== -1) elements.splice(idx, 1);
            }
          };
        }
      };

      globalThis.document = mockDoc;
      try {
        showShortcutToast('⚠️ 請先選取欲搜尋的文字', { isWarning: true });
        assert.strictEqual(elements.length, 1);
        const toast = elements[0];
        assert.strictEqual(toast.id, '__collection_search_shortcut_toast__');
        assert.match(toast.textContent, /請先選取/);
        assert.match(toast.style.background, /217,\s*119,\s*6/);
      } finally {
        globalThis.document = originalDoc;
      }
    });
  });
});
