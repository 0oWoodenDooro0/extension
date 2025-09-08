document.addEventListener('DOMContentLoaded', () => {
  const createCollectionButton = document.getElementById('createCollectionButton');
  createCollectionButton.onclick = createCollection;
  const exportCollectionButton = document.getElementById('exportCollectionButton');
  exportCollectionButton.onclick = exportCollections;
  const importCollectionButton = document.getElementById('importCollectionButton');
  importCollectionButton.onclick = importCollections;
  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          browser.storage.local.set({ collections: JSON.parse(e.target.result) }, () => {
            loadCollections();
          })
        } catch (e) {
          console.error('Error', e);
        }
      }
      reader.readAsText(file);
    }
  });
  const backToCollectionButton = document.getElementById('backToCollectionButton');
  backToCollectionButton.onclick = backToCollections;
  const addToCollectionButton = document.getElementById('addToCollectionButton');
  addToCollectionButton.onclick = addToCollection;
  const randomButton = document.getElementById('randomButton');
  randomButton.onclick = random;
  const openAllButton = document.getElementById('openAllButton');
  openAllButton.onclick = openAll;

  const itemSearchInput = document.getElementById('itemSearchInput');
  const clearSearchButton = document.getElementById('clearSearchButton');

  const collectionList = document.getElementById('collectionList');
  const itemList = document.getElementById('itemList');
  const collectionsDiv = document.getElementById('collections');
  const itemsDiv = document.getElementById('items');

  let collections = [];
  let currentCollectionIndex = -1;

  itemSearchInput.addEventListener('input', () => {
    displayCollectionItems();
  });

  clearSearchButton.addEventListener('click', () => {
    itemSearchInput.value = '';
    displayCollectionItems();
    itemSearchInput.focus();
  });

  window.addEventListener('click', () => {
    const existingMenu = document.getElementById('customContextMenu');
    if (existingMenu) {
      existingMenu.remove();
    }
  });

  function loadCollections() {
    browser.storage.local.get('collections', (data) => {
      collections = data.collections || [];
      displayCollections();
    });
  }

  function displayCollections() {
    collectionsDiv.style.display = 'block';
    itemsDiv.style.display = 'none';
    collectionList.innerHTML = '';
    for (let i = 0; i < collections.length; i++) {
      const listItem = document.createElement('li');
      const collectionText = document.createElement('span');
      collectionText.innerText = collections[i].title + `(${collections[i].items.length})`;
      listItem.className = "collectionItem";

      listItem.addEventListener('click', () => {
        currentCollectionIndex = i;
        itemSearchInput.value = '';
        displayCollectionItems();
      })

      listItem.appendChild(collectionText);

      const renameDiv = document.createElement('div');
      renameDiv.className = "rename-content";
      const renameInput = document.createElement('input');
      renameInput.className = "renameInput";
      renameInput.type = 'text';
      renameInput.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      renameInput.value = collections[i].title;
      const renameButton = document.createElement('button');
      renameButton.innerText = 'Save';
      renameButton.addEventListener('click', (event) => {
        event.stopPropagation();
        renameCollection(i);
      });
      renameDiv.appendChild(renameInput);
      renameDiv.appendChild(renameButton);

      listItem.appendChild(renameDiv);

      listItem.addEventListener('contextmenu', (event) => {
        event.preventDefault();

        const existingMenu = document.getElementById('customContextMenu');
        if (existingMenu) existingMenu.remove();

        const contextMenu = document.createElement('div');
        contextMenu.id = 'customContextMenu';
        contextMenu.style.top = `${event.pageY}px`;
        contextMenu.style.left = `${event.pageX}px`;

        const renameOption = document.createElement('div');
        renameOption.className = 'context-menu-item';
        renameOption.innerText = 'Rename';
        renameOption.onclick = (e) => {
          e.stopPropagation();
          showRenameInput(i);
          contextMenu.remove();
        };

        const deleteOption = document.createElement('div');
        deleteOption.className = 'context-menu-item';
        deleteOption.innerText = 'Delete';
        deleteOption.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure to Delete Collection "${collections[i].title}" ?`)) {
            deleteCollection(i);
          }
          contextMenu.remove();
        };

        contextMenu.appendChild(renameOption);
        contextMenu.appendChild(deleteOption);
        document.body.appendChild(contextMenu);
      });

      collectionList.appendChild(listItem);
    }
  }

  function displayCollectionItems() {
    collectionsDiv.style.display = 'none';
    itemsDiv.style.display = 'block';
    itemList.innerHTML = '';

    const currentItems = collections[currentCollectionIndex].items;
    const collectionTitle = document.getElementById('itemTitle');
    collectionTitle.innerText = collections[currentCollectionIndex].title;
    const searchTerm = itemSearchInput.value.toLowerCase();
    const searchedItems = currentItems.filter(item => item.title.toLowerCase().includes(searchTerm) || item.url.toLowerCase().includes(searchTerm));

    searchedItems.forEach(item => {
      const originalIndex = currentItems.indexOf(item);

      const listItem = document.createElement('li');
      const itemText = document.createElement('span')

      itemText.innerText = item.title
      listItem.className = "collectionItem"

      listItem.addEventListener('click', () => {
        browser.tabs.create({ url: item.url });
      });

      listItem.addEventListener('contextmenu', (event) => {
        event.preventDefault();

        const existingMenu = document.getElementById('customContextMenu');
        if (existingMenu) {
          existingMenu.remove();
        }

        const contextMenu = document.createElement('div');
        contextMenu.id = 'customContextMenu';
        contextMenu.style.top = `${event.pageY}px`;
        contextMenu.style.left = `${event.pageX}px`;

        const deleteOption = document.createElement('div');
        deleteOption.className = 'context-menu-item';
        deleteOption.innerText = 'Delete';
        deleteOption.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure delete Item "${item.title}" ?`)) {
            removeItem(originalIndex);
          }
          contextMenu.remove();
        };

        contextMenu.appendChild(deleteOption);
        document.body.appendChild(contextMenu);
      });

      listItem.appendChild(itemText)

      itemList.appendChild(listItem)
    });
  }

  function addToCollection() {
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab && !checkDuplicateItem(collections[currentCollectionIndex].items, currentTab.url)) {
        collections[currentCollectionIndex].items.push({ title: currentTab.title, url: currentTab.url });
        saveCollections();
        displayCollectionItems();
      }
    });
  }

  function checkDuplicateItem(items, url) {
    for (let key in items) {
      if (items[key].url === url) {
        return true;
      }
    }
    return false;
  }

  function backToCollections() {
    currentCollectionIndex = -1;
    displayCollections();
  }

  function showRenameInput(index) {
    // const renameDiv = collectionList.children[index].querySelector('.rename-content');
    // renameDiv.style.display = 'inline-block';
    // collectionList.children[index].children[0].innerText = "";
    const listItem = collectionList.children[index];
    if (!listItem) return;
    const renameDiv = listItem.querySelector('.rename-content')
    const textSpan = listItem.querySelector('.collectionItem > span')
    renameDiv.style.display = 'inline-block'
    textSpan.style.display = 'none';
    renameDiv.querySelector('.renameInput').focus();
  }

  function renameCollection(index) {
    const renameInput = collectionList.children[index].querySelector('.renameInput');
    collections[index].title = renameInput.value;
    saveCollections();
    displayCollections();
  }

  function deleteCollection(index) {
    collections.splice(index, 1);
    saveCollections();
    displayCollections();
  }

  function createCollection() {
    collections.push({ title: "New Collection", items: [] });
    saveCollections();
    displayCollections();
  }

  function removeItem(index) {
    const items = collections[currentCollectionIndex].items;
    items.splice(index, 1);
    saveCollections();
    displayCollectionItems();
  }

  function random() {
    const items = collections[currentCollectionIndex].items;
    if (items.length > 0) {
      const randomItem = items[Math.floor((Math.random() * items.length))];
      itemSearchInput.value = randomItem.title;
      displayCollectionItems();
      browser.tabs.create({ url: randomItem.url });
    }
  }

  function openAll() {
    const items = collections[currentCollectionIndex].items;
    if (items.length > 0) {
      if (confirm(`Are you sure open All ${items.length} tabs in the Collection "${collections[currentCollectionIndex].title}" ?`)) {
        items.forEach(item => {
          browser.tabs.create({ url: item.url });
        });
      }
    }
  }

  function exportCollections() {
    browser.storage.local.get('collections', (data) => {
      const collections = data.collections || {};
      const json = JSON.stringify(collections, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const filename = `collections-backup-${new Date().toDateString().replaceAll(' ', '_')}.json`;
      browser.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }).then(() => {
        URL.revokeObjectURL(url);
      })
    })
  }

  function importCollections() {
    const fileInput = document.getElementById('fileInput');
    fileInput.click();
  }

  function saveCollections() {
    browser.storage.local.set({ collections: collections });
  }

  loadCollections();
});
