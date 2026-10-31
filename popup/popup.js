import { searchEngineStore } from '../searchEngineStore.js';
import { identifierRuleStore, extractIdentifierFromUrl } from '../identifierRuleStore.js';
import { formatKeyboardEvent } from '../content/shortcutHandler.js';

document.addEventListener("DOMContentLoaded", async () => {
    // 建立 Popup 生命週期連線至 background.js，關閉 Popup 時自動觸發背景 Flush Sync
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function') {
        try {
            chrome.runtime.connect({ name: 'popup-lifecycle' });
        } catch {
            // ignore
        }
    }

    const handlePopupClose = () => {
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
            try {
                chrome.runtime.sendMessage({ action: 'flushSync' }, () => {});
            } catch {
                // ignore
            }
        }
    };

    window.addEventListener('pagehide', handlePopupClose);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            handlePopupClose();
        }
    });

    // --- Tab Navigation ---
    const tabShortcutsBtn = document.getElementById("tabShortcutsBtn");
    const tabRulesBtn = document.getElementById("tabRulesBtn");
    const shortcutsSection = document.getElementById("shortcutsSection");
    const rulesSection = document.getElementById("rulesSection");

    function switchTab(target) {
        if (target === 'shortcuts') {
            tabShortcutsBtn.classList.add("active");
            tabRulesBtn.classList.remove("active");
            shortcutsSection.classList.add("active");
            rulesSection.classList.remove("active");
        } else {
            tabRulesBtn.classList.add("active");
            tabShortcutsBtn.classList.remove("active");
            rulesSection.classList.add("active");
            shortcutsSection.classList.remove("active");
        }
    }

    tabShortcutsBtn.addEventListener("click", () => switchTab('shortcuts'));
    tabRulesBtn.addEventListener("click", () => switchTab('rules'));

    // ==========================================
    // 1. Search Shortcuts Manager
    // ==========================================
    const listView = document.getElementById("listView");
    const formView = document.getElementById("formView");
    const shortcutsList = document.getElementById("shortcutsList");
    const emptyState = document.getElementById("emptyState");

    // Form Inputs
    const formTitle = document.getElementById("formTitle");
    const engineIdInput = document.getElementById("engineId");
    const engineTitleInput = document.getElementById("engineTitle");
    const engineUrlInput = document.getElementById("engineUrl");
    const engineRegexInput = document.getElementById("engineRegex");
    const engineReplacementInput = document.getElementById("engineReplacement");
    const engineShortcutInput = document.getElementById("engineShortcut");
    const clearShortcutBtn = document.getElementById("clearShortcutBtn");

    // Buttons
    const addBtn = document.getElementById("addBtn");
    const cancelBtn = document.getElementById("cancelBtn");
    const saveBtn = document.getElementById("saveBtn");

    function renderList() {
        shortcutsList.innerHTML = "";
        const searchEngines = searchEngineStore.getEngines();
        
        if (searchEngines.length === 0) {
            emptyState.style.display = "block";
            return;
        }
        emptyState.style.display = "none";

        searchEngines.forEach((engine) => {
            const card = document.createElement("li");
            card.className = "card-item";

            const info = document.createElement("div");
            info.className = "card-info";

            const title = document.createElement("div");
            title.className = "card-title";
            title.textContent = engine.title;

            const url = document.createElement("div");
            url.className = "card-meta";
            url.textContent = engine.urlTemplate;

            info.appendChild(title);
            info.appendChild(url);

            if (engine.queryRegex) {
                const regexMeta = document.createElement("div");
                regexMeta.className = "card-tag";
                regexMeta.textContent = `Regex: /${engine.queryRegex}/ → ${engine.queryReplacement || ''}`;
                info.appendChild(regexMeta);
            }

            if (engine.shortcut) {
                const shortcutMeta = document.createElement("div");
                shortcutMeta.className = "card-tag";
                shortcutMeta.style.backgroundColor = "#e2e8f0";
                shortcutMeta.style.fontWeight = "600";
                shortcutMeta.textContent = `⌨️ ${engine.shortcut}`;
                info.appendChild(shortcutMeta);
            }

            const actions = document.createElement("div");
            actions.className = "actions";

            const editBtn = document.createElement("button");
            editBtn.textContent = "Edit";
            editBtn.addEventListener("click", () => openForm(engine));

            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "Delete";
            deleteBtn.className = "btn-danger";
            deleteBtn.addEventListener("click", () => deleteEngine(engine.id));

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);

            card.appendChild(info);
            card.appendChild(actions);
            shortcutsList.appendChild(card);
        });
    }

    function openForm(engine = null) {
        listView.classList.remove("active");
        formView.classList.add("active");

        if (engine) {
            formTitle.textContent = "Edit Search Shortcut";
            engineIdInput.value = engine.id;
            engineTitleInput.value = engine.title;
            engineUrlInput.value = engine.urlTemplate;
            engineRegexInput.value = engine.queryRegex || "";
            engineReplacementInput.value = engine.queryReplacement || "";
            engineShortcutInput.value = engine.shortcut || "";
        } else {
            formTitle.textContent = "Add Search Shortcut";
            engineIdInput.value = "";
            engineTitleInput.value = "";
            engineUrlInput.value = "";
            engineRegexInput.value = "";
            engineReplacementInput.value = "";
            engineShortcutInput.value = "";
        }
        engineTitleInput.focus();
    }

    function closeForm() {
        formView.classList.remove("active");
        listView.classList.add("active");
    }

    async function saveForm() {
        const title = engineTitleInput.value.trim();
        const url = engineUrlInput.value.trim();
        const id = engineIdInput.value || null;

        if (!title || !url) {
            alert("Title and URL Template are required!");
            return;
        }

        const regex = engineRegexInput.value.trim() || null;
        const replacement = engineReplacementInput.value.trim() || null;
        const shortcut = engineShortcutInput.value.trim() || null;

        if (shortcut) {
            const existing = searchEngineStore.getEngines().find(
                e => e.shortcut && e.shortcut.toLowerCase() === shortcut.toLowerCase() && e.id !== id
            );
            if (existing) {
                alert(`Shortcut "${shortcut}" is already assigned to "${existing.title}". Please choose a different shortcut.`);
                return;
            }
        }

        try {
            await searchEngineStore.saveEngine({
                id,
                title,
                urlTemplate: url,
                queryRegex: regex,
                queryReplacement: replacement,
                shortcut
            });
            closeForm();
            renderList();
        } catch (err) {
            alert(`Error saving shortcut: ${err.message}`);
        }
    }

    async function deleteEngine(id) {
        if (confirm("Are you sure you want to delete this search shortcut?")) {
            const success = await searchEngineStore.deleteEngine(id);
            if (success) {
                renderList();
            }
        }
    }

    // Keyboard shortcut recording
    engineShortcutInput.addEventListener("keydown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Backspace" || e.key === "Delete") {
            engineShortcutInput.value = "";
            return;
        }
        const formatted = formatKeyboardEvent(e);
        if (formatted) {
            engineShortcutInput.value = formatted;
        }
    });

    clearShortcutBtn.addEventListener("click", () => {
        engineShortcutInput.value = "";
        engineShortcutInput.focus();
    });

    addBtn.addEventListener("click", () => openForm());
    cancelBtn.addEventListener("click", closeForm);
    saveBtn.addEventListener("click", saveForm);

    searchEngineStore.subscribe(() => {
        renderList();
    });

    // ==========================================
    // 2. URL Identifier Rules Manager
    // ==========================================
    const ruleListView = document.getElementById("ruleListView");
    const ruleFormView = document.getElementById("ruleFormView");
    const ruleList = document.getElementById("ruleList");
    const ruleEmptyState = document.getElementById("ruleEmptyState");

    // Rule Form Inputs
    const ruleFormTitle = document.getElementById("ruleFormTitle");
    const ruleIdInput = document.getElementById("ruleId");
    const ruleNameInput = document.getElementById("ruleName");
    const rulePatternInput = document.getElementById("rulePattern");
    const ruleRegexInput = document.getElementById("ruleRegex");
    const ruleReplacementInput = document.getElementById("ruleReplacement");
    const ruleTestUrlInput = document.getElementById("ruleTestUrl");
    const ruleTestPreview = document.getElementById("ruleTestPreview");

    // Rule Buttons
    const ruleAddBtn = document.getElementById("ruleAddBtn");
    const ruleCancelBtn = document.getElementById("ruleCancelBtn");
    const ruleSaveBtn = document.getElementById("ruleSaveBtn");

    function renderRuleList() {
        ruleList.innerHTML = "";
        const rules = identifierRuleStore.getRules();

        if (rules.length === 0) {
            ruleEmptyState.style.display = "block";
            return;
        }
        ruleEmptyState.style.display = "none";

        rules.forEach((rule) => {
            const card = document.createElement("li");
            card.className = "card-item";

            const info = document.createElement("div");
            info.className = "card-info";

            const title = document.createElement("div");
            title.className = "card-title";
            title.textContent = rule.name || "Untitled Rule";

            const patternMeta = document.createElement("div");
            patternMeta.className = "card-meta";
            patternMeta.textContent = `Pattern: ${rule.urlPattern}`;

            info.appendChild(title);
            info.appendChild(patternMeta);

            if (rule.extractionRegex) {
                const regexTag = document.createElement("div");
                regexTag.className = "card-tag";
                const targetText = rule.replacementTemplate
                    ? ` → ${rule.replacementTemplate}`
                    : ` → $${rule.captureGroup || 1}`;
                regexTag.textContent = `Regex: /${rule.extractionRegex}/${targetText}`;
                info.appendChild(regexTag);
            }

            const actions = document.createElement("div");
            actions.className = "actions";

            const editBtn = document.createElement("button");
            editBtn.textContent = "Edit";
            editBtn.addEventListener("click", () => openRuleForm(rule));

            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "Delete";
            deleteBtn.className = "btn-danger";
            deleteBtn.addEventListener("click", () => deleteRule(rule.id));

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);

            card.appendChild(info);
            card.appendChild(actions);
            ruleList.appendChild(card);
        });
    }

    function updateLivePreview() {
        const testUrl = ruleTestUrlInput.value.trim();
        const pattern = rulePatternInput.value.trim();
        const regexStr = ruleRegexInput.value.trim();
        const replacement = ruleReplacementInput.value.trim() || null;

        if (!testUrl) {
            ruleTestPreview.textContent = "(Enter matching URL to test)";
            ruleTestPreview.style.color = "#718096";
            return;
        }

        if (!pattern || !regexStr) {
            ruleTestPreview.textContent = "(Enter URL Pattern and Regex to preview)";
            ruleTestPreview.style.color = "#718096";
            return;
        }

        try {
            const tempRule = {
                urlPattern: pattern,
                extractionRegex: regexStr,
                replacementTemplate: replacement,
                enabled: true
            };
            const extracted = extractIdentifierFromUrl(testUrl, [tempRule]);
            if (extracted) {
                ruleTestPreview.textContent = `✓ Extracted: "${extracted}"`;
                ruleTestPreview.style.color = "#2b6cb0";
            } else {
                ruleTestPreview.textContent = "✗ No match for this URL";
                ruleTestPreview.style.color = "#e53e3e";
            }
        } catch (err) {
            ruleTestPreview.textContent = `Error: ${err.message}`;
            ruleTestPreview.style.color = "#e53e3e";
        }
    }

    ruleTestUrlInput.addEventListener("input", updateLivePreview);
    rulePatternInput.addEventListener("input", updateLivePreview);
    ruleRegexInput.addEventListener("input", updateLivePreview);
    ruleReplacementInput.addEventListener("input", updateLivePreview);

    function openRuleForm(rule = null) {
        ruleListView.classList.remove("active");
        ruleFormView.classList.add("active");

        if (rule) {
            ruleFormTitle.textContent = "Edit Identifier Rule";
            ruleIdInput.value = rule.id;
            ruleNameInput.value = rule.name || "";
            rulePatternInput.value = rule.urlPattern || "";
            ruleRegexInput.value = rule.extractionRegex || "";
            ruleReplacementInput.value = rule.replacementTemplate || "";
            ruleTestUrlInput.value = "";
        } else {
            ruleFormTitle.textContent = "Add Identifier Rule";
            ruleIdInput.value = "";
            ruleNameInput.value = "";
            rulePatternInput.value = "";
            ruleRegexInput.value = "";
            ruleReplacementInput.value = "";
            ruleTestUrlInput.value = "";
        }
        updateLivePreview();
        ruleNameInput.focus();
    }

    function closeRuleForm() {
        ruleFormView.classList.remove("active");
        ruleListView.classList.add("active");
    }

    async function saveRuleForm() {
        const name = ruleNameInput.value.trim();
        const pattern = rulePatternInput.value.trim();
        const regexStr = ruleRegexInput.value.trim();
        const replacement = ruleReplacementInput.value.trim() || null;
        const id = ruleIdInput.value || null;

        if (!name || !pattern || !regexStr) {
            alert("Rule Name, URL Pattern, and Extraction Regex are required!");
            return;
        }

        try {
            await identifierRuleStore.saveRule({
                id,
                name,
                urlPattern: pattern,
                extractionRegex: regexStr,
                replacementTemplate: replacement
            });
            closeRuleForm();
            renderRuleList();
        } catch (err) {
            alert(`Error saving identifier rule: ${err.message}`);
        }
    }

    async function deleteRule(id) {
        if (confirm("Are you sure you want to delete this identifier rule?")) {
            const success = await identifierRuleStore.deleteRule(id);
            if (success) {
                renderRuleList();
            }
        }
    }

    ruleAddBtn.addEventListener("click", () => openRuleForm());
    ruleCancelBtn.addEventListener("click", closeRuleForm);
    ruleSaveBtn.addEventListener("click", saveRuleForm);

    identifierRuleStore.subscribe(() => {
        renderRuleList();
    });

    // --- Initial Load ---
    try {
        await Promise.all([
            searchEngineStore.load(),
            identifierRuleStore.load()
        ]);
        renderList();
        renderRuleList();
    } catch (err) {
        console.error("Failed to load stores:", err);
    }
});
