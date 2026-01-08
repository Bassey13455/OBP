// actions/captureGA4Hits.js
const { URL } = require("url");
const { URLSearchParams } = require("url");

/**
 * Attaches GA4 listener to capture ONLY real GA4 hits
 * Prevents Adobe hits from being falsely captured.
 */
function attachGA4Listener(page, ga4Hits) {
  const captureGA4 = async (request) => {
    try {
      const url = request.url();

      // STRICT GA4 ENDPOINTS ONLY
      const isGA4Host =
        /(?:www\.)?google-analytics\.com$/.test(new URL(url).hostname) ||
        /(?:www\.)?analytics\.google\.com$/.test(new URL(url).hostname) ||
        /g\.doubleclick\.net$/.test(new URL(url).hostname);

      if (!isGA4Host) return;

      // STRICT path match
      const isGA4Path =
        url.includes("/g/collect") ||
        url.includes("/j/collect") ||
        url.includes("/collect");

      if (!isGA4Path) return;

      const urlObj = new URL(url);
      const hit = {};

      // GET params
      for (const [k, v] of urlObj.searchParams.entries()) {
        hit[k] = v;
      }

      // POST params (GA4 sends body payload)
      const body = request.postData();
      if (body && body.includes("=")) {
        const bodyParams = new URLSearchParams(body);
        for (const [k, v] of bodyParams.entries()) {
          hit[k] = v;
        }
      }

      // FINAL DEFINITIVE VALIDATION:
      // GA4 ALWAYS has "v=2" or "tid=G-*"
      const version = hit["v"];
      const tid = hit["tid"];

      if (version !== "2" && !(tid && tid.match(/^G-[A-Z0-9]+/))) {
        return; // Not GA4
      }

      // Label platform
      hit.__platform = "GA4";

      ga4Hits.push(hit);
      console.log("🎯 Captured GA4 Hit:", hit.en || hit.tid);
    } catch (err) {
      console.error("GA4 parse failed:", err);
    }
  };

  // Attach to page & frames
  page.on("request", captureGA4);
  page.on("frameattached", (frame) => frame.on("request", captureGA4));
  page.frames().forEach((frame) => frame.on("request", captureGA4));
}

module.exports = attachGA4Listener;
