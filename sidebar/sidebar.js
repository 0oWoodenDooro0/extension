document.addEventListener('DOMContentLoaded', () => {
  // --- Views ---
  const tagsView = document.getElementById('tagsView');
  const itemsView = document.getElementById('itemsView');
  const addItemView = document.getElementById('addItemView');
  const manageTagsView = document.getElementById('manageTagsView');

  // --- Buttons ---
  const manageTagsButton = document.getElementById('manageTagsButton');
  const addItemButton = document.getElementById('addItemButton');
  const exportButton = document.getElementById('exportButton');
  const importButton = document.getElementById('importButton');
  const backButton = document.getElementById('backButton');
  const randomButton = document.getElementById('randomButton');
  const openAllButton = document.getElementById('openAllButton');
  const clearSearchButton = document.getElementById('clearSearchButton');
  const saveItemButton = document.getElementById('saveItemButton');
  const cancelButton = document.getElementById('cancelButton');
  const closeManageTagsButton = document.getElementById('closeManageTagsButton');
  const addNewTagButton = document.getElementById('addNewTagButton');

  // --- Other Elements ---
  const fileInput = document.getElementById('fileInput');
  const tagList = document.getElementById('tagList');
  const itemList = document.getElementById('itemList');
  const itemTitle = document.getElementById('itemTitle');
  const itemSearchInput = document.getElementById('itemSearchInput');
  const itemTitleInput = document.getElementById('itemTitleInput');
  const itemUrlInput = document.getElementById('itemUrlInput');
  const existingTagsContainer = document.getElementById('existingTagsContainer');
  const manageTagList = document.getElementById('manageTagList');
  const newTagInput = document.getElementById('newTagInput');
  const tagFilterContainer = document.getElementById('tagFilterContainer');

  // --- Global State ---
  let items = [];
  let tags = [];
  let currentTag = null;
  let isEditingFlow = false;
  let currentEditingItemId = null;
  let draggedTag = null;
  let activeFilters = []; // For multi-tag filtering

  // =================================================================
  //               EVENT LISTENERS
  // =================================================================

  manageTagsButton.addEventListener('click', showManageTagsView);
  addItemButton.addEventListener('click', () => showAddItemView());
  exportButton.addEventListener('click', exportData);
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', importData);
  backButton.addEventListener('click', () => {
    activeFilters = []; // Clear filters when going back
    displayTags();
  });
  randomButton.addEventListener('click', randomItem);
  openAllButton.addEventListener('click', openAllItems);
  itemSearchInput.addEventListener('input', () => displayItemsByTag(currentTag));
  clearSearchButton.addEventListener('click', () => {
    itemSearchInput.value = '';
    displayItemsByTag(currentTag);
  });
  saveItemButton.addEventListener('click', saveItem);
  cancelButton.addEventListener('click', hideAddItemView);
  addNewTagButton.addEventListener('click', addNewTag);
  closeManageTagsButton.addEventListener('click', hideManageTagsView);

  // =================================================================
  //               VIEW MANAGEMENT
  // =================================================================

  function showView(viewToShow) {
    [tagsView, itemsView, addItemView, manageTagsView].forEach(view => {
      view.style.display = view === viewToShow ? 'block' : 'none';
    });
  }

  function showAddItemView(itemId = null) {
    currentEditingItemId = itemId;
    isEditingFlow = !!itemId;

    const populateView = (title = '', url = '', selectedTags = []) => {
      itemTitleInput.value = title;
      itemUrlInput.value = url;
      populateTagSelector(selectedTags);
      showView(addItemView);
    };

    if (itemId) {
      const item = items.find(i => i.id === itemId);
      if (item) {
        populateView(item.title, item.url, item.tags);
      }
    } else {
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        const currentTab = tabs[0];
        if (currentTab) {
          const existingItem = items.find(i => i.url === currentTab.url);
          if (existingItem) {
            currentEditingItemId = existingItem.id;
            isEditingFlow = true;
            populateView(existingItem.title, existingItem.url, existingItem.tags);
          } else {
            populateView(currentTab.title, currentTab.url);
          }
        }
      });
    }
  }

  function hideAddItemView() {
    if (isEditingFlow) {
      displayItemsByTag(currentTag);
    } else {
      displayTags();
    }
  }

  function showManageTagsView() {
    populateManageTagList();
    showView(manageTagsView);
  }

  function hideManageTagsView() {
    displayTags();
  }

  // =================================================================
  //               DATA DISPLAY
  // =================================================================

  function displayTags() {
    currentTag = null;
    tagList.innerHTML = '';

    // Add "All Items" entry
    const allItemsCount = items.length;
    const allItemsLi = document.createElement('li');
    allItemsLi.className = 'listItem';
    allItemsLi.innerHTML = `<span>All Items (${allItemsCount})</span>`;
    allItemsLi.addEventListener('click', () => displayItemsByTag('All Items'));
    tagList.appendChild(allItemsLi);

    tags.forEach(tag => {
      const itemCount = items.filter(item => item.tags.includes(tag)).length;
      const listItem = document.createElement('li');
      listItem.className = 'listItem';
      listItem.innerHTML = `<span>${tag} (${itemCount})</span>`;
      listItem.addEventListener('click', () => displayItemsByTag(tag));
      tagList.appendChild(listItem);
    });
    showView(tagsView);
  }

  function displayItemsByTag(tag) {
    currentTag = tag;
    itemList.innerHTML = '';
    itemTitle.textContent = tag;

    let itemsToShow = [];

    if (tag === 'All Items') {
      populateTagFilterBar();
      tagFilterContainer.style.display = 'flex';

      // First, filter by active tags (intersection)
      if (activeFilters.length > 0) {
        itemsToShow = items.filter(item =>
          activeFilters.every(filterTag => item.tags.includes(filterTag))
        );
      } else {
        itemsToShow = [...items];
      }
    } else {
      tagFilterContainer.style.display = 'none';
      itemsToShow = items.filter(item => item.tags.includes(tag));
    }

    const searchTerm = itemSearchInput.value.toLowerCase();
    if (searchTerm) {
      itemsToShow = itemsToShow.filter(item =>
        item.title.toLowerCase().includes(searchTerm) ||
        item.url.toLowerCase().includes(searchTerm)
      );
    }

    itemsToShow.sort((a, b) => a.title.localeCompare(b.title));

    itemsToShow.forEach(item => {
      const listItem = document.createElement('li');
      listItem.className = 'listItem';
      listItem.id = `item-${item.id}`;
      listItem.innerHTML = `<span>${item.title}</span>`;

      listItem.addEventListener('click', () => browser.tabs.create({ url: item.url }));

      listItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, item.id);
      });

      itemList.appendChild(listItem);
    });

    showView(itemsView);
  }

  function populateTagFilterBar() {
    tagFilterContainer.innerHTML = '';
    tags.forEach(tag => {
      const button = document.createElement('button');
      button.className = 'tag-button';
      button.textContent = tag;
      if (activeFilters.includes(tag)) {
        button.classList.add('selected');
      }
      button.addEventListener('click', () => {
        if (activeFilters.includes(tag)) {
          activeFilters = activeFilters.filter(t => t !== tag);
        } else {
          activeFilters.push(tag);
        }
        displayItemsByTag('All Items');
      });
      tagFilterContainer.appendChild(button);
    });
  }

  function populateTagSelector(selectedTags = []) {
    existingTagsContainer.innerHTML = '';
    tags.forEach(tag => {
      const button = document.createElement('button');
      button.className = 'tag-button';
      button.textContent = tag;
      if (selectedTags.includes(tag)) {
        button.classList.add('selected');
      }
      button.addEventListener('click', () => {
        button.classList.toggle('selected');
      });
      existingTagsContainer.appendChild(button);
    });
  }

  function populateManageTagList() {
    manageTagList.innerHTML = '';
    tags.forEach((tag, index) => {
      const listItem = document.createElement('li');
      listItem.className = 'manage-tag-item';
      listItem.draggable = true;
      listItem.dataset.index = index;

      const handle = document.createElement('span');
      handle.className = 'drag-handle';

      const name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = tag;

      const actions = document.createElement('div');
      actions.className = 'tag-actions';

      const renameButton = document.createElement('button');
      renameButton.textContent = 'Rename';
      renameButton.addEventListener('click', () => renameTag(index));

      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteTag(index));

      actions.appendChild(renameButton);
      actions.appendChild(deleteButton);
      listItem.appendChild(handle);
      listItem.appendChild(name);
      listItem.appendChild(actions);

      listItem.addEventListener('dragstart', handleDragStart);
      listItem.addEventListener('dragover', handleDragOver);
      listItem.addEventListener('drop', handleDrop);
      listItem.addEventListener('dragend', handleDragEnd);

      manageTagList.appendChild(listItem);
    });
  }

  // =================================================================
  //               DATA MANIPULATION
  // =================================================================

  function saveItem() {
    const title = itemTitleInput.value.trim();
    const url = itemUrlInput.value.trim();
    const selectedTags = Array.from(existingTagsContainer.querySelectorAll('.tag-button.selected')).map(btn => btn.textContent);

    if (!title || !url) {
      alert('Title and URL cannot be empty.');
      return;
    }

    if (currentEditingItemId) {
      const itemIndex = items.findIndex(i => i.id === currentEditingItemId);
      if (itemIndex > -1) {
        items[itemIndex] = { ...items[itemIndex], title, url, tags: selectedTags };
      }
    } else {
      const newItem = {
        id: `item-${Date.now()}`,
        title,
        url,
        tags: selectedTags,
        addDate: Date.now()
      };
      items.push(newItem);
    }

    saveData().then(() => {
      hideAddItemView();
    });
  }

  function removeItem(itemId) {
    if (confirm('Are you sure you want to delete this item?')) {
      items = items.filter(item => item.id !== itemId);
      saveData().then(() => {
        displayItemsByTag(currentTag);
      });
    }
  }

  function addNewTag() {
    const newTagName = newTagInput.value.trim();
    if (newTagName && !tags.includes(newTagName)) {
      tags.push(newTagName);
      newTagInput.value = '';
      saveData().then(() => {
        populateManageTagList();
      });
    }
  }

  function renameTag(index) {
    const oldTagName = tags[index];
    const newTagName = prompt(`Rename tag "${oldTagName}":`, oldTagName);
    if (newTagName && newTagName.trim() !== oldTagName) {
      const finalNewName = newTagName.trim();
      if (tags.includes(finalNewName)) {
        alert(`Tag "${finalNewName}" already exists.`);
        return;
      }

      tags[index] = finalNewName;
      items.forEach(item => {
        const tagIndex = item.tags.indexOf(oldTagName);
        if (tagIndex > -1) {
          item.tags[tagIndex] = finalNewName;
        }
      });
      saveData().then(() => {
        populateManageTagList();
      });
    }
  }

  function deleteTag(index) {
    const tagName = tags[index];
    if (confirm(`Are you sure you want to delete the tag "${tagName}"? It will be removed from all items.`)) {
      tags.splice(index, 1);
      items.forEach(item => {
        item.tags = item.tags.filter(t => t !== tagName);
      });
      saveData().then(() => {
        populateManageTagList();
      });
    }
  }

  // =================================================================
  //               FEATURES & ACTIONS
  // =================================================================

  function randomItem() {
    if (!currentTag) return;

    const itemsInScope = (currentTag === 'All Items')
      ? items
      : items.filter(item => item.tags.includes(currentTag));

    if (itemsInScope.length === 0) return;

    const randomItem = itemsInScope[Math.floor(Math.random() * itemsInScope.length)];
    browser.tabs.create({ url: randomItem.url });

    const listItem = document.getElementById(`item-${randomItem.id}`);
    if (listItem) {
      listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      listItem.classList.add('highlighted');
      setTimeout(() => {
        listItem.classList.remove('highlighted');
      }, 2000);
    }
  }

  function openAllItems() {
    const searchTerm = itemSearchInput.value.toLowerCase();
    let itemsToOpen = [];

    let initialItems = (currentTag === 'All Items')
      ? items
      : items.filter(item => item.tags.includes(currentTag));

    if (currentTag === 'All Items' && activeFilters.length > 0) {
      initialItems = initialItems.filter(item =>
        activeFilters.every(filterTag => item.tags.includes(filterTag))
      );
    }

    if (searchTerm) {
      itemsToOpen = initialItems.filter(item =>
        item.title.toLowerCase().includes(searchTerm) ||
        item.url.toLowerCase().includes(searchTerm)
      );
    } else {
      itemsToOpen = initialItems;
    }

    if (itemsToOpen.length > 0 && confirm(`Are you sure you want to open ${itemsToOpen.length} tabs?`)) {
      itemsToOpen.forEach(item => {
        browser.tabs.create({ url: item.url });
      });
    }
  }

  function showContextMenu(x, y, itemId) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'customContextMenu';

    const editItem = document.createElement('div');
    editItem.className = 'context-menu-item';
    editItem.textContent = 'Edit';
    editItem.addEventListener('click', () => {
      closeContextMenu();
      showAddItemView(itemId);
    });

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', () => {
      closeContextMenu();
      removeItem(itemId);
    });

    menu.appendChild(editItem);
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);

    const menuHeight = menu.offsetHeight;
    const windowHeight = window.innerHeight;

    if (y + menuHeight > windowHeight) {
      menu.style.top = `${y - menuHeight}px`;
    } else {
      menu.style.top = `${y}px`;
    }
    menu.style.left = `${x}px`;

    document.addEventListener('click', closeContextMenu, { once: true });
  }

  function closeContextMenu() {
    const menu = document.getElementById('customContextMenu');
    if (menu) {
      menu.remove();
    }
  }

  // =================================================================
  //               DRAG & DROP FOR TAGS
  // =================================================================
  function handleDragStart(e) {
    draggedTag = e.target;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      draggedTag.classList.add('dragging');
    }, 0);
  }

  function handleDragEnd(e) {
    draggedTag.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }

  function handleDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.manage-tag-item');
    if (target && target !== draggedTag) {
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      target.classList.add('drag-over');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.manage-tag-item');
    if (target && target !== draggedTag) {
      const fromIndex = parseInt(draggedTag.dataset.index);
      const toIndex = parseInt(target.dataset.index);

      const [movedTag] = tags.splice(fromIndex, 1);
      tags.splice(toIndex, 0, movedTag);

      saveData().then(() => {
        populateManageTagList();
      });
    }
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }


  // =================================================================
  //               DATA STORAGE & MIGRATION
  // =================================================================

  function loadData() {
    browser.storage.local.get(['items', 'tags']).then(data => {
      items = data.items || [];
      tags = data.tags || [];
      displayTags();
    });
  }

  function saveData() {
    return browser.storage.local.set({ items, tags });
  }

  function exportData() {
    browser.storage.local.get(['items', 'tags']).then(data => {
      const dataToExport = {
        items: data.items || [],
        tags: data.tags || [],
      };
      const json = JSON.stringify(dataToExport, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const filename = `collections-backup-${new Date().toISOString().split('T')[0]}.json`;
      browser.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }).then(() => URL.revokeObjectURL(url), () => URL.revokeObjectURL(url));
    });
  }

  function importData(event) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedData = JSON.parse(e.target.result);
          if (importedData.items && importedData.tags) {
            if (confirm('This will overwrite your current data. Are you sure you want to import?')) {
              items = importedData.items;
              tags = importedData.tags;
              saveData().then(() => {
                alert('Import successful!');
                displayTags();
              });
            }
          } else {
            alert('Invalid import file. Make sure it contains "items" and "tags" lists.');
          }
        } catch (err) {
          alert('Error reading the import file.');
          console.error('Import Error:', err);
        }
      };
      reader.readAsText(file);
    }
  }

  // --- Initial Load ---
  loadData();
});

