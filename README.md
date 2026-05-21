# Collection & Dynamic Search Shortcuts Extension

A high-performance, premium, and feature-rich browser extension designed to seamlessly organize web items, manage dynamic tagging, scrape rich metadata, and execute custom, regex-powered search engine redirects directly from context selections. 

Fully engineered under the **Manifest V3 (MV3)** standard, it boasts native compatibility for both **Google Chrome / Chromium-based browsers** (via the Side Panel API) and **Mozilla Firefox** (via the Sidebar API).

---

## 🚀 Key Features

*   **Dual-Sidebar Integration**: Offers a responsive, premium side-panel experience matching your browser's design. Opens as a native Side Panel in Chrome and a custom Sidebar in Firefox.
*   **Active Tab Collector**: One-click extraction of the active page's Title and URL, instantly populating your item collection.
*   **Background Cover Scraper**: Uses background service workers to query pages and fetch preview covers automatically.
*   **Tag & Actor Management**: Categorize collections using multi-tag select structures, plus support for autocomplete tags and custom creator/model name tags.
*   **Regex-Powered Search Shortcuts**: A dedicated settings popup to create, read, update, and delete (CRUD) custom context menu search shortcuts. Features advanced regular expression matching for query extraction and target URL template replacements.
*   **Data Portability**: Full backup and restore capabilities allowing one-click export and import of your collections to and from clean JSON files.

---

## 🛠 Project Architecture & Structure

The repository is structured logically to separate concern, enforce clean module boundaries, and simplify code modifications.

```text
.
├── background.js          # Event-driven background service worker (scrapers, communication)
├── utils.js               # Search shortcut logic & dynamic context menu managers
├── manifest.json          # Main Manifest V3 configuration (dual side-panel & actions)
├── docs/                  # Design specifications and implementation plans
├── popup/                 # Search Shortcut Settings Popup
│   ├── popup.html         # Light-aesthetic layout for managing search templates
│   └── popup.js           # Settings CRUD controller & storage handlers
├── scripts/               # Secondary helper scripts
│   └── image_finder.js    # Image discovery scraper injected in background tabs
└── sidebar/               # Main Collection Sidebar Module
    ├── sidebar.html       # Sidebar visual UI with flex designs
    ├── sidebar.js         # Navigation router and import/export coordinator
    ├── store.js           # Core state management with chrome.storage.local persistence
    ├── itemsView.js       # List layout renderer, sorting, search, and context menu handlers
    ├── addItemView.js     # Collection creator and editor form controller
    └── manageTagsView.js  # Dedicated tag creator, counter, and list controller
```

---

## 💻 Installation Guide

### For Google Chrome & Chromium-Based Browsers (Chrome, Edge, Brave, Opera)
This extension uses the modern **Manifest V3** standard and native Side Panel APIs.

1.  Clone or download this repository to your local system.
2.  Open your Chromium browser and navigate to `chrome://extensions/`.
3.  In the top-right corner, toggle the **"Developer mode"** switch to **ON**.
4.  In the top-left corner, click **"Load unpacked"**.
5.  Select the root folder of this project (the folder containing `manifest.json`).
6.  The extension is now installed! You can click the extension icon to manage settings or open the **Side Panel** from your browser's toolbar dropdown to view your library.

### For Mozilla Firefox
This extension maintains complete backward and forward compatibility with Firefox.

1.  Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2.  Click **"Load Temporary Add-on..."**.
3.  Select the `manifest.json` file in the root folder of this project.
4.  The extension is now active! You can access the Sidebar from the Firefox sidebar toggle menu.

---

## ⚙️ Search Shortcuts Configuration Guide

The Search Shortcuts settings allow you to select text on any webpage, right-click, and search with a custom-defined URL template. Optionally, you can supply a **Regular Expression** to clean or format the selected text before pushing it into the search query.

### Examples

| Shortcut Title | URL Template | Custom Regex (Optional) | Regex Replacement (Optional) | Example Input Selection | Example Formatted Search URL |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Search** | `https://www.google.com/search?q={query}` | *(None)* | *(None)* | `Antigravity AI` | `https://www.google.com/search?q=Antigravity%20AI` |

*Use `{id}` or `{query}` as template placeholders in your URL definitions. Selected text is automatically formatted and safely URI-encoded at runtime.*

---

## 📄 License & Standards
Developed with native ES Modules, vanilla JS, custom CSS variables, and modern web standards. Built for speed, privacy, and full offline capability. No user tracking, external analytics, or remote API execution. All data is persisted directly inside your local browser sandbox via `chrome.storage.local`.
