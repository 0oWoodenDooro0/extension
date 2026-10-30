// identifierRuleStore.js - URL 正規表達式識別碼提取引擎與規則存儲模組
// 支援可配置的 URL 匹配模式與捕獲組正規表達式提取規則，以及跨視窗同步與備份
import { MemoryStorageAdapter, ChromeStorageAdapter } from './sidebar/store.js';
export { MemoryStorageAdapter, ChromeStorageAdapter };

let ruleIdCounter = 0;
function generateRuleId() {
  ruleIdCounter = (ruleIdCounter + 1) % 100000;
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${ruleIdCounter}`;
}

/**
 * 安全比對 URL 與匹配模式 (支援 glob 通配符 * 或正規表達式)
 * @param {string} url
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchUrlPattern(url, pattern) {
  if (!pattern || typeof pattern !== 'string') return true;
  const trimmed = pattern.trim();
  if (!trimmed) return true;

  try {
    if (trimmed.includes('*')) {
      const escaped = trimmed
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`, 'i').test(url);
    }
    return new RegExp(trimmed, 'i').test(url);
  } catch {
    return url.includes(trimmed);
  }
}

/**
 * 純函數：根據規則陣列評估 URL 並提取識別碼字串 (無匹配則回傳 null)
 * @param {string} url
 * @param {Array<Object>} rules
 * @returns {string|null}
 */
export function extractIdentifierFromUrl(url, rules) {
  if (!url || typeof url !== 'string') return null;
  if (!Array.isArray(rules) || rules.length === 0) return null;

  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    if (rule.enabled === false) continue;
    if (!rule.extractionRegex || !rule.urlPattern) continue;

    if (!matchUrlPattern(url, rule.urlPattern)) {
      continue;
    }

    try {
      const regex = new RegExp(rule.extractionRegex);
      const match = url.match(regex);
      if (!match) continue;

      let extracted = null;
      if (rule.captureGroup !== undefined && match[rule.captureGroup] !== undefined) {
        extracted = match[rule.captureGroup];
      } else if (match[1] !== undefined) {
        extracted = match[1];
      } else if (match[0] !== undefined) {
        extracted = match[0];
      }

      if (extracted !== null && extracted !== undefined) {
        const trimmed = String(extracted).trim();
        if (trimmed) {
          try {
            return decodeURIComponent(trimmed);
          } catch {
            return trimmed;
          }
        }
      }
    } catch {
      // 捕獲正則表達式語法錯誤等異常，安全跳過並嘗試下一條規則
      continue;
    }
  }

  return null;
}

/**
 * IdentifierRuleStore 規則存儲深度模組
 */
export class IdentifierRuleStore {
  constructor(storageAdapter = null) {
    this.adapter =
      storageAdapter ||
      (typeof chrome !== 'undefined' && chrome.storage
        ? new ChromeStorageAdapter()
        : new MemoryStorageAdapter());
    this.rules = [];
    this.subscribers = new Set();
    this.isLoaded = false;
    this.isPersisting = false;

    // 監聽外部/跨視窗同步
    this.unsubscribeStorage = this.adapter.onChanged((changes) => {
      if (this.isPersisting) return;
      if (changes.identifierRules && changes.identifierRules.newValue) {
        this.rules = changes.identifierRules.newValue;
        this.notify({ type: 'sync', source: 'external' });
      }
    });
  }

  /**
   * 載入存儲資料
   */
  async load() {
    try {
      const data = await this.adapter.get('identifierRules');
      this.rules = Array.isArray(data.identifierRules) ? data.identifierRules : [];
      this.isLoaded = true;
      return { identifierRules: this.rules };
    } catch (err) {
      console.error('[IdentifierRuleStore] Failed to load rules:', err);
      this.rules = [];
      this.isLoaded = true;
      return { identifierRules: [] };
    }
  }

  /**
   * 持久化資料到適配器
   */
  async persist() {
    this.isPersisting = true;
    try {
      await this.adapter.set({
        identifierRules: this.rules
      });
    } finally {
      this.isPersisting = false;
    }
  }

  /**
   * 訂閱狀態變更通知
   */
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * 觸發訂閱者通知
   */
  notify(event) {
    this.subscribers.forEach(fn => {
      try {
        fn(event);
      } catch (err) {
        console.error('[IdentifierRuleStore] Error in subscriber callback:', err);
      }
    });
  }

  // --- 查詢介面 (Query Interface) ---

  getRules() {
    return [...this.rules];
  }

  getRuleById(id) {
    return this.rules.find(r => r.id === id) || null;
  }

  /**
   * 依目前存儲的規則提取識別碼
   */
  extractIdentifier(url) {
    return extractIdentifierFromUrl(url, this.rules);
  }

  // --- 項目異動介面 (Mutation Interface) ---

  /**
   * 新增或更新識別碼提取規則
   */
  async saveRule({ id, name, urlPattern, extractionRegex, captureGroup = 1, enabled = true }) {
    const cleanName = (name || '').trim();
    const cleanRegex = (extractionRegex || '').trim();
    const cleanPattern = (urlPattern || '').trim();

    if (!cleanRegex || !cleanPattern) {
      throw new Error('Rule extractionRegex and urlPattern are required.');
    }

    const now = Date.now();
    let targetRule = null;
    if (id) {
      targetRule = this.rules.find(r => r.id === id);
    }

    if (targetRule) {
      targetRule.name = cleanName || targetRule.name || 'Untitled Rule';
      targetRule.urlPattern = cleanPattern;
      targetRule.extractionRegex = cleanRegex;
      targetRule.captureGroup = typeof captureGroup === 'number' ? captureGroup : 1;
      targetRule.enabled = enabled !== false;
      targetRule.updatedAt = now;
    } else {
      targetRule = {
        id: id || generateRuleId(),
        name: cleanName || 'Untitled Rule',
        urlPattern: cleanPattern,
        extractionRegex: cleanRegex,
        captureGroup: typeof captureGroup === 'number' ? captureGroup : 1,
        enabled: enabled !== false,
        updatedAt: now
      };
      this.rules.push(targetRule);
    }

    await this.persist();
    this.notify({ type: 'ruleSaved', rule: targetRule });
    return targetRule;
  }

  /**
   * 刪除規則
   */
  async deleteRule(id) {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.rules.splice(index, 1);
    await this.persist();
    this.notify({ type: 'ruleDeleted', id });
    return true;
  }

  /**
   * 規則重新排序
   */
  async reorderRules(fromIndex, toIndex) {
    if (
      fromIndex < 0 ||
      fromIndex >= this.rules.length ||
      toIndex < 0 ||
      toIndex >= this.rules.length ||
      fromIndex === toIndex
    ) {
      return false;
    }

    const [movedRule] = this.rules.splice(fromIndex, 1);
    this.rules.splice(toIndex, 0, movedRule);
    await this.persist();
    this.notify({ type: 'rulesReordered' });
    return true;
  }

  // --- 資料匯出入 (Portability & Unified Backup) ---

  exportData() {
    return {
      identifierRules: JSON.parse(JSON.stringify(this.rules))
    };
  }

  async importData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.identifierRules)) {
      return false;
    }

    this.rules = data.identifierRules;
    await this.persist();
    this.notify({ type: 'imported' });
    return true;
  }
}

// 預設全域 Singleton 實例
export const identifierRuleStore = new IdentifierRuleStore();
