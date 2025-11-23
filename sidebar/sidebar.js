document.addEventListener('DOMContentLoaded', () => {
  // --- Elements ---
  const tagsView = document.getElementById('tagsView');
  const itemsView = document.getElementById('itemsView');
  const addItemView = document.getElementById('addItemView');
  const manageTagsView = document.getElementById('manageTagsView');

  const manageTagsButton = document.getElementById('manageTagsButton');
  const addItemButton = document.getElementById('addItemButton');
  const exportButton = document.getElementById('exportButton');
  const importButton = document.getElementById('importButton');
  const fileInput = document.getElementById('fileInput');

  const backButton = document.getElementById('backButton');
  const randomButton = document.getElementById('randomButton');
  const openAllButton = document.getElementById('openAllButton');
  const itemSearchInput = document.getElementById('itemSearchInput');
  const clearSearchButton = document.getElementById('clearSearchButton');
  const tagFilterContainer = document.getElementById('tagFilterContainer');

  // Updated Elements for Actor Filter
  const actorFilterContainer = document.getElementById('actorFilterContainer');
  const actorFilterInput = document.getElementById('actorFilterInput');
  const actorFilterDatalist = document.getElementById('actorFilterDatalist');

  const saveItemButton = document.getElementById('saveItemButton');
  const cancelButton = document.getElementById('cancelButton');
  const deleteItemButton = document.getElementById('deleteItemButton');

  const closeManageTagsButton = document.getElementById('closeManageTagsButton');
  const addNewTagButton = document.getElementById('addNewTagButton');

  const tagList = document.getElementById('tagList');
  const itemList = document.getElementById('itemList');
  const itemTitle = document.getElementById('itemTitle');

  const itemTitleInput = document.getElementById('itemTitleInput');
  const itemUrlInput = document.getElementById('itemUrlInput');
  const itemImageUrlInput = document.getElementById('itemImageUrlInput');

  // New Elements for Actors (Add/Edit View)
  const itemActorInput = document.getElementById('itemActorInput');
  const addActorButton = document.getElementById('addActorButton');
  const selectedActorsContainer = document.getElementById('selectedActorsContainer');
  const actorSuggestions = document.getElementById('actorSuggestions');

  const existingTagsContainer = document.getElementById('existingTagsContainer');

  const newTagInput = document.getElementById('newTagInput');
  const manageTagList = document.getElementById('manageTagList');

  // --- Global State ---
  let items = [];
  let tags = [];
  let currentTag = null;
  let activeFilters = [];
  let currentActorFilter = "";
  let editingItemId = null;
  let isEditingFlow = false;
  let draggedTag = null;

  // State for editing item actors
  let currentEditingActors = [];

  // --- Event Listeners ---
  manageTagsButton.addEventListener('click', showManageTagsView);
  addItemButton.addEventListener('click', () => showAddItemView());
  exportButton.addEventListener('click', exportData);
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', importData);

  backButton.addEventListener('click', displayTags);
  randomButton.addEventListener('click', randomItem);
  openAllButton.addEventListener('click', openAllItems);
  itemSearchInput.addEventListener('input', () => displayItemsByTag(currentTag));
  clearSearchButton.addEventListener('click', () => {
    itemSearchInput.value = '';
    displayItemsByTag(currentTag);
  });

  // Listen to input changes on the filter box
  actorFilterInput.addEventListener('input', (e) => {
    currentActorFilter = e.target.value.trim();
    renderFilteredList();
  });

  addActorButton.addEventListener('click', handleAddActor);
  itemActorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddActor();
    }
  });

  saveItemButton.addEventListener('click', saveItem);
  cancelButton.addEventListener('click', hideAddItemView);
  deleteItemButton.addEventListener('click', deleteItemFromEditView);

  closeManageTagsButton.addEventListener('click', hideManageTagsView);
  addNewTagButton.addEventListener('click', addNewTag);


  // --- Data Handling ---
  function loadData() {
    browser.storage.local.get(['items', 'tags'], (data) => {
      items = data.items || [];
      tags = data.tags || [];
      displayTags();
    });
  }

  function saveData() {
    browser.storage.local.set({ items: items, tags: tags });
  }

  // --- View Management ---
  function showView(viewToShow) {
    [tagsView, itemsView, addItemView, manageTagsView].forEach(view => {
      view.style.display = view === viewToShow ? 'block' : 'none';
    });
  }

  function displayTags() {
    showView(tagsView);
    tagList.innerHTML = '';
    currentTag = null;
    activeFilters = [];

    const allItemsCount = items.length;
    const allItemsLi = createTagListItem("All Items", allItemsCount, () => displayItemsByTag("All Items"));
    tagList.appendChild(allItemsLi);

    const untaggedItemsCount = items.filter(item => !item.tags || item.tags.length === 0).length;
    if (untaggedItemsCount > 0) {
      const untaggedLi = createTagListItem("Untagged", untaggedItemsCount, () => displayItemsByTag("Untagged"));
      tagList.appendChild(untaggedLi);
    }

    tags.forEach(tag => {
      const count = items.filter(item => item.tags && item.tags.includes(tag)).length;
      const li = createTagListItem(tag, count, () => displayItemsByTag(tag));
      tagList.appendChild(li);
    });
  }

  function createTagListItem(tagName, count, onClick) {
    const listItem = document.createElement('li');
    listItem.className = "listItem";

    const tagText = document.createElement('span');
    tagText.innerText = `${tagName} (${count})`;
    tagText.style.fontWeight = '500';

    listItem.appendChild(tagText);
    listItem.addEventListener('click', onClick);
    return listItem;
  }

  function displayItemsByTag(tag) {
    currentTag = tag;
    showView(itemsView);

    itemTitle.innerText = tag;

    // Reset actor filter when switching tags
    if (tag !== currentTag) {
      currentActorFilter = "";
      actorFilterInput.value = "";
    }

    if (tag === "All Items") {
      tagFilterContainer.style.display = 'flex';
      populateTagFilterBar();
      actorFilterContainer.style.display = 'block';
      populateActorFilterOptions();
    } else {
      tagFilterContainer.style.display = 'none';
      activeFilters = [];
      actorFilterContainer.style.display = 'none';
      currentActorFilter = "";
      actorFilterInput.value = "";
    }

    renderFilteredList();
  }

  function populateActorFilterOptions() {
    const allActorsSet = new Set();
    items.forEach(item => {
      if (item.actors && Array.isArray(item.actors)) {
        item.actors.forEach(a => allActorsSet.add(a));
      }
    });

    const allActors = [...allActorsSet].sort();

    actorFilterDatalist.innerHTML = ''; // Clear existing options

    allActors.forEach(actor => {
      const option = document.createElement('option');
      option.value = actor;
      actorFilterDatalist.appendChild(option);
    });
  }

  function renderFilteredList() {
    let itemsToDisplay = getFilteredItems();
    itemsToDisplay.sort((a, b) => a.addDate - b.addDate);

    itemList.innerHTML = '';
    itemsToDisplay.forEach(item => {
      const listItem = document.createElement('li');
      listItem.className = "listItem";
      listItem.id = `item-${item.id}`;

      const textContainer = document.createElement('div');

      const itemTitleSpan = document.createElement('span');
      itemTitleSpan.className = 'item-title';
      itemTitleSpan.innerText = item.title;
      textContainer.appendChild(itemTitleSpan);

      const actors = item.actors || [];
      if (actors.length > 0) {
        const itemActorSpan = document.createElement('span');
        itemActorSpan.className = 'item-actor';
        itemActorSpan.innerText = `Actors: ${actors.join(', ')}`;
        textContainer.appendChild(itemActorSpan);
      }

      listItem.appendChild(textContainer);

      if (item.imageUrl) {
        const itemImage = document.createElement('img');
        itemImage.className = 'item-image';
        itemImage.src = item.imageUrl;
        itemImage.onerror = (e) => { e.target.style.display = 'none'; };
        listItem.appendChild(itemImage);
      }

      listItem.addEventListener('click', () => {
        browser.tabs.create({ url: item.url });
      });

      listItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        removeCustomContextMenu();
        const menu = createCustomContextMenu(item.id);
        document.body.appendChild(menu);

        const menuHeight = menu.offsetHeight;
        const windowHeight = window.innerHeight;
        if (e.clientY + menuHeight > windowHeight) {
          menu.style.top = `${e.clientY - menuHeight}px`;
        } else {
          menu.style.top = `${e.clientY}px`;
        }
        menu.style.left = `${e.clientX}px`;
      });
      itemList.appendChild(listItem);
    });
  }

  function populateTagFilterBar() {
    tagFilterContainer.innerHTML = '';
    tags.forEach(tag => {
      const button = document.createElement('button');
      button.className = 'tag-button';
      button.innerText = tag;
      if (activeFilters.includes(tag)) {
        button.classList.add('selected');
      }
      button.addEventListener('click', () => {
        if (activeFilters.includes(tag)) {
          activeFilters = activeFilters.filter(f => f !== tag);
        } else {
          activeFilters.push(tag);
        }
        displayItemsByTag(currentTag);
      });
      tagFilterContainer.appendChild(button);
    });
  }

  function removeCustomContextMenu() {
    const existingMenu = document.getElementById('customContextMenu');
    if (existingMenu) {
      existingMenu.remove();
    }
  }

  document.addEventListener('click', removeCustomContextMenu);

  function createCustomContextMenu(itemId) {
    const menu = document.createElement('div');
    menu.id = 'customContextMenu';

    const editItem = document.createElement('div');
    editItem.className = 'context-menu-item';
    editItem.innerText = 'Edit';
    editItem.addEventListener('click', () => {
      showAddItemView(itemId);
    });

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item';
    deleteItem.innerText = 'Delete';
    deleteItem.addEventListener('click', () => {
      if (confirm("Are you sure you want to delete this item?")) {
        const itemIndex = items.findIndex(i => i.id === itemId);
        if (itemIndex > -1) {
          items.splice(itemIndex, 1);
          saveData();
          displayItemsByTag(currentTag);
        }
      }
    });

    menu.appendChild(editItem);
    menu.appendChild(deleteItem);
    return menu;
  }


  // --- Add/Edit Item View Logic ---
  function showAddItemView(itemId = null) {
    showView(addItemView);
    let itemToEdit = null;

    itemTitleInput.value = '';
    itemUrlInput.value = '';
    itemImageUrlInput.value = '';
    itemActorInput.value = '';
    currentEditingActors = [];

    populateActorSuggestions();

    if (itemId) {
      itemToEdit = items.find(i => i.id === itemId);
      if (!itemToEdit) return;

      isEditingFlow = true;
      editingItemId = itemId;
      itemTitleInput.value = itemToEdit.title;
      itemUrlInput.value = itemToEdit.url;
      itemImageUrlInput.value = itemToEdit.imageUrl || '';

      // Load existing actors (Direct array assignment)
      currentEditingActors = itemToEdit.actors ? [...itemToEdit.actors] : [];

      deleteItemButton.style.display = 'block';

      populateTagSelector(itemToEdit.tags || []);

      if (!itemToEdit.imageUrl && itemToEdit.url) {
        browser.runtime.sendMessage({ action: 'getImage', url: itemToEdit.url })
          .then(response => {
            if (response && response.imageUrl) {
              itemImageUrlInput.value = response.imageUrl;
              const itemIndex = items.findIndex(i => i.id === itemId);
              if (itemIndex !== -1) {
                items[itemIndex].imageUrl = response.imageUrl;
                saveData();
              }
            }
          })
          .catch(error => console.error("Error fetching image:", error));
      }

    } else {
      isEditingFlow = false;
      editingItemId = null;
      deleteItemButton.style.display = 'none';
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        const currentTab = tabs[0];
        if (!currentTab) return;

        itemTitleInput.value = currentTab.title;
        itemUrlInput.value = currentTab.url;

        const existingItem = items.find(i => i.url === currentTab.url);
        if (existingItem) {
          populateTagSelector(existingItem.tags || []);
          itemImageUrlInput.value = existingItem.imageUrl || '';
          currentEditingActors = existingItem.actors ? [...existingItem.actors] : [];
        } else {
          populateTagSelector([]);
          currentEditingActors = [];
        }

        renderActorChips();

        browser.runtime.sendMessage({ action: 'getImage', url: currentTab.url }).then(response => {
          if (response && response.imageUrl) {
            itemImageUrlInput.value = response.imageUrl;
          }
        }).catch(error => console.error("Error:", error));
      });
    }

    renderActorChips();
  }

  function handleAddActor() {
    const val = itemActorInput.value.trim();
    if (val) {
      const names = val.split(',').map(s => s.trim()).filter(s => s);
      names.forEach(name => {
        if (!currentEditingActors.includes(name)) {
          currentEditingActors.push(name);
        }
      });
      itemActorInput.value = '';
      renderActorChips();
    }
  }

  function renderActorChips() {
    selectedActorsContainer.innerHTML = '';
    currentEditingActors.forEach(actor => {
      const chip = document.createElement('span');
      chip.className = 'actor-chip';

      const nameSpan = document.createElement('span');
      nameSpan.innerText = actor;

      const removeBtn = document.createElement('span');
      removeBtn.className = 'remove-actor';
      removeBtn.innerText = '×';
      removeBtn.title = 'Remove actor';
      removeBtn.addEventListener('click', () => {
        currentEditingActors = currentEditingActors.filter(a => a !== actor);
        renderActorChips();
      });

      chip.appendChild(nameSpan);
      chip.appendChild(removeBtn);
      selectedActorsContainer.appendChild(chip);
    });
  }

  function populateActorSuggestions() {
    if (!actorSuggestions) return;
    actorSuggestions.innerHTML = '';
    const allActorsSet = new Set();
    items.forEach(item => {
      if (item.actors) item.actors.forEach(a => allActorsSet.add(a));
    });
    const allActors = [...allActorsSet].sort();

    allActors.forEach(actor => {
      const option = document.createElement('option');
      option.value = actor;
      actorSuggestions.appendChild(option);
    });
  }

  function populateTagSelector(selectedTags) {
    existingTagsContainer.innerHTML = '';
    tags.forEach(tag => {
      const button = document.createElement('button');
      button.className = 'tag-button';
      button.innerText = tag;
      button.dataset.tag = tag;
      if (selectedTags.includes(tag)) {
        button.classList.add('selected');
      }
      button.addEventListener('click', () => {
        button.classList.toggle('selected');
      });
      existingTagsContainer.appendChild(button);
    });
  }

  function hideAddItemView() {
    if (isEditingFlow) {
      displayItemsByTag(currentTag);
    } else {
      displayTags();
    }
  }

  function saveItem() {
    const title = itemTitleInput.value.trim();
    const url = itemUrlInput.value.trim();
    const imageUrl = itemImageUrlInput.value.trim();

    const actors = currentEditingActors;

    if (!title || !url) return;

    const selectedTags = Array.from(existingTagsContainer.querySelectorAll('.tag-button.selected'))
      .map(btn => btn.dataset.tag);

    let existingItem = editingItemId ? items.find(i => i.id === editingItemId) : items.find(i => i.url === url);

    if (existingItem) {
      existingItem.title = title;
      existingItem.url = url;
      existingItem.tags = selectedTags;
      existingItem.imageUrl = imageUrl || null;
      existingItem.actors = actors;
    } else {
      const newItem = {
        id: `item-${Date.now()}`,
        title,
        url,
        tags: selectedTags,
        addDate: Date.now(),
        imageUrl: imageUrl || null,
        actors: actors
      };
      items.push(newItem);
    }

    editingItemId = null;
    saveData();
    hideAddItemView();
  }

  function deleteItemFromEditView() {
    if (!editingItemId) return;
    if (confirm("Are you sure you want to delete this item?")) {
      const itemIndex = items.findIndex(i => i.id === editingItemId);
      if (itemIndex > -1) {
        items.splice(itemIndex, 1);
        saveData();
        editingItemId = null;
        hideAddItemView();
      }
    }
  }

  // --- Manage Tags View Logic ---
  function showManageTagsView() {
    showView(manageTagsView);
    displayManageTagList();
  }

  function hideManageTagsView() {
    displayTags();
  }

  function displayManageTagList() {
    manageTagList.innerHTML = '';
    tags.forEach(tag => {
      const li = document.createElement('li');
      li.className = 'manage-tag-item';
      li.dataset.tag = tag;
      li.draggable = true;

      li.addEventListener('dragstart', handleDragStart);
      li.addEventListener('dragover', handleDragOver);
      li.addEventListener('drop', handleDrop);
      li.addEventListener('dragend', handleDragEnd);

      const handle = document.createElement('span');
      handle.className = 'drag-handle';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tag-name';
      nameSpan.innerText = tag;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'tag-actions';

      const renameButton = document.createElement('button');
      renameButton.innerText = 'Rename';
      renameButton.addEventListener('click', () => promptRenameTag(tag, nameSpan));

      const deleteButton = document.createElement('button');
      deleteButton.innerText = 'Delete';
      deleteButton.addEventListener('click', () => deleteTag(tag));

      actionsDiv.appendChild(renameButton);
      actionsDiv.appendChild(deleteButton);

      li.appendChild(handle);
      li.appendChild(nameSpan);
      li.appendChild(actionsDiv);
      manageTagList.appendChild(li);
    });
  }

  function addNewTag() {
    const newTagName = newTagInput.value.trim();
    if (newTagName && !tags.includes(newTagName)) {
      tags.push(newTagName);
      saveData();
      displayManageTagList();
      newTagInput.value = '';
    }
  }

  function promptRenameTag(oldTag, nameSpan) {
    const newTagName = prompt(`Rename tag "${oldTag}" to:`, oldTag);
    if (newTagName && newTagName.trim() !== oldTag) {
      renameTag(oldTag, newTagName.trim());
    }
  }

  function renameTag(oldTag, newTag) {
    if (tags.includes(newTag)) {
      alert(`Tag "${newTag}" already exists.`);
      return;
    }
    const tagIndex = tags.indexOf(oldTag);
    if (tagIndex > -1) {
      tags[tagIndex] = newTag;
    }
    items.forEach(item => {
      if (item.tags && item.tags.includes(oldTag)) {
        const itemTagIndex = item.tags.indexOf(oldTag);
        item.tags[itemTagIndex] = newTag;
      }
    });
    saveData();
    displayManageTagList();
  }

  function deleteTag(tagToDelete) {
    if (confirm(`Are you sure you want to delete the tag "${tagToDelete}"? This will remove the tag from all items.`)) {
      tags = tags.filter(tag => tag !== tagToDelete);
      items.forEach(item => {
        if (item.tags) {
          item.tags = item.tags.filter(tag => tag !== tagToDelete);
        }
      });
      saveData();
      displayManageTagList();
    }
  }

  function handleDragStart(e) {
    draggedTag = e.target.dataset.tag;
    e.target.classList.add('dragging');
  }

  function handleDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.manage-tag-item');
    if (target && target.dataset.tag !== draggedTag) {
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      target.classList.add('drag-over');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.manage-tag-item');
    if (target && target.dataset.tag !== draggedTag) {
      const fromIndex = tags.indexOf(draggedTag);
      const toIndex = tags.indexOf(target.dataset.tag);

      const [movedTag] = tags.splice(fromIndex, 1);
      tags.splice(toIndex, 0, movedTag);

      saveData();
      displayManageTagList();
    }
  }

  function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedTag = null;
  }


  // --- General Utility ---
  function openAllItems() {
    const itemsToOpen = getFilteredItems();
    if (itemsToOpen.length > 0) {
      if (confirm(`Open ${itemsToOpen.length} tabs?`)) {
        itemSearchInput.value = '';
        itemsToOpen.forEach(item => {
          browser.tabs.create({ url: item.url, active: false });
        });
        displayItemsByTag(currentTag);
      }
    }
  }

  function randomItem() {
    const itemsToChooseFrom = getFilteredItems();
    if (itemsToChooseFrom.length > 0) {
      const randomItem = itemsToChooseFrom[Math.floor(Math.random() * itemsToChooseFrom.length)];
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
  }

  function getFilteredItems() {
    let filtered = items;
    if (currentTag === "Untagged") {
      filtered = items.filter(item => !item.tags || item.tags.length === 0);
    } else if (currentTag !== "All Items") {
      filtered = items.filter(item => item.tags && item.tags.includes(currentTag));
    }

    if (activeFilters.length > 0) {
      filtered = filtered.filter(item =>
        activeFilters.every(filterTag => item.tags && item.tags.includes(filterTag))
      );
    }

    if (currentTag === "All Items" && currentActorFilter) {
      filtered = filtered.filter(item => {
        const actors = item.actors || [];
        return actors.includes(currentActorFilter);
      });
    }

    const searchTerm = itemSearchInput.value.toLowerCase();
    if (searchTerm) {
      filtered = filtered.filter(item => {
        const titleMatch = item.title.toLowerCase().includes(searchTerm);
        const urlMatch = item.url.toLowerCase().includes(searchTerm);
        const actors = item.actors || [];
        const actorMatch = actors.some(a => a.toLowerCase().includes(searchTerm));

        return titleMatch || urlMatch || actorMatch;
      });
    }
    return filtered;
  }

  function exportData() {
    browser.storage.local.get(['items', 'tags'], (data) => {
      const dataToExport = {
        items: data.items || [],
        tags: data.tags || []
      };
      const json = JSON.stringify(dataToExport, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const filename = `collection_backup_${new Date().toISOString().split('T')[0]}.json`;

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
            if (confirm("This will overwrite your current collections. Are you sure?")) {
              items = importedData.items;
              tags = importedData.tags;
              saveData();
              displayTags();
            }
          } else {
            alert("Invalid file format.");
          }
        } catch (err) {
          alert("Error reading file.");
          console.error("Import error:", err);
        }
      };
      reader.readAsText(file);
    }
    fileInput.value = '';
  }

  // --- Initial Load ---
  loadData();
});
