document.addEventListener('DOMContentLoaded', () => {
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

  const addItemView = document.getElementById('addItemView');
  const itemTitleInput = document.getElementById('itemTitleInput');
  const itemUrlInput = document.getElementById('itemUrlInput');
  const itemTagsInput = document.getElementById('itemTagsInput');
  const existingTagsContainer = document.getElementById('existingTagsContainer');
  const saveItemButton = document.getElementById('saveItemButton');
  const cancelButton = document.getElementById('cancelButton');

  const manageTagsView = document.getElementById('manageTagsView');
  const manageTagList = document.getElementById('manageTagList');
  const closeManageTagsButton = document.getElementById('closeManageTagsButton');

  let items = [];
  let currentTag = null;

  // =================================================================
  //                       Event Handling
  // =================================================================

  backButton.onclick = displayTags;
  exportButton.onclick = exportData;
  importButton.onclick = () => fileInput.click();
  randomButton.onclick = randomItem;
  openAllButton.onclick = openAllItems;
  addItemButton.onclick = showAddItemView;
  saveItemButton.onclick = saveItem;
  cancelButton.onclick = hideAddItemView;
  manageTagsButton.onclick = showManageTagsView;
  // closeManageTagsButton.onclick = hideManageTagsView;
  closeManageTagsButton.addEventListener('click', hideManageTagsView);

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
          const importedItems = JSON.parse(e.target.result);
          if (Array.isArray(importedItems)) {
            if (confirm("This will replace all your current items. Are you sure?")) {
              items = importedItems;
              saveData();
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

  window.addEventListener('click', () => {
    const existingMenu = document.getElementById('customContextMenu');
    if (existingMenu) existingMenu.remove();
  });

  // =================================================================
  //                       Data Handling
  // =================================================================

  function loadData() {
    browser.storage.local.get('items', (data) => {
      items = data.items || [];
      displayTags();
    });
  }

  function saveData() {
    browser.storage.local.set({ items: items });
  }

  function getAllTags() {
    return [...new Set(items.flatMap(item => item.tags || []))].sort((a, b) => a.localeCompare(b[0]));
  }

  // =================================================================
  //                       UI Display 
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

    const sortedTags = [...tagMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const allItemsLi = document.createElement('li');
    allItemsLi.className = 'listItem';
    allItemsLi.innerHTML = `<span>All Items (${items.length})</span>`;
    allItemsLi.onclick = () => displayItemsByTag(null);
    tagList.appendChild(allItemsLi);

    sortedTags.forEach(([tag, count]) => {
      const listItem = document.createElement('li');
      listItem.className = 'listItem';
      listItem.innerHTML = `<span>${tag} (${count})</span>`;
      listItem.onclick = () => displayItemsByTag(tag);
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
        const existingMenu = document.getElementById('customContextMenu');
        if (existingMenu) existingMenu.remove();

        const contextMenu = document.createElement('div');
        contextMenu.id = 'customContextMenu';
        contextMenu.style.top = `${event.pageY}px`;
        contextMenu.style.left = `${event.pageX}px`;

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
        contextMenu.appendChild(deleteOption);
        document.body.appendChild(contextMenu);
      });

      itemList.appendChild(listItem);
    });
  }

  // =================================================================
  //                       Core Function
  // =================================================================

  function showAddItemView() {
    tagsView.style.display = 'none';
    itemsView.style.display = 'none';
    addItemView.style.display = 'block';

    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        itemTitleInput.value = tabs[0].title || '';
        itemUrlInput.value = tabs[0].url || '';
      }
    });

    itemTagsInput.value = '';
    existingTagsContainer.innerHTML = '';
    const allTags = [...new Set(items.flatMap(item => item.tags || []))].sort();

    allTags.forEach(tag => {
      const tagButton = document.createElement('span');
      tagButton.className = 'tag-button';
      tagButton.textContent = tag;
      tagButton.onclick = () => {
        const currentTags = new Set(itemTagsInput.value.split(',').map(t => t.trim()).filter(Boolean));
        if (currentTags.has(tag)) {
          currentTags.delete(tag);
          tagButton.classList.remove('selected');
        } else {
          currentTags.add(tag);
          tagButton.classList.add('selected');
        }
        itemTagsInput.value = [...currentTags].join(', ');
      };
      existingTagsContainer.appendChild(tagButton);
    });
  }

  function hideAddItemView() {
    addItemView.style.display = 'none';
    displayTags();
  }

  function saveItem() {
    const title = itemTitleInput.value.trim();
    const url = itemUrlInput.value.trim();

    if (!title || !url) {
      alert("Title and URL cannot be empty.");
      return;
    }

    const tags = [...new Set(itemTagsInput.value.split(',').map(t => t.trim()).filter(Boolean))];

    const existingItemIndex = items.findIndex(item => item.url === url);

    if (existingItemIndex > -1) {
      items[existingItemIndex].title = title;
      items[existingItemIndex].tags = tags;
    } else {
      const newItem = {
        id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        title: title,
        url: url,
        tags: tags,
        addDate: Date.now()
      };
      items.push(newItem);
    }

    saveData();
    hideAddItemView();
  }

  function removeItem(itemId) {
    items = items.filter(item => item.id !== itemId);
    saveData();
    displayItemsByTag(currentTag);
  }

  function showManageTagsView() {
    tagsView.style.display = 'none';
    itemsView.style.display = 'none';
    addItemView.style.display = 'none';
    manageTagsView.style.display = 'block';

    manageTagList.innerHTML = '';
    const allTags = getAllTags();

    allTags.forEach(tag => {
      const listItem = document.createElement('li');
      listItem.className = 'manage-tag-item';

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
        if (confirm(`Are you sure you want to delete the tag "${tag}" from all items?`)) {
          deleteTag(tag);
        }
      };

      tagActions.appendChild(renameButton);
      tagActions.appendChild(deleteButton);
      listItem.appendChild(tagName);
      listItem.appendChild(tagActions);
      manageTagList.appendChild(listItem);
    });
  }

  function hideManageTagsView() {
    displayTags();
  }

  function renameTag(oldTag, newTag) {
    items.forEach(item => {
      if (item.tags && item.tags.includes(oldTag)) {
        item.tags = item.tags.filter(t => t !== oldTag);
        if (!item.tags.includes(newTag)) {
          item.tags.push(newTag);
        }
      }
    });
    saveData();
    showManageTagsView();
  }

  function deleteTag(tagToDelete) {
    items.forEach(item => {
      if (item.tags) {
        item.tags = item.tags.filter(t => t !== tagToDelete);
      }
    });
    saveData();
    showManageTagsView();
  }

  function randomItem() {
    const items = getCurrentItems();
    if (items.length > 0) {
      const random = items[Math.floor(Math.random() * items.length)];
      itemSearchInput.value = random.title;
      displayItemsByTag(currentTag);
      browser.tabs.create({ url: random.url });
    }
  }

  function openAllItems() {
    const items = getCurrentItems();
    if (items.length > 0) {
      if (confirm(`Are you sure you want to open ${items.length} tabs?`)) {
        items.forEach(item => {
          browser.tabs.create({ url: item.url, active: false });
        });
      }
    }
  }

  function exportData() {
    if (items.length === 0) {
      alert("No items to export.");
      return;
    }
    const json = JSON.stringify(items, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `items-backup-${new Date().toISOString().split('T')[0]}.json`;

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

  loadData();
});
