document.addEventListener('DOMContentLoaded', () => {
  // Element Query
  const manageTagsButton = document.getElementById('manageTagsButton');
  const exportButton = document.getElementById('exportButton');
  const importButton = document.getElementById('importButton');
  const fileInput = document.getElementById('fileInput');
  const backButton = document.getElementById('backButton');
  const addItemButton = document.getElementById('addItemButton');
  const randomButton = document.getElementById('randomButton');
  const openAllButton = document.getElementById('openAllButton');
  const itemSearchInput = document.getElementById('itemSearchInput');
  const clearSearchButton = document.getElementById('clearSearchButton');

  const tagList = document.getElementById('tagList');
  const itemList = document.getElementById('itemList');
  const tagsView = document.getElementById('tagsView');
  const itemsView = document.getElementById('itemsView');

  // Add/Edit View Elements
  const addItemView = document.getElementById('addItemView');
  const itemTitleInput = document.getElementById('itemTitleInput');
  const itemUrlInput = document.getElementById('itemUrlInput');
  const existingTagsContainer = document.getElementById('existingTagsContainer');
  const saveItemButton = document.getElementById('saveItemButton');
  const cancelButton = document.getElementById('cancelButton');

  // Manage Tags View Elements
  const manageTagsView = document.getElementById('manageTagsView');
  const manageTagList = document.getElementById('manageTagList');
  const closeManageTagsButton = document.getElementById('closeManageTagsButton');
  const newTagInput = document.getElementById('newTagInput');
  const addNewTagButton = document.getElementById('addNewTagButton');

  // Global State
  let items = [];
  let tags = [];
  let currentTag = null;
  let editingItemId = null;
  let dragStartIndex;
  let isEditingFlow = false; // Flag to track if the action is an edit or a new add

  // --- Event Listeners ---
  backButton.addEventListener('click', displayTags);
  exportButton.addEventListener('click', exportData);
  importButton.addEventListener('click', () => fileInput.click());
  randomButton.addEventListener('click', randomItem);
  openAllButton.addEventListener('click', openAllItems);
  addItemButton.addEventListener('click', () => showAddItemView()); // No argument means new item
  saveItemButton.addEventListener('click', saveItem);
  cancelButton.addEventListener('click', hideAddItemView);
  manageTagsButton.addEventListener('click', showManageTagsView);
  closeManageTagsButton.addEventListener('click', hideManageTagsView);
  addNewTagButton.addEventListener('click', addNewTag);

  itemSearchInput.addEventListener('input', () => displayItemsByTag(currentTag));
  clearSearchButton.addEventListener('click', () => {
    itemSearchInput.value = '';
    displayItemsByTag(currentTag);
    itemSearchInput.focus();
  });

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedData = JSON.parse(e.target.result);
          // Check for new format with items and tags
          if (Array.isArray(importedData.items) && Array.isArray(importedData.tags)) {
            if (confirm("This will replace all your current data. Are you sure?")) {
              items = importedData.items;
              tags = importedData.tags;
              saveItems();
              saveTags();
              displayTags();
            }
          } else {
            alert("Invalid file format.");
          }
        } catch (err) {
          alert("Error reading file.");
          console.error('Import Error:', err);
        }
      };
      reader.readAsText(file);
    }
  });

  window.addEventListener('click', (event) => {
    const existingMenu = document.getElementById('customContextMenu');
    if (existingMenu && !existingMenu.contains(event.target)) {
      existingMenu.remove();
    }
  });

  // =================================================================
  //                       Data Handling
  // =================================================================

  function loadData() {
    browser.storage.local.get(['items', 'tags'], (data) => {
      items = data.items || [];
      tags = data.tags || [];
      displayTags();
    });
  }

  function saveItems() {
    browser.storage.local.set({ items: items });
  }

  function saveTags() {
    browser.storage.local.set({ tags: tags });
  }


  // =================================================================
  //                        UI Display Functions
  // =================================================================

  function displayTags() {
    tagsView.style.display = 'block';
    itemsView.style.display = 'none';
    addItemView.style.display = 'none';
    manageTagsView.style.display = 'none';
    tagList.innerHTML = '';
    currentTag = null;

    const tagMap = new Map();
    items.forEach(item => {
      if (Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
        });
      }
    });

    const allItemsLi = document.createElement('li');
    allItemsLi.className = 'listItem';
    allItemsLi.innerHTML = `<span>All Items (${items.length})</span>`;
    allItemsLi.addEventListener('click', () => displayItemsByTag(null));
    tagList.appendChild(allItemsLi);

    // Display tags in user-defined order
    tags.forEach(tag => {
      const count = tagMap.get(tag) || 0;
      const listItem = document.createElement('li');
      listItem.className = 'listItem';
      listItem.innerHTML = `<span>${tag} (${count})</span>`;
      listItem.addEventListener('click', () => displayItemsByTag(tag));
      tagList.appendChild(listItem);
    });
  }

  function getCurrentItems() {
    const itemsToFilter = currentTag ? items.filter(item => item.tags && item.tags.includes(currentTag)) : items;

    const searchTerm = itemSearchInput.value.toLowerCase();
    return searchTerm
      ? itemsToFilter.filter(item =>
        item.title.toLowerCase().includes(searchTerm) ||
        item.url.toLowerCase().includes(searchTerm)
      )
      : itemsToFilter;
  }

  function displayItemsByTag(tag) {
    currentTag = tag;
    tagsView.style.display = 'none';
    itemsView.style.display = 'block';
    addItemView.style.display = 'none';
    manageTagsView.style.display = 'none';
    itemList.innerHTML = '';

    const itemTitle = document.getElementById('itemTitle');
    itemTitle.innerText = tag || 'All Items';

    const itemsToShow = getCurrentItems();

    itemsToShow.forEach(item => {
      const listItem = document.createElement('li');
      listItem.className = 'listItem';
      listItem.innerHTML = `<span>${item.title}</span>`;

      listItem.addEventListener('click', () => {
        browser.tabs.create({ url: item.url });
      });

      listItem.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const existingMenu = document.getElementById('customContextMenu');
        if (existingMenu) existingMenu.remove();

        const contextMenu = document.createElement('div');
        contextMenu.id = 'customContextMenu';

        const editOption = document.createElement('div');
        editOption.className = 'context-menu-item';
        editOption.innerText = 'Edit';
        editOption.onclick = (e) => {
          e.stopPropagation();
          showAddItemView(item);
          contextMenu.remove();
        };

        const deleteOption = document.createElement('div');
        deleteOption.className = 'context-menu-item';
        deleteOption.innerText = 'Delete';
        deleteOption.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete "${item.title}"?`)) {
            removeItem(item.id);
          }
          contextMenu.remove();
        };
        contextMenu.appendChild(editOption);
        contextMenu.appendChild(deleteOption);

        // Append to body first to calculate its dimensions
        document.body.appendChild(contextMenu);

        const menuHeight = contextMenu.offsetHeight;
        const windowHeight = window.innerHeight;
        let topPosition = event.pageY;

        // If the menu would go off-screen, flip it to show above the cursor
        if (topPosition + menuHeight > windowHeight) {
          topPosition = event.pageY - menuHeight;
        }

        // Ensure it doesn't go above the top of the window
        if (topPosition < 0) {
          topPosition = 0;
        }

        contextMenu.style.top = `${topPosition}px`;
        contextMenu.style.left = `${event.pageX}px`;
      });

      itemList.appendChild(listItem);
    });
  }

  // =================================================================
  //                       Core Functionality
  // =================================================================

  function populateTagSelector(selectedTagArray = []) {
    existingTagsContainer.innerHTML = '';
    const selectedTags = new Set(selectedTagArray);

    tags.forEach(tag => {
      const tagButton = document.createElement('span');
      tagButton.className = 'tag-button';
      tagButton.textContent = tag;
      if (selectedTags.has(tag)) {
        tagButton.classList.add('selected');
      }
      tagButton.onclick = () => {
        tagButton.classList.toggle('selected');
      };
      existingTagsContainer.appendChild(tagButton);
    });
  }

  function showAddItemView(itemToEdit = null) {
    tagsView.style.display = 'none';
    itemsView.style.display = 'none';
    addItemView.style.display = 'block';
    manageTagsView.style.display = 'none';

    isEditingFlow = !!itemToEdit; // Set the flow flag

    if (isEditingFlow) {
      // Edit mode from context menu
      editingItemId = itemToEdit.id;
      itemTitleInput.value = itemToEdit.title;
      itemUrlInput.value = itemToEdit.url;
      populateTagSelector(itemToEdit.tags || []);
    } else {
      // Add mode: check current tab's URL
      editingItemId = null;
      itemTitleInput.value = 'Loading...';
      itemUrlInput.value = '';
      populateTagSelector([]); // Start with no tags selected

      browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0] || !tabs[0].url) {
          itemTitleInput.value = 'Could not get tab info.';
          return;
        }

        const currentUrl = tabs[0].url;
        const currentTitle = tabs[0].title || '';

        // Check if the URL already exists
        const existingItem = items.find(item => item.url === currentUrl);

        if (existingItem) {
          // URL exists, treat as an edit of that item
          editingItemId = existingItem.id;
          itemTitleInput.value = existingItem.title;
          itemUrlInput.value = existingItem.url;
          populateTagSelector(existingItem.tags || []);
        } else {
          // URL is new, populate with tab info
          itemTitleInput.value = currentTitle;
          itemUrlInput.value = currentUrl;
        }
      });
    }
  }

  function hideAddItemView() {
    // This function handles the "Cancel" button click.
    // If the user was editing, go back to the item list.
    // If the user's initial intent was to add, go back to the main tags list.
    if (isEditingFlow) {
      displayItemsByTag(currentTag);
    } else {
      displayTags();
    }
  }

  function saveItem() {
    const title = itemTitleInput.value.trim();
    const url = itemUrlInput.value.trim();

    if (!title || !url) {
      alert("Title and URL cannot be empty.");
      return;
    }

    const selectedTags = [];
    existingTagsContainer.querySelectorAll('.tag-button.selected').forEach(button => {
      selectedTags.push(button.textContent);
    });

    if (editingItemId) {
      // Update existing item
      const existingItem = items.find(item => item.id === editingItemId);
      if (existingItem) {
        existingItem.title = title;
        existingItem.url = url;
        existingItem.tags = selectedTags;
      }
    } else {
      // Add new item
      const newItem = {
        id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        title: title,
        url: url,
        tags: selectedTags,
        addDate: Date.now()
      };
      items.push(newItem);
    }

    saveItems();

    // After saving, decide where to go.
    // If editing, go back to the item list.
    // If adding, go back to the main tags list.
    if (isEditingFlow) {
      displayItemsByTag(currentTag);
    } else {
      displayTags();
    }
  }

  function removeItem(itemId) {
    items = items.filter(item => item.id !== itemId);
    saveItems();
    displayItemsByTag(currentTag);
  }

  // --- Manage Tags Functions ---

  function showManageTagsView() {
    tagsView.style.display = 'none';
    itemsView.style.display = 'none';
    addItemView.style.display = 'none';
    manageTagsView.style.display = 'block';
    newTagInput.value = '';

    manageTagList.innerHTML = '';

    tags.forEach((tag, index) => {
      const listItem = document.createElement('li');
      listItem.className = 'manage-tag-item';
      listItem.setAttribute('draggable', 'true');

      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';

      const tagName = document.createElement('span');
      tagName.className = 'tag-name';
      tagName.textContent = tag;

      const tagActions = document.createElement('div');
      tagActions.className = 'tag-actions';

      const renameButton = document.createElement('button');
      renameButton.textContent = 'Rename';
      renameButton.onclick = () => {
        const newTagName = prompt(`Enter new name for "${tag}":`, tag);
        if (newTagName && newTagName.trim() !== '' && newTagName.trim() !== tag) {
          renameTag(tag, newTagName.trim());
        }
      };

      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'Delete';
      deleteButton.onclick = () => {
        if (confirm(`Are you sure you want to delete the tag "${tag}"? This will remove the tag from all items.`)) {
          deleteTag(tag);
        }
      };

      // Drag and Drop event listeners
      listItem.addEventListener('dragstart', () => {
        dragStartIndex = index;
        setTimeout(() => listItem.classList.add('dragging'), 0);
      });
      listItem.addEventListener('dragend', () => listItem.classList.remove('dragging'));
      listItem.addEventListener('dragover', e => {
        e.preventDefault();
        listItem.classList.add('drag-over');
      });
      listItem.addEventListener('dragleave', () => listItem.classList.remove('drag-over'));
      listItem.addEventListener('drop', e => {
        e.preventDefault();
        listItem.classList.remove('drag-over');
        const dragEndIndex = index;

        const [reorderedItem] = tags.splice(dragStartIndex, 1);
        tags.splice(dragEndIndex, 0, reorderedItem);

        saveTags();
        showManageTagsView();
      });

      tagActions.appendChild(renameButton);
      tagActions.appendChild(deleteButton);
      listItem.appendChild(dragHandle);
      listItem.appendChild(tagName);
      listItem.appendChild(tagActions);
      manageTagList.appendChild(listItem);
    });
  }

  function hideManageTagsView() {
    displayTags();
  }

  function addNewTag() {
    const newTagName = newTagInput.value.trim();
    if (newTagName && !tags.includes(newTagName)) {
      tags.push(newTagName);
      saveTags();
      showManageTagsView(); // Refresh the view
    } else if (tags.includes(newTagName)) {
      alert("This tag already exists.");
    }
    newTagInput.value = '';
    newTagInput.focus();
  }

  function renameTag(oldTag, newTag) {
    if (tags.includes(newTag)) {
      alert("A tag with this name already exists.");
      return;
    }

    tags = tags.map(t => (t === oldTag ? newTag : t));
    items.forEach(item => {
      if (item.tags && item.tags.includes(oldTag)) {
        item.tags = item.tags.map(t => (t === oldTag ? newTag : t));
      }
    });
    saveTags();
    saveItems();
    showManageTagsView();
  }

  function deleteTag(tagToDelete) {
    tags = tags.filter(t => t !== tagToDelete);
    items.forEach(item => {
      if (item.tags) {
        item.tags = item.tags.filter(t => t !== tagToDelete);
      }
    });
    saveTags();
    saveItems();
    showManageTagsView();
  }

  // --- Other Functions ---

  function randomItem() {
    const itemsToChoose = getCurrentItems();
    if (itemsToChoose.length > 0) {
      const random = itemsToChoose[Math.floor(Math.random() * itemsToChoose.length)];
      itemSearchInput.value = random.title;
      displayItemsByTag(currentTag);
      browser.tabs.create({ url: random.url });
    }
  }

  function openAllItems() {
    const itemsToOpen = getCurrentItems();
    if (itemsToOpen.length > 0) {
      if (confirm(`Are you sure you want to open ${itemsToOpen.length} tabs?`)) {
        itemsToOpen.forEach(item => {
          browser.tabs.create({ url: item.url, active: false });
        });
      }
    }
  }

  function exportData() {
    if (items.length === 0 && tags.length === 0) {
      alert("No data to export.");
      return;
    }
    const dataToExport = {
      tags: tags,
      items: items
    };
    const json = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `backup-${new Date().toISOString().split('T')[0]}.json`;

    browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }).then(() => {
      URL.revokeObjectURL(url);
    }, (error) => {
      console.error("Download failed:", error);
      URL.revokeObjectURL(url);
    });
  }

  // Initial load
  loadData();
});

