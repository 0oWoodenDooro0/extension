import { searchEngineStore, SearchEngineStore, MemoryStorageAdapter, ChromeStorageAdapter } from './searchEngineStore.js';
import { tabAdapter } from './tabAdapter.js';

export { searchEngineStore, SearchEngineStore, MemoryStorageAdapter, ChromeStorageAdapter };

/**
 * Create dynamic context menu items based on active search engine configuration.
 */
export function rebuildContextMenus(store = searchEngineStore) {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;

  chrome.contextMenus.removeAll(() => {
    store.getEngines().forEach((engine) => {
      chrome.contextMenus.create({
        id: engine.id,
        title: engine.title,
        contexts: ["selection"]
      });
    });
  });
}

/**
 * Open a search engine URL based on selected text.
 */
export function performSearch(query, engineOrId, currentTab, store = searchEngineStore, navigationAdapter = tabAdapter) {
  const searchUrl = store.buildSearchUrl(query, engineOrId);
  if (!searchUrl) return;

  navigationAdapter.openAdjacent(searchUrl, { tab: currentTab, active: true });
}

/**
 * Entrypoint: Initializes search engine store, registers context menus, and sets up event listeners.
 */
export async function initializeSearchShortcuts(store = searchEngineStore) {
  const setupContextMenus = async () => {
    await store.load();
    rebuildContextMenus(store);
  };

  // Register listeners SYNCHRONOUSLY before any await, to ensure Manifest V3 service worker registers them on the first tick
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onStartup.addListener(setupContextMenus);
    chrome.runtime.onInstalled.addListener(setupContextMenus);
  }

  // Listen to context menu clicks
  if (typeof chrome !== 'undefined' && chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      if (!store.isLoaded) {
        await store.load();
      }
      const engine = store.getEngineById(info.menuItemId);
      if (engine && info.selectionText) {
        performSearch(info.selectionText, engine, tab, store);
      }
    });
  }

  // Automatically update context menus in real-time when store changes
  store.subscribe(() => {
    rebuildContextMenus(store);
  });

  // Now perform the initial data load
  await store.load();
  rebuildContextMenus(store);
}
