# Design Spec: Manifest V3 Migration and Comprehensive Documentation

This design document outlines the technical changes needed to transition the browser extension to Manifest V3 (MV3) for Chromium compatibility, enable dual Chrome/Firefox sidebar capabilities, and establish a high-quality, comprehensive project README.md.

---

## 1. manifest.json (Manifest V3 Upgrade)

We will upgrade `manifest.json` from Manifest V2 (MV2) to Manifest V3 (MV3). The key modifications include:

*   Changing `"manifest_version"` to `3`.
*   Replacing `background.scripts` with an event-driven service worker:
    ```json
    "background": {
      "service_worker": "background.js",
      "type": "module"
    }
    ```
*   Renaming `"browser_action"` to `"action"`.
*   Moving host permissions (`<all_urls>`) from the `"permissions"` array to the separate `"host_permissions"` field, which is strictly required in MV3.
*   Enabling Chromium's native `"side_panel"` API by adding the `"sidePanel"` permission and configuring the path:
    ```json
    "side_panel": {
      "default_path": "sidebar/sidebar.html"
    }
    ```
*   Retaining Firefox's `"sidebar_action"` block for fallback compatibility.

### Full Updated Manifest Specification
```json
{
  "manifest_version": 3,
  "name": "Collection",
  "description": "A browser extension to collect and tag items.",
  "version": "2.0",
  "permissions": [
    "activeTab",
    "scripting",
    "contextMenus",
    "tabs",
    "storage",
    "downloads",
    "webNavigation",
    "sidePanel"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "vincent031525@gmail.com"
    }
  },
  "sidebar_action": {
    "default_title": "Collections",
    "default_panel": "sidebar/sidebar.html"
  },
  "side_panel": {
    "default_path": "sidebar/sidebar.html"
  },
  "action": {
    "default_title": "Search Shortcuts Settings",
    "default_popup": "popup/popup.html"
  }
}
```

---

## 2. API Namespace Migration (browser to chrome)

To support both Google Chrome / Chromium and Mozilla Firefox natively, all extension scripts will transition to using the standard `chrome.*` namespace instead of `browser.*`. 

The following files will undergo global replacement from `browser.` to `chrome.`:
1.  `background.js`
2.  `utils.js`
3.  `popup/popup.js`
4.  `sidebar/sidebar.js`
5.  `sidebar/store.js`
6.  `sidebar/addItemView.js`
7.  `sidebar/itemsView.js`

---

## 3. Comprehensive Project README.md

We will create a stunning, professional `README.md` at the root directory of the workspace. Written in **English**, it will be structured as follows:

1.  **Project Title & Tagline**: Highlighting the extension's dual functionality (Item Collection & Dynamic Search Shortcuts).
2.  **Key Features**:
    *   *Dual-Sidebar Integration*: Clean description of native Chrome Side Panel and Firefox Sidebar support.
    *   *Smart Content Collection*: Details about active-tab fetching, background scraping, and automatic image finder.
    *   *Rich Metadata Organizing*: Organizing tags, actor/model names, and autocompletion lists.
    *   *Regex-Powered Search Shortcuts*: Popup-driven CRUD settings allowing regular expression query cleaning.
    *   *Data Import/Export*: Effortless JSON backup management.
3.  **Visual Architecture Flow**: A markdown-based workflow highlighting relations between components.
4.  **Directory Structure**: A clean layout tree of the repository.
5.  **Installation & Usage**:
    *   Detailed Chromium / Google Chrome setup instructions (Developer Mode).
    *   Detailed Firefox add-on debug installation instructions.
6.  **Configuration Examples**: Practical tutorial showing how to configure a dynamic regex search shortcut.

---

## 4. Verification & Testing Plan

1.  **Chromium Loading Test**: Load the unpacked extension directory into Chrome (Developer Mode) and verify no warnings or errors are displayed.
2.  **Side Panel Activation**: Trigger the extension side panel in Chrome, confirming that the collection list renders perfectly.
3.  **Active Tab Scraping**: Navigate to any webpage, open the "Add Item" interface in the sidebar, and verify that the page title, URL, and cover image are successfully fetched.
4.  **Dynamic Context Menu Execution**: 
    *   Add a new search shortcut in the Settings popup.
    *   Select text on any webpage, right-click, and verify that the new search engine is displayed.
    *   Verify that clicking it executes the regular expression replacement correctly and opens the search result.
5.  **Git Status Checklist**: Confirm that all changes are successfully committed to Git as requested by the user's global rules.
