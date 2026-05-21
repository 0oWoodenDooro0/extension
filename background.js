import { initializeSearchShortcuts } from './utils.js'

initializeSearchShortcuts();


// This script acts as the central communicator.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Listen for the 'getImage' request from the sidebar
  if (request.action === 'getImage' && request.url) {

    // --- NEW LOGIC: Create a temporary background tab to fetch the correct content ---
    chrome.tabs.create({
      url: request.url,
      active: false // Create the tab in the background, so it's not visible
    }).then(newTab => {
      // Now, we need to wait for this new tab to finish loading.
      const listener = (tabId, changeInfo, tab) => {
        // We only care about our temporary tab and when it's fully loaded
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          // The tab has loaded, now we can safely inject the script.
          chrome.scripting.executeScript({
            target: { tabId: newTab.id },
            files: ['scripts/image_finder.js']
          })
            .then(injectionResults => {
              const imageUrl = (injectionResults && injectionResults[0] && injectionResults[0].result) ? injectionResults[0].result : null;

              // Send the result back to the sidebar
              sendResponse({ imageUrl: imageUrl });

              // Clean up: close the temporary tab and remove the listener
              chrome.tabs.remove(newTab.id);
              chrome.tabs.onUpdated.removeListener(listener);
            })
            .catch(error => {
              console.error(`Failed to inject script into ${request.url}:`, error);
              sendResponse({ imageUrl: null });
              chrome.tabs.remove(newTab.id);
              chrome.tabs.onUpdated.removeListener(listener);
            });
        }
      };

      // Register the listener to wait for the tab to load
      chrome.tabs.onUpdated.addListener(listener);

      // Add a timeout to prevent the tab from staying open forever if it fails to load
      setTimeout(() => {
        chrome.tabs.get(newTab.id, (tab) => {
          if (tab) { // If the tab still exists
            console.warn(`Tab for ${request.url} timed out. Closing it.`);
            sendResponse({ imageUrl: null });
            chrome.tabs.remove(newTab.id);
            chrome.tabs.onUpdated.removeListener(listener);
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


