document.addEventListener("DOMContentLoaded", async () => {
    let searchEngines = [];

    // UI Elements
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

    // Buttons
    const addBtn = document.getElementById("addBtn");
    const cancelBtn = document.getElementById("cancelBtn");
    const saveBtn = document.getElementById("saveBtn");

    // Load and Initialize Settings
    async function loadSettings() {
        const data = await browser.storage.local.get("searchEngines");
        if (data.searchEngines) {
            searchEngines = data.searchEngines;
        } else {
            searchEngines = [];
            await browser.storage.local.set({ searchEngines });
        }
        renderList();
    }

    // Render Search Shortcut Cards
    function renderList() {
        shortcutsList.innerHTML = "";
        
        if (searchEngines.length === 0) {
            emptyState.style.display = "block";
            return;
        }
        emptyState.style.display = "none";

        searchEngines.forEach((engine) => {
            const card = document.createElement("li");
            card.className = "shortcut-card";

            const info = document.createElement("div");
            info.className = "shortcut-info";

            const title = document.createElement("div");
            title.className = "shortcut-title";
            title.textContent = engine.title;

            const url = document.createElement("div");
            url.className = "shortcut-meta";
            url.textContent = engine.urlTemplate;

            info.appendChild(title);
            info.appendChild(url);

            if (engine.queryRegex) {
                const regexMeta = document.createElement("div");
                regexMeta.className = "shortcut-regex";
                regexMeta.textContent = `Regex: /${engine.queryRegex}/ → ${engine.queryReplacement}`;
                info.appendChild(regexMeta);
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

    // View Swappers
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
        } else {
            formTitle.textContent = "Add Search Shortcut";
            engineIdInput.value = "";
            engineTitleInput.value = "";
            engineUrlInput.value = "";
            engineRegexInput.value = "";
            engineReplacementInput.value = "";
        }
        engineTitleInput.focus();
    }

    function closeForm() {
        formView.classList.remove("active");
        listView.classList.add("active");
    }

    // Form Save Actions
    async function saveForm() {
        const title = engineTitleInput.value.trim();
        const url = engineUrlInput.value.trim();
        const id = engineIdInput.value;

        if (!title || !url) {
            alert("Title and URL Template are required!");
            return;
        }

        const regex = engineRegexInput.value.trim() || null;
        const replacement = engineReplacementInput.value.trim() || null;

        if (id) {
            // Edit existing engine
            const index = searchEngines.findIndex((e) => e.id === id);
            if (index !== -1) {
                searchEngines[index] = { id, title, urlTemplate: url, queryRegex: regex, queryReplacement: replacement };
            }
        } else {
            // Add new engine
            const newId = `engine-${Date.now()}`;
            searchEngines.push({ id: newId, title, urlTemplate: url, queryRegex: regex, queryReplacement: replacement });
        }

        await browser.storage.local.set({ searchEngines });
        closeForm();
        renderList();
    }

    // Delete Shortcut Engine
    async function deleteEngine(id) {
        if (confirm("Are you sure you want to delete this search shortcut?")) {
            searchEngines = searchEngines.filter((e) => e.id !== id);
            await browser.storage.local.set({ searchEngines });
            renderList();
        }
    }

    // Event Listeners
    addBtn.addEventListener("click", () => openForm());
    cancelBtn.addEventListener("click", closeForm);
    saveBtn.addEventListener("click", saveForm);

    // Initial Load
    await loadSettings();
});
