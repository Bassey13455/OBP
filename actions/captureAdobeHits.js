const { URLSearchParams } = require("url");

/**
 * Attaches Adobe Analytics listener to a Playwright page and its frames.
 * Can be called multiple times safely (re-attaches after reloads or JS navigation).
 * @param {import('playwright').Page} page
 * @param {Array} adobeHits - array to store captured hits
 */
function attachAdobeListener(page, adobeHits) {
  // Remove any existing listeners to avoid duplicates
  console.log(`Attaching Adobe listener to page: ${page.url()}`);
  page.removeAllListeners("request");
  page.removeAllListeners("frameattached");

  // Helper to capture Adobe hits from a request
  const captureHit = (request) => {
    const url = request.url();
    if (url.includes("/b/ss/")) {
      const params = new URLSearchParams(url.split("?")[1]);
      const hit = {};
      for (const [key, value] of params.entries()) {
        hit[key] = value;
      }
      adobeHits.push(hit);
      console.log(`Captured Adobe hit on page: ${page.url()}`); // log each hit
    }
  };

  // Listen to all requests on the main page
  page.on("request", captureHit);

  // Listen to requests in any frames
  page.on("frameattached", (frame) => {
    frame.on("request", captureHit);
  });

  // Also attach to existing frames (in case called after navigation)
  page.frames().forEach((frame) => {
    frame.on("request", captureHit);
  });
}

module.exports = attachAdobeListener;
