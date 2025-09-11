function createContextMenu() {
  browser.contextMenus.create({
    id: "searchOnMis", title: "Search on Mis", contexts: ["selection"]
  })
  browser.contextMenus.create({
    id: "searchOnSiro", title: "Search on Siro", contexts: ["selection"]
  })
  browser.contextMenus.create({
    id: "searchOnVida", title: "Search on Vida", contexts: ["selection"]
  })
  browser.contextMenus.create({
    id: "searchOnVidc", title: "Search on Vidc", contexts: ["selection"]
  })
}

browser.runtime.onStartup.addListener(createContextMenu)
browser.runtime.onInstalled.addListener(createContextMenu)

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "searchOnMis") {
    const query = info.selectionText.trim();
    searchOnMissav(query)
  } else if (info.menuItemId === "searchOnSiro") {
    const query = info.selectionText.trim();
    searchOnSiro(query)
  } else if (info.menuItemId === "searchOnVida") {
    const query = info.selectionText.trim()
    searchOnVida(query)
  } else if (info.menuItemId === "searchOnVidc") {
    const query = info.selectionText.trim()
    searchOnVidc(query)
  }
});

browser.commands.onCommand.addListener((command) => {
  browser.tabs.query({ currentWindow: true, active: true }, function (result) {
    let tab = result[0];
    browser.scripting.executeScript({
      target: { tabId: tab.id }, function: () => {
        return window.getSelection().toString();
      }
    }, (selection) => {
      const query = selection[0].result.trim();
      if (command === "search_on_mis") {
        searchOnMissav(query)
      } else if (command === "search_on_siro") {
        searchOnSiro(query)
      }
    });
  });
})

function searchOnMissav(query) {
  const data = query.match(/([a-zA-Z]+)(0+)?-?(\d{3,})/)
  let id = (data === null) ? query : data[1] + "-" + data[3]
  const misSearchUrl = `https://missav.ai/search/${encodeURIComponent(id)}`;
  browser.tabs.create({ url: misSearchUrl });
}

function searchOnSiro(query) {
  const siroSearchUrl = `https://sirowiki.com/search/?keyword=${encodeURIComponent(query)}`;
  browser.tabs.create({ url: siroSearchUrl });
}

function searchOnVida(query) {
  const data = query.match(/([a-zA-Z]+)(0+)?-?(\d{3,})/)
  let id = (data === null) ? query : data[1] + " " + data[3]
  const vidaSearchUrl = `https://video.dmm.co.jp/av/list/?key=${encodeURIComponent(id)}`;
  browser.tabs.create({ url: vidaSearchUrl });
}

function searchOnVidc(query) {
  const data = query.match(/([a-zA-Z]+)(0+)?-?(\d{3,})/)
  let id = (data === null) ? query : data[1] + " " + data[3]
  const vidcSearchUrl = `https://video.dmm.co.jp/amateur/list/?key=${encodeURIComponent(id)}`;
  browser.tabs.create({ url: vidcSearchUrl });
}


function cleanUrlParameters(details) {
  const originalUrl = details.url;

  if (details.type !== 'main_frame') {
    return;
  }

  const url = new URL(originalUrl);
  const params = url.searchParams;

  if (params.has('id') && params.size > 1) {
    const idValue = params.get('id');

    const newUrl = `${url.origin}${url.pathname}?id=${encodeURIComponent(idValue)}`;

    if (originalUrl !== newUrl) {
      return { redirectUrl: newUrl };
    }
  }

  return;
}

browser.webRequest.onBeforeRequest.addListener(
  cleanUrlParameters,
  {
    urls: ["https://video.dmm.co.jp/*"],
    types: ["main_frame"]
  },
  ["blocking"]
);

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

