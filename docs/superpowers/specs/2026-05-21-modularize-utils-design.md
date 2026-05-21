# Design Spec: Modularizing utils.js with browser.storage.local Configuration

This design document outlines the transition of the search shortcut logic in the Collection browser extension from a hardcoded implementation to a fully modularized, user-configurable system backed by `browser.storage.local`. The unused URL redirect function is also completely removed.

## Goals
- Modularize `utils.js` by making search engines fully dynamic and user-configurable via `browser.storage.local`.
- Support user-provided search URLs, display titles, mapped commands, custom query regular expressions, and capture group replacement patterns.
- Keep context menus, search event listeners, and keyboard command listeners automatically synchronized when storage changes.
- Completely remove the unused `redirectUrl` function and associated blocking `webRequest` permissions to optimize extension footprint, security, and performance.

## Storage Configuration Schema

We store the array of search shortcut configurations in `browser.storage.local` under the key `"searchEngines"`.

```json
[
  {
    "id": "searchOnMis",
    "title": "Search on Mis",
    "urlTemplate": "https://missav.ai/search/{id}",
    "queryRegex": "([a-zA-Z]+)(0+)?-?(\\d{3,})",
    "queryReplacement": "$1-$3",
    "command": "search_on_mis"
  },
  {
    "id": "searchOnSiro",
    "title": "Search on Siro",
    "urlTemplate": "https://sirowiki.com/search/?keyword={query}",
    "queryRegex": null,
    "queryReplacement": null,
    "command": "search_on_siro"
  },
  {
    "id": "searchOnVida",
    "title": "Search on Vida",
    "urlTemplate": "https://video.dmm.co.jp/av/list/?key={id}",
    "queryRegex": "([a-zA-Z]+)(0+)?-?(\\d{3,})",
    "queryReplacement": "$1 $3",
    "command": null
  },
  {
    "id": "searchOnVidc",
    "title": "Search on Vidc",
    "urlTemplate": "https://video.dmm.co.jp/amateur/list/?key={id}",
    "queryRegex": "([a-zA-Z]+)(0+)?-?(\\d{3,})",
    "queryReplacement": "$1 $3",
    "command": null
  }
]
```

### Properties
- `id` (String): A unique identifier for the search engine.
- `title` (String): Display text in the selection context menu.
- `urlTemplate` (String): The URL to open, with placeholders `{id}` or `{query}` replaced with the formatted selection query.
- `queryRegex` (String | null): Custom regular expression pattern to run against the selected text.
- `queryReplacement` (String | null): Match replacement pattern using standard capture group variables (e.g. `$1`, `$3`).
- `command` (String | null): Mapped command string corresponding to keybindings registered in `manifest.json`.

---

## Technical Architecture & Implementation

### 1. `utils.js` (Modular Search Shortcuts)

We modularize `utils.js` to manage defaults, process dynamic regular expressions, register/update context menus, and listen to selection clicks/command triggers.

```javascript
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
        queryReplacement: "$1-$3",
        command: "search_on_mis"
      },
      {
        id: "searchOnSiro",
        title: "Search on Siro",
        urlTemplate: "https://sirowiki.com/search/?keyword={query}",
        queryRegex: null,
        queryReplacement: null,
        command: "search_on_siro"
      },
      {
        id: "searchOnVida",
        title: "Search on Vida",
        urlTemplate: "https://video.dmm.co.jp/av/list/?key={id}",
        queryRegex: "([a-zA-Z]+)(0+)?-?(\\d{3,})",
        queryReplacement: "$1 $3",
        command: null
      },
      {
        id: "searchOnVidc",
        title: "Search on Vidc",
        urlTemplate: "https://video.dmm.co.jp/amateur/list/?key={id}",
        queryRegex: "([a-zA-Z]+)(0+)?-?(\\d{3,})",
        queryReplacement: "$1 $3",
        command: null
      }
    ];
    await browser.storage.local.set({ searchEngines: activeEngines });
  } else {
    activeEngines = data.searchEngines;
  }

  // Setup context menus
  rebuildContextMenus();

  // Listen to context menu clicks
  browser.contextMenus.onClicked.addListener((info, tab) => {
    const engine = activeEngines.find((e) => e.id === info.menuItemId);
    if (engine && info.selectionText) {
      performSearch(info.selectionText, engine, tab);
    }
  });

  // Listen to keyboard commands mapped to specific engines
  browser.commands.onCommand.addListener((command) => {
    const engine = activeEngines.find((e) => e.command === command);
    if (!engine) return;

    browser.tabs.query({ currentWindow: true, active: true }, (result) => {
      const tab = result[0];
      if (!tab) return;

      browser.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => window.getSelection().toString()
        },
        (selection) => {
          if (selection && selection[0] && selection[0].result) {
            performSearch(selection[0].result, engine, tab);
          }
        }
      );
    });
  });

  // Automatically update active settings and context menus in real-time
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.searchEngines) {
      activeEngines = changes.searchEngines.newValue || [];
      rebuildContextMenus();
    }
  });
}
```

---

### 2. Cleanups

#### **`background.js`**
Clean up imports and initialize functions:
```diff
-import { addSearchShortcut, redirectUrl } from './utils.js'
+import { initializeSearchShortcuts } from './utils.js'
 
-addSearchShortcut();
-
-redirectUrl();
+initializeSearchShortcuts();
```

#### **`manifest.json`**
Remove unused permissions:
```diff
   "permissions": [
     "activeTab",
     "scripting",
     "contextMenus",
     "tabs",
     "storage",
     "downloads",
-    "webRequest",
-    "webRequestBlocking",
     "webNavigation",
     "<all_urls>"
   ],
```

---

## Verification & Testing Plan

1. **Context Menu Setup**: Load extension, select text on a page, and verify the four default search engines are displayed in the context menu.
2. **Dynamic Configuration Change**:
   - Programmatically or via extension store console edit `"searchEngines"` in `browser.storage.local` to change one of the URLs or regexes.
   - Verify context menu updates instantly in real-time.
3. **Regex Processing**:
   - Select `"MIDD00123"` and trigger "Search on Mis". Verify it redirects to `https://missav.ai/search/MIDD-123`.
   - Select `"MIDD00123"` and trigger "Search on Vida". Verify it redirects to `https://video.dmm.co.jp/av/list/?key=MIDD%20123`.
   - Select `"hello"` and trigger "Search on Siro". Verify it redirects to `https://sirowiki.com/search/?keyword=hello`.
4. **Command Hotkey Handling**: Press registered command keys (Ctrl+M, Ctrl+S) and verify search logic triggers correctly.
