// Local module cache of active engines
let activeEngines = [];

/**
 * Format the query using the user-provided regex pattern and replacement target.
 */
function formatQuery(query, engine) {
  console.log(`[formatQuery] --- Starting Formatting ---`);
  console.log(`[formatQuery] Original selected text: "${query}"`);
  if (!engine.queryRegex || !engine.queryReplacement) {
    console.log(`[formatQuery] No regex or replacement configured for engine "${engine.title}". Returning original text.`);
    return query;
  }
  try {
    console.log(`[formatQuery] Configured Regex: "${engine.queryRegex}"`);
    console.log(`[formatQuery] Configured Replacement: "${engine.queryReplacement}"`);
    const regex = new RegExp(engine.queryRegex);
    console.log(`[formatQuery] Compiled RegExp Object:`, regex);
    
    // Extract the matched portion first to discard any surrounding unneeded text (like spaces or extra words)
    const match = query.match(regex);
    if (match) {
      console.log(`[formatQuery] Found matched portion within selection: "${match[0]}"`);
      const result = match[0].replace(regex, engine.queryReplacement);
      console.log(`[formatQuery] Formatting Result: "${result}"`);
      return result;
    } else {
      console.log(`[formatQuery] Selected text does not match the regex pattern. Returning original text.`);
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
  console.log(`[rebuildContextMenus] Rebuilding context menus for active engines:`, activeEngines);
  chrome.contextMenus.removeAll(() => {
    activeEngines.forEach((engine) => {
      chrome.contextMenus.create({
        id: engine.id,
        title: engine.title,
        contexts: ["selection"]
      });
    });
    console.log(`[rebuildContextMenus] Context menus rebuilt successfully.`);
  });
}

/**
 * Open a search engine URL based on selected text.
 */
function performSearch(query, engine, currentTab) {
  console.log(`[performSearch] Performing search for engine: "${engine.title}"`);
  const trimmed = query.trim();
  const processedQuery = formatQuery(trimmed, engine);
  const searchUrl = engine.urlTemplate
    .replace("{id}", encodeURIComponent(processedQuery))
    .replace("{query}", encodeURIComponent(processedQuery));

  console.log(`[performSearch] Generated Search URL: "${searchUrl}"`);
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
  console.log(`[initializeSearchShortcuts] Initializing Search Shortcuts...`);

  // Setup context menus on startup and install
  const setupContextMenus = async () => {
    console.log(`[setupContextMenus] Event fired (startup/install). Loading engines...`);
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
    console.log(`[chrome.contextMenus.onClicked] Context menu clicked. Info:`, info);
    if (activeEngines.length === 0) {
      console.log(`[chrome.contextMenus.onClicked] Cache is empty. Loading engines from storage...`);
      const data = await chrome.storage.local.get("searchEngines");
      if (data.searchEngines) {
        activeEngines = data.searchEngines;
      }
    }
    const engine = activeEngines.find((e) => e.id === info.menuItemId);
    if (engine && info.selectionText) {
      performSearch(info.selectionText, engine, tab);
    } else {
      console.warn(`[chrome.contextMenus.onClicked] Engine not found or selection text is missing.`);
    }
  });

  // Automatically update active settings and context menus in real-time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.searchEngines) {
      console.log(`[chrome.storage.onChanged] "searchEngines" storage changed!`, changes.searchEngines.newValue);
      activeEngines = changes.searchEngines.newValue || [];
      rebuildContextMenus();
    }
  });

  // Now perform the asynchronous data initialization
  const data = await chrome.storage.local.get("searchEngines");
  
  if (!data.searchEngines) {
    console.log(`[initializeSearchShortcuts] No engines found in storage. Initializing empty array.`);
    activeEngines = [];
    await chrome.storage.local.set({ searchEngines: activeEngines });
  } else {
    console.log(`[initializeSearchShortcuts] Engines loaded from storage:`, data.searchEngines);
    activeEngines = data.searchEngines;
  }

  // Run immediately as well
  rebuildContextMenus();
}

