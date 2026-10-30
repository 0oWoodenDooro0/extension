import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractIdentifierFromUrl,
  IdentifierRuleStore,
  MemoryStorageAdapter
} from '../identifierRuleStore.js';

describe('Identifier URL Regex Extraction Engine', () => {
  describe('extractIdentifierFromUrl', () => {
    it('returns null when url is empty, null, or not a string', () => {
      const rules = [{ extractionRegex: 'item/(\\d+)' }];
      assert.strictEqual(extractIdentifierFromUrl('', rules), null);
      assert.strictEqual(extractIdentifierFromUrl(null, rules), null);
      assert.strictEqual(extractIdentifierFromUrl(undefined, rules), null);
      assert.strictEqual(extractIdentifierFromUrl(12345, rules), null);
    });

    it('returns null when rules is null, empty, or not an array', () => {
      const url = 'https://example.com/items/42';
      assert.strictEqual(extractIdentifierFromUrl(url, null), null);
      assert.strictEqual(extractIdentifierFromUrl(url, []), null);
      assert.strictEqual(extractIdentifierFromUrl(url, undefined), null);
    });

    it('extracts identifier from URL path segments using first capture group', () => {
      const rules = [
        {
          id: 'rule-gh',
          name: 'GitHub Issues',
          extractionRegex: 'github\\.com/[^/]+/[^/]+/issues/(\\d+)'
        }
      ];
      const url = 'https://github.com/0oWoodenDooro0/extension/issues/20';
      const result = extractIdentifierFromUrl(url, rules);
      assert.strictEqual(result, '20');
    });

    it('extracts identifier from URL query parameters', () => {
      const rules = [
        {
          id: 'rule-yt',
          name: 'YouTube Video ID',
          extractionRegex: '[?&]v=([a-zA-Z0-9_-]+)'
        }
      ];
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=shared';
      const result = extractIdentifierFromUrl(url, rules);
      assert.strictEqual(result, 'dQw4w9WgXcQ');
    });

    it('supports specific captureGroup index isolation', () => {
      const rules = [
        {
          id: 'rule-multi-group',
          name: 'Multi Group Rule',
          extractionRegex: 'item/(sku|id)-([A-Z0-9]+)',
          captureGroup: 2
        }
      ];
      const url = 'https://shop.example.com/item/sku-PROD987';
      const result = extractIdentifierFromUrl(url, rules);
      assert.strictEqual(result, 'PROD987');
    });

    it('decodes URI-encoded characters in extracted identifier', () => {
      const rules = [
        {
          id: 'rule-encoded',
          name: 'Encoded Path Segment',
          extractionRegex: '/item/([^/?#]+)'
        }
      ];
      const url = 'https://example.com/item/%E6%B8%AC%E8%A9%A6-123';
      const result = extractIdentifierFromUrl(url, rules);
      assert.strictEqual(result, '測試-123');
    });

    it('filters by urlPattern before applying extractionRegex', () => {
      const rules = [
        {
          id: 'rule-jira',
          name: 'Jira Tickets',
          urlPattern: 'jira.atlassian.com',
          extractionRegex: 'browse/([A-Z]+-\\d+)'
        }
      ];
      // Wrong domain
      assert.strictEqual(
        extractIdentifierFromUrl('https://other.com/browse/PROJ-101', rules),
        null
      );
      // Matching domain
      assert.strictEqual(
        extractIdentifierFromUrl('https://jira.atlassian.com/browse/PROJ-101', rules),
        'PROJ-101'
      );
    });

    it('supports glob wildcard urlPattern (e.g. *domain.com/*)', () => {
      const rules = [
        {
          id: 'rule-glob',
          name: 'Glob Rule',
          urlPattern: '*://*.example.com/docs/*',
          extractionRegex: '/docs/([a-z0-9_-]+)'
        }
      ];
      assert.strictEqual(
        extractIdentifierFromUrl('https://api.example.com/docs/api-guide', rules),
        'api-guide'
      );
      assert.strictEqual(
        extractIdentifierFromUrl('https://api.example.com/blog/api-guide', rules),
        null
      );
    });

    it('skips disabled rules and respects priority order', () => {
      const rules = [
        {
          id: 'rule-1',
          name: 'Disabled Rule',
          enabled: false,
          extractionRegex: 'issues/(\\d+)'
        },
        {
          id: 'rule-2',
          name: 'High Priority Rule',
          enabled: true,
          extractionRegex: 'issues/(\\d+)'
        },
        {
          id: 'rule-3',
          name: 'Low Priority Rule',
          enabled: true,
          extractionRegex: '(\\d+)'
        }
      ];
      const url = 'https://github.com/owner/repo/issues/999';
      const result = extractIdentifierFromUrl(url, rules);
      assert.strictEqual(result, '999');
    });

    it('handles malformed regex safely without throwing and falls back to null', () => {
      const rules = [
        {
          id: 'rule-invalid',
          name: 'Malformed Regex',
          extractionRegex: '([a-z+' // Missing closing parenthesis
        },
        {
          id: 'rule-valid',
          name: 'Valid Fallback Rule',
          extractionRegex: 'item-(\\d+)'
        }
      ];
      const url = 'https://example.com/item-555';
      const result = extractIdentifierFromUrl(url, rules);
      assert.strictEqual(result, '555');
    });

    it('returns null when no rules match the URL', () => {
      const rules = [
        {
          id: 'rule-gh',
          extractionRegex: 'github\\.com/[^/]+/[^/]+/issues/(\\d+)'
        }
      ];
      const url = 'https://example.com/about';
      assert.strictEqual(extractIdentifierFromUrl(url, rules), null);
    });
  });

  describe('IdentifierRuleStore CRUD, Persistence & Synchronization', () => {
    let store;
    let memoryAdapter;

    beforeEach(async () => {
      memoryAdapter = new MemoryStorageAdapter();
      store = new IdentifierRuleStore(memoryAdapter);
      await store.load();
    });

    it('creates, updates, and deletes an IdentifierRule while persisting to storage', async () => {
      // 1. Create
      const rule = await store.saveRule({
        name: 'GitHub Issues',
        urlPattern: 'github.com',
        extractionRegex: 'issues/(\\d+)',
        captureGroup: 1
      });
      assert.ok(rule.id);
      assert.strictEqual(rule.name, 'GitHub Issues');
      assert.strictEqual(store.getRules().length, 1);

      // Verify persistence in adapter
      const stored = await memoryAdapter.get('identifierRules');
      assert.strictEqual(stored.identifierRules.length, 1);
      assert.strictEqual(stored.identifierRules[0].id, rule.id);

      // 2. Update
      await store.saveRule({
        id: rule.id,
        name: 'GitHub Issues & Pulls',
        extractionRegex: '(?:issues|pull)/(\\d+)'
      });
      assert.strictEqual(store.getRules().length, 1);
      assert.strictEqual(store.getRules()[0].name, 'GitHub Issues & Pulls');

      // 3. Delete
      const deleted = await store.deleteRule(rule.id);
      assert.strictEqual(deleted, true);
      assert.strictEqual(store.getRules().length, 0);
      const postDelete = await memoryAdapter.get('identifierRules');
      assert.strictEqual(postDelete.identifierRules.length, 0);
    });

    it('rejects saving a rule without extractionRegex or urlPattern', async () => {
      await assert.rejects(
        async () => {
          await store.saveRule({ name: 'Empty Rule' });
        },
        /required/i
      );
    });

    it('reorders rules and extracts identifier using prioritized rules', async () => {
      await store.saveRule({
        id: 'rule-broad',
        name: 'Broad Rule',
        extractionRegex: '(\\d+)'
      });
      await store.saveRule({
        id: 'rule-specific',
        name: 'Specific Rule',
        extractionRegex: 'ticket-([a-z0-9]+)'
      });

      // Initially rule-broad is first, extracts '123'
      assert.strictEqual(
        store.extractIdentifier('https://example.com/ticket-abc123'),
        '123'
      );

      // Reorder so specific rule is first
      await store.reorderRules(1, 0);
      assert.strictEqual(store.getRules()[0].id, 'rule-specific');

      // Now extracts 'abc123'
      assert.strictEqual(
        store.extractIdentifier('https://example.com/ticket-abc123'),
        'abc123'
      );
    });

    it('synchronizes in-memory rules on external storage change without self-echo', async () => {
      let syncNotified = 0;
      store.subscribe((event) => {
        if (event.type === 'sync' && event.source === 'external') {
          syncNotified++;
        }
      });

      // External storage change simulation
      await memoryAdapter.set({
        identifierRules: [
          {
            id: 'rule-ext',
            name: 'External Rule',
            extractionRegex: 'ext/(\\d+)'
          }
        ]
      });

      assert.strictEqual(syncNotified, 1);
      assert.strictEqual(store.getRules().length, 1);
      assert.strictEqual(store.getRules()[0].id, 'rule-ext');
    });
  });
});

