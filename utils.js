// Local module cache of active engines
let activeEngines = [];

/**
 * Format the query using the user-provided regex pattern and replacement target.
 */
function formatQuery(query, engine) {
  if (!engine.queryRegex || !engine.queryReplacement) {
    return query;
  }
  try {
    const regex = new RegExp(engine.queryRegex);
    
    // Extract the matched portion first to discard any surrounding unneeded text (like spaces or extra words)
    const match = query.match(regex);
    if (match) {
      return match[0].replace(regex, engine.queryReplacement);
    } else {
      return query;
    }
  } catch (error) {
    console.error(`[formatQuery] Regex replacement error for engine "${engine.id}":`, error);
    return query;
  }
}

/**
 * Create dynamic context menu items based on active configuration.
 */
function rebuildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    activeEngines.forEach((engine) => {
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
function performSearch(query, engine, currentTab) {
  const trimmed = query.trim();
  const processedQuery = formatQuery(trimmed, engine);
  const searchUrl = engine.urlTemplate
    .replace("{id}", encodeURIComponent(processedQuery))
    .replace("{query}", encodeURIComponent(processedQuery));

  chrome.tabs.create({
    url: searchUrl,
    index: currentTab ? currentTab.index + 1 : undefined,
    openerTabId: currentTab ? currentTab.id : undefined
  });
}

/**
 * Entrypoint: Initializes storage defaults, registers context menus, and sets up listeners.
 */
export async function initializeSearchShortcuts() {
  // Setup context menus on startup and install
  const setupContextMenus = async () => {
    const data = await chrome.storage.local.get("searchEngines");
    if (data.searchEngines) {
      activeEngines = data.searchEngines;
    }
    rebuildContextMenus();
  };

  // Register listeners SYNCHRONOUSLY before any await, to ensure Manifest V3 service worker registers them on the first tick
  chrome.runtime.onStartup.addListener(setupContextMenus);
  chrome.runtime.onInstalled.addListener(setupContextMenus);

  // Listen to context menu clicks
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (activeEngines.length === 0) {
      const data = await chrome.storage.local.get("searchEngines");
      if (data.searchEngines) {
        activeEngines = data.searchEngines;
      }
    }
    const engine = activeEngines.find((e) => e.id === info.menuItemId);
    if (engine && info.selectionText) {
      performSearch(info.selectionText, engine, tab);
    }
  });

  // Automatically update active settings and context menus in real-time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.searchEngines) {
      activeEngines = changes.searchEngines.newValue || [];
      rebuildContextMenus();
    }
  });

  // Now perform the asynchronous data initialization
  const data = await chrome.storage.local.get("searchEngines");
  
  if (!data.searchEngines) {
    activeEngines = [];
    await chrome.storage.local.set({ searchEngines: activeEngines });
  } else {
    activeEngines = data.searchEngines;
  }

  // Run immediately as well
  rebuildContextMenus();
}

