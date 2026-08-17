# Collection & Dynamic Search Shortcuts Extension (v2.1)

A high-performance, premium, and feature-rich browser extension designed to seamlessly organize web items, manage dynamic tagging, scrape rich metadata, and execute custom, regex-powered search engine redirects directly from context selections. 

Fully engineered under the **Manifest V3 (MV3)** standard, it boasts native compatibility for both **Google Chrome / Chromium-based browsers** (via the Side Panel API) and **Mozilla Firefox** (via the Sidebar API).

---

## 🚀 Key Features

* **Dual-Sidebar Integration**: Offers a responsive, premium side-panel experience matching your browser's design. Opens as a native Side Panel in Chrome and a custom Sidebar in Firefox.
* **One-Key Fast Collection (`Alt+Shift+S`)**: Global keyboard shortcut to save the active webpage into Collection instantly without opening the sidebar, featuring an in-page floating toast HUD and extension badge indicator.
* **Intelligent Metadata & Cover Scraper**: Multi-stage preview extraction:
  1. *Tab DOM Inspection*: Directly queries active tab DOM for `og:image` meta tags (including dynamic SPA frameworks).
  2. *Background Fetch Fallback*: Asynchronously fetches HTML in the background with timeout protection for unopened links.
* **Smooth Highlight & View Alignment (`highlightHelper`)**: When selecting random items or navigating to specific records, smoothly centers the target item with pulsing visual cues and automatically realigns scroll offset once lazy images load.
* **Tag & Actor Management**: Categorize collections using multi-tag select structures, drag-and-drop tag reordering, cascading tag renaming/deleting, plus support for autocomplete actor and model names.
* **Regex-Powered Search Shortcuts**: A dedicated settings popup to create, read, update, and delete (CRUD) custom context menu search shortcuts. Features advanced regular expression matching for query extraction and target URL template replacements.
* **Unified Data Portability**: Full backup and restore capabilities (`backupCoordinator.js`) allowing one-click export and import of your collections, tags, and custom search shortcut engines to and from clean JSON files.
* **Decoupled Deep Modules & Seams**: Built with clear architectural seams (`ChromeStorageAdapter`, `MemoryStorageAdapter`, `ChromeTabAdapter`, `MemoryTabAdapter`) for 100% testability without browser dependency mocks.

---

## 🛠 Project Architecture & Structure

The repository is structured into modular deep components to enforce clean boundaries and high maintainability:

```text
.
├── background.js          # Event-driven background service worker (scrapers, shortcuts, toast HUD)
├── utils.js               # Search shortcut logic & dynamic context menu managers
├── searchEngineStore.js   # Deep module for search shortcut persistence & query compilation
├── tabAdapter.js          # Unified browser tab navigation & JSON download seam
├── manifest.json          # Main Manifest V3 configuration (dual side-panel & actions)
├── popup/                 # Search Shortcut Settings Popup
│   ├── popup.html         # Light-aesthetic layout for managing search templates
│   └── popup.js           # Settings CRUD controller & storage handlers
├── sidebar/               # Main Collection Sidebar Module
│   ├── sidebar.html       # Sidebar visual UI with flex designs
│   ├── sidebar.js         # Navigation router and view controller
│   ├── backupCoordinator.js # Unified backup export/import coordinator
│   ├── highlightHelper.js   # Smooth focus, highlight timer, and image-load alignment
│   ├── store.js           # Core state management with chrome.storage.local persistence
│   ├── itemsView.js       # List layout renderer, sorting, search, and context menu handlers
│   ├── addItemView.js     # Collection creator and editor form controller
│   └── manageTagsView.js  # Dedicated tag creator, DND reorder, and cascade list controller
└── tests/                 # Zero-dependency Unit Test Suite (node:test)
    ├── backupCoordinator.test.js  # Backup generation, schema validation, and restore tests
    ├── highlightHelper.test.js    # Focus, scroll, cleanup, and image-realign tests
    ├── imageFetch.test.js         # URL resolution & og:image parser tests
    ├── quickSave.test.js          # Fast collection logic & tab validation tests
    ├── searchEngineStore.test.js  # CRUD, regex compilation, and template tests
    ├── store.test.js              # Items CRUD, cascade tag updates, and query tests
    └── tabAdapter.test.js         # Tab placement, batch opening, and JSON download tests
```

---

## 💻 Installation Guide

### For Google Chrome & Chromium-Based Browsers (Chrome, Edge, Brave, Opera)
This extension uses the modern **Manifest V3** standard and native Side Panel APIs.

1. Clone or download this repository to your local system.
2. Open your Chromium browser and navigate to `chrome://extensions/`.
3. In the top-right corner, toggle the **"Developer mode"** switch to **ON**.
4. In the top-left corner, click **"Load unpacked"**.
5. Select the root folder of this project (the folder containing `manifest.json`).
6. The extension is now installed! You can click the extension icon to manage search shortcut settings or open the **Side Panel** from your browser's toolbar dropdown to view your library.

### For Mozilla Firefox
This extension maintains complete backward and forward compatibility with Firefox.

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select the `manifest.json` file in the root folder of this project.
4. The extension is now active! You can access the Sidebar from the Firefox sidebar toggle menu.

---

## ⚙️ Search Shortcuts Configuration Guide

The Search Shortcuts settings allow you to select text on any webpage, right-click, and search with a custom-defined URL template. Optionally, you can supply a **Regular Expression** to clean or format the selected text before pushing it into the search query.

### Examples

| Shortcut Title | URL Template | Custom Regex (Optional) | Regex Replacement (Optional) | Example Input Selection | Example Formatted Search URL |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Search** | `https://www.google.com/search?q={query}` | *(None)* | *(None)* | `Antigravity AI` | `https://www.google.com/search?q=Antigravity%20AI` |
| **GitHub Repo Search** | `https://github.com/search?q={query}` | `^#?([a-zA-Z0-9_-]+)$` | `$1` | `#extension` | `https://github.com/search?q=extension` |

*Use `{id}` or `{query}` as template placeholders in your URL definitions. Selected text is automatically formatted and safely URI-encoded at runtime.*

---

## ⌨️ Keyboard Shortcuts

| Action | Default Shortcut (Win/Linux) | Default Shortcut (macOS) | Customization Path |
| :--- | :--- | :--- | :--- |
| **Save Active Webpage** | `Alt + Shift + S` | `Option + Shift + S` | `chrome://extensions/shortcuts` |

*When triggered, a floating toast HUD will confirm the save on the current page, and the extension icon will display a temporary confirmation badge (`✓`).*

---

## 🧪 Running Unit Tests

The codebase includes an extensive, zero-dependency unit test suite built directly on Node.js standard modules (`node:test` and `node:assert/strict`).

Run all test suites locally using:

```bash
node --test tests/*.test.js
```

---

## 📄 License & Standards

Developed with native ES Modules, vanilla JS, custom CSS variables, and modern web standards. Built for speed, privacy, and full offline capability. No user tracking, external analytics, or remote API execution. All data is persisted directly inside your local browser sandbox via `chrome.storage.local`.
