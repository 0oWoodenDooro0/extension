// content/contentLoader.js
// Chrome Manifest V3 content script entrypoint that dynamically loads the ES module indicator scanner.

(async () => {
  try {
    const indicatorSrc = chrome.runtime.getURL('content/indicatorScanner.js');
    const indicatorModule = await import(indicatorSrc);
    if (typeof indicatorModule.initIndicatorScanner === 'function') {
      await indicatorModule.initIndicatorScanner();
    }
  } catch (err) {
    console.error('[IndicatorScanner] Failed to load content script module:', err);
  }

  try {
    const shortcutSrc = chrome.runtime.getURL('content/shortcutHandler.js');
    const shortcutModule = await import(shortcutSrc);
    if (typeof shortcutModule.initShortcutHandler === 'function') {
      await shortcutModule.initShortcutHandler();
    }
  } catch (err) {
    console.error('[ShortcutHandler] Failed to load content script module:', err);
  }
})();
