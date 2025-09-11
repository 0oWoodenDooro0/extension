// This script is injected into a webpage to find the best representative image.

(function () {
  // Function to find the image URL from the 'og:image' meta tag.
  function findOgImage() {
    const meta = document.querySelector("meta[property='og:image']");
    if (meta && meta.content) {
      let imageUrl = meta.content;
      // --- NEW: Handle relative URLs ---
      // If the URL starts with '/', it's a relative path.
      if (imageUrl.startsWith('/')) {
        // Prepend the website's origin to make it an absolute URL.
        return window.location.origin + imageUrl;
      }
      return imageUrl;
    }
    return null;
  }

  // --- NEW: More robust logic for dynamic websites ---

  // 1. Initial attempt: Try to find the image immediately.
  let imageUrl = findOgImage();
  if (imageUrl) {
    return imageUrl; // Found it on the first try, great!
  }

  // 2. Fallback: If not found, set up an observer to wait for dynamic changes.
  // This is for modern websites (React, Vue, etc.) that modify the <head> after initial load.
  return new Promise((resolve) => {
    let observer = new MutationObserver((mutations) => {
      // Check again whenever the <head> changes.
      let foundUrl = findOgImage();
      if (foundUrl) {
        observer.disconnect(); // Stop watching once we found it.
        resolve(foundUrl);
      }
    });

    // Start observing the <head> element for new child elements.
    observer.observe(document.head, {
      childList: true,
      subtree: true
    });

    // Set a timeout. If we can't find the image after a few seconds, give up.
    setTimeout(() => {
      observer.disconnect();
      // Try one last time before resolving.
      resolve(findOgImage());
    }, 3000); // Wait for a maximum of 3 seconds.
  });

})();

