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
    return query.replace(regex, engine.queryReplacement);
  } catch (error) {
    console.error(`Regex replacement error for engine ${engine.id}:`, error);
    return query;
  }
}

/**
 * Create dynamic context menu items based on active configuration.
 */
function rebuildContextMenus() {
  browser.contextMenus.removeAll(() => {
    activeEngines.forEach((engine) => {
      browser.contextMenus.create({
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

  browser.tabs.create({
    url: searchUrl,
    index: currentTab ? currentTab.index + 1 : undefined,
    openerTabId: currentTab ? currentTab.id : undefined
  });
}

/**
 * Entrypoint: Initializes storage defaults, registers context menus, and sets up listeners.
 */
export async function initializeSearchShortcuts() {
  const data = await browser.storage.local.get("searchEngines");
  
  if (!data.searchEngines) {
    activeEngines = [
      {
        id: "searchOnMis",
        title: "Search on Mis",
        urlTemplate: "https://missav.ai/search/{id}",
        queryRegex: "([a-zA-Z]+)(0+)?-?(\\d{3,})",
        queryReplacement: "$1-$3"
      },
      {
        id: "searchOnSiro",
        title: "Search on Siro",
        urlTemplate: "https://sirowiki.com/search/?keyword={query}",
        queryRegex: null,
        queryReplacement: null
      },
      {
        id: "searchOnVida",
        title: "Search on Vida",
        urlTemplate: "https://video.dmm.co.jp/av/list/?key={id}",
        queryRegex: "([a-zA-Z]+)(0+)?-?(\\d{3,})",
        queryReplacement: "$1 $3"
      },
      {
        id: "searchOnVidc",
        title: "Search on Vidc",
        urlTemplate: "https://video.dmm.co.jp/amateur/list/?key={id}",
        queryRegex: "([a-zA-Z]+)(0+)?-?(\\d{3,})",
        queryReplacement: "$1 $3"
      }
    ];
    await browser.storage.local.set({ searchEngines: activeEngines });
  } else {
    activeEngines = data.searchEngines;
  }

  // Setup context menus on startup and install
  const setupContextMenus = () => {
    rebuildContextMenus();
  };
  browser.runtime.onStartup.addListener(setupContextMenus);
  browser.runtime.onInstalled.addListener(setupContextMenus);

  // Run immediately as well
  rebuildContextMenus();

  // Listen to context menu clicks
  browser.contextMenus.onClicked.addListener((info, tab) => {
    const engine = activeEngines.find((e) => e.id === info.menuItemId);
    if (engine && info.selectionText) {
      performSearch(info.selectionText, engine, tab);
    }
  });

  // Automatically update active settings and context menus in real-time
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.searchEngines) {
      activeEngines = changes.searchEngines.newValue || [];
      rebuildContextMenus();
    }
  });
}
