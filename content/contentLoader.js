// content/contentLoader.js
// Chrome Manifest V3 content script entrypoint that dynamically loads the ES module indicator scanner.

(async () => {
  try {
    const src = chrome.runtime.getURL('content/indicatorScanner.js');
    const module = await import(src);
    if (typeof module.initIndicatorScanner === 'function') {
      await module.initIndicatorScanner();
    }
  } catch (err) {
    console.error('[IndicatorScanner] Failed to load content script module:', err);
  }
})();
