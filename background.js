import { addSearchShortcut, redirectUrl } from './utils.js'

addSearchShortcut();

redirectUrl();

// 監聽快捷鍵指令
browser.commands.onCommand.addListener(async (command) => {
  if (command === "add-current-tab") {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true
      });
      const currentTab = tabs[0];

      if (!currentTab) return;

      const data = await browser.storage.local.get(['items']);
      let items = data.items || [];

      // 檢查是否已經存在 (避免重複)
      const existingItem = items.find(i => i.url === currentTab.url);

      if (existingItem) {
        console.log("Item already exists:", currentTab.title);
        return;
      }

      const newItem = {
        id: `item-${Date.now()}`,
        title: currentTab.title,
        url: currentTab.url,
        tags: [],
        actors: [],
        addDate: Date.now(),
        imageUrl: null
      };

      items.push(newItem);
      await browser.storage.local.set({
        items: items
      });

      console.log("Item added via shortcut:", newItem.title);

    } catch (error) {
      console.error("Error adding item from background:", error);
    }
  }
});

// This script acts as the central communicator.

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Listen for the 'getImage' request from the sidebar
  if (request.action === 'getImage' && request.url) {

    // --- NEW LOGIC: Create a temporary background tab to fetch the correct content ---
    browser.tabs.create({
      url: request.url,
      active: false // Create the tab in the background, so it's not visible
    }).then(newTab => {
      // Now, we need to wait for this new tab to finish loading.
      const listener = (tabId, changeInfo, tab) => {
        // We only care about our temporary tab and when it's fully loaded
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          // The tab has loaded, now we can safely inject the script.
          browser.scripting.executeScript({
            target: { tabId: newTab.id },
            files: ['scripts/image_finder.js']
          })
            .then(injectionResults => {
              const imageUrl = (injectionResults && injectionResults[0] && injectionResults[0].result) ? injectionResults[0].result : null;

              // Send the result back to the sidebar
              sendResponse({ imageUrl: imageUrl });

              // Clean up: close the temporary tab and remove the listener
              browser.tabs.remove(newTab.id);
              browser.tabs.onUpdated.removeListener(listener);
            })
            .catch(error => {
              console.error(`Failed to inject script into ${request.url}:`, error);
              sendResponse({ imageUrl: null });
              browser.tabs.remove(newTab.id);
              browser.tabs.onUpdated.removeListener(listener);
            });
        }
      };

      // Register the listener to wait for the tab to load
      browser.tabs.onUpdated.addListener(listener);

      // Add a timeout to prevent the tab from staying open forever if it fails to load
      setTimeout(() => {
        browser.tabs.get(newTab.id, (tab) => {
          if (tab) { // If the tab still exists
            console.warn(`Tab for ${request.url} timed out. Closing it.`);
            sendResponse({ imageUrl: null });
            browser.tabs.remove(newTab.id);
            browser.tabs.onUpdated.removeListener(listener);
          }
        });
      }, 15000); // 15 seconds timeout

    }).catch(error => {
      console.error(`Failed to create a new tab for ${request.url}:`, error);
      sendResponse({ imageUrl: null });
    });

    // This is crucial: return true to indicate you will send a response asynchronously
    return true;
  }
});

