# Design Spec: Search Shortcuts Popup Configuration Panel

This design specification details the implementation of a clean, minimalist browser action popup settings panel that matches the sidebar's light aesthetic. The popup allows full CRUD management of the search shortcuts stored in `browser.storage.local`. Additionally, all static extension keyboard commands/shortcuts are completely removed from the project to simplify the footprint and user configuration.

## Goals
- Add a new browser action popup page (`popup/popup.html` and `popup/popup.js`).
- Support full CRUD operations (Create, Read, Update, Delete) on search shortcut configurations inside `browser.storage.local`.
- Completely remove the static keyboard commands block and hotkey listeners from the manifest, background scripts, and modular shortcuts code.
- Ensure context menus update in real-time as shortcuts are added, edited, or deleted in the popup.

---

## Architecture and File Updates

### 1. `manifest.json` (Add Popup & Remove Commands)
Remove the `"commands"` block entirely, and add `"browser_action"` configuration:

```json
  "browser_action": {
    "default_title": "Search Shortcuts Settings",
    "default_popup": "popup/popup.html"
  }
```

---

### 2. Code Cleanups

#### **`background.js`**
Delete the entire `browser.commands.onCommand` listener:
```diff
-// 監聽快捷鍵指令
-browser.commands.onCommand.addListener(async (command) => {
-  if (command === "add-current-tab") {
-    ...
-  }
-});
```

#### **`utils.js`**
- Delete the command keyboard listener `browser.commands.onCommand.addListener(...)`.
- Delete the `"command"` field from the default search engines.

---

### 3. Popup User Interface (`popup/popup.html`)

A light-themed, single-page, dual-view switching layout that mirrors the design pattern and style of the sidebar.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Search Shortcuts Settings</title>
    <style>
        html, body {
            width: 420px;
            height: 500px;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            overflow: hidden;
            background-color: #f8f9fa;
            color: #333;
        }
        
        .view {
            display: none;
            flex-direction: column;
            height: 100%;
            width: 100%;
            box-sizing: border-box;
        }

        .view.active {
            display: flex;
        }

        .toolbar {
            flex-shrink: 0;
            background-color: white;
            border-bottom: 1px solid #eee;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .toolbar h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }

        .content {
            flex-grow: 1;
            overflow-y: auto;
            padding: 16px;
        }

        /* List View Elements */
        .shortcut-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .shortcut-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .shortcut-info {
            min-width: 0;
            flex-grow: 1;
            padding-right: 12px;
        }

        .shortcut-title {
            font-weight: 500;
            font-size: 14px;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .shortcut-meta {
            font-size: 11px;
            color: #666;
            word-break: break-all;
        }

        .shortcut-regex {
            font-size: 11px;
            color: #4a5568;
            background-color: #edf2f7;
            padding: 1px 4px;
            border-radius: 3px;
            display: inline-block;
            margin-top: 4px;
            font-family: monospace;
        }

        .actions {
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }

        /* Forms */
        .form-group {
            margin-bottom: 16px;
        }

        .form-group label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
            font-size: 12px;
            color: #4a5568;
        }

        .form-group input {
            width: 100%;
            padding: 8px;
            box-sizing: border-box;
            border: 1px solid #cbd5e0;
            border-radius: 4px;
            font-size: 13px;
            outline: none;
        }

        .form-group input:focus {
            border-color: #3182ce;
        }

        /* Buttons */
        button {
            padding: 6px 12px;
            border: 1px solid #cbd5e0;
            border-radius: 4px;
            background-color: white;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
        }

        button:hover {
            background-color: #f7fafc;
            border-color: #a0aec0;
        }

        .btn-primary {
            background-color: #3182ce;
            color: white;
            border-color: #3182ce;
        }

        .btn-primary:hover {
            background-color: #2b6cb0;
            border-color: #2b6cb0;
        }

        .btn-danger {
            color: #e53e3e;
            border-color: #fed7d7;
        }

        .btn-danger:hover {
            background-color: #fff5f5;
            border-color: #e53e3e;
        }

        .view-footer {
            flex-shrink: 0;
            padding: 12px 16px;
            border-top: 1px solid #eee;
            background-color: white;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        .empty-state {
            text-align: center;
            color: #718096;
            margin-top: 40px;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <!-- List View -->
    <div id="listView" class="view active">
        <div class="toolbar">
            <h3>Search Shortcuts</h3>
            <button id="addBtn" class="btn-primary">Add New</button>
        </div>
        <div class="content">
            <ul id="shortcutsList" class="shortcut-list"></ul>
            <div id="emptyState" class="empty-state" style="display: none;">
                No search shortcuts configured. Click "Add New" to get started.
            </div>
        </div>
    </div>

    <!-- Form View (Add/Edit) -->
    <div id="formView" class="view">
        <div class="toolbar">
            <h3 id="formTitle">Add Search Shortcut</h3>
        </div>
        <div class="content">
            <input type="hidden" id="engineId">
            <div class="form-group">
                <label for="engineTitle">Shortcut Title</label>
                <input type="text" id="engineTitle" placeholder="e.g. Search on Mis" required>
            </div>
            <div class="form-group">
                <label for="engineUrl">URL Template (use {id} or {query} placeholder)</label>
                <input type="url" id="engineUrl" placeholder="e.g. https://missav.ai/search/{id}" required>
            </div>
            <div class="form-group">
                <label for="engineRegex">Custom Query Regex (Optional)</label>
                <input type="text" id="engineRegex" placeholder="e.g. ([a-zA-Z]+)(0+)?-?(\d{3,})">
            </div>
            <div class="form-group">
                <label for="engineReplacement">Regex Replacement (Optional)</label>
                <input type="text" id="engineReplacement" placeholder="e.g. $1-$3">
            </div>
        </div>
        <div class="view-footer">
            <button id="cancelBtn">Cancel</button>
            <button id="saveBtn" class="btn-primary">Save</button>
        </div>
    </div>

    <script src="popup.js"></script>
</body>
</html>
```

---

## Verification & Testing Plan
1. **Shortcut Removal Verification**: Verify no errors are thrown by other scripts during build and startup after commands are removed.
2. **Popup UI Access**: Open extension settings popup, verify default list renders correctly.
3. **Add Action**: Click "Add New", enter new credentials, click "Save", verify new card renders and context menu updates immediately.
4. **Edit Action**: Click "Edit" on a card, verify inputs are filled correctly, change title/regex, click "Save", verify context menus reflect the edited values.
5. **Delete Action**: Click "Delete", confirm, verify it is removed from list and background context menu rebuilds immediately.
