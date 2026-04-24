// actions/captureGoogleAdsHits.js
// Captures Google Ads conversion + remarketing hits.
// Endpoints:
//   - www.googleadservices.com/pagead/conversion/<conversion_id>/
//   - googleads.g.doubleclick.net/pagead/viewthroughconversion/<id>/
//   - www.google.com/pagead/1p-conversion/<id>/ (GCLID first-party)
//   - www.google.com/ads/ga-audiences (remarketing audience refresh)
const { URL, URLSearchParams } = require("url");

function attachGoogleAdsListener(page, adsHits) {
  const capture = (request) => {
    try {
      const url = request.url();
      let host;
      try { host = new URL(url).hostname; } catch { return; }

      const isAdsHost =
        /(?:^|\.)googleadservices\.com$/.test(host) ||
        /(?:^|\.)doubleclick\.net$/.test(host) ||
        (host === "www.google.com" && (/\/pagead\//.test(url) || /\/ads\/ga-audiences/.test(url)));

      if (!isAdsHost) return;

      const isAdsPath =
        /\/pagead\/conversion\//.test(url) ||
        /\/pagead\/viewthroughconversion\//.test(url) ||
        /\/pagead\/1p-conversion\//.test(url) ||
        /\/pagead\/landing(?:\?|$)/.test(url) ||
        /\/ads\/ga-audiences/.test(url);
      if (!isAdsPath) return;

      const urlObj = new URL(url);
      const hit = { __platform: "GOOGLEADS", __url: url };
      for (const [k, v] of urlObj.searchParams.entries()) hit[k] = v;

      // Pull the conversion/remarketing id out of the path so it appears as a column
      const idMatch = url.match(/\/(?:pagead\/(?:1p-)?(?:viewthrough)?conversion|pagead\/viewthroughconversion)\/(\d+)\//);
      if (idMatch) hit.__conversion_id = idMatch[1];

      const body = request.postData();
      if (body && body.includes("=")) {
        try {
          const bodyParams = new URLSearchParams(body);
          for (const [k, v] of bodyParams.entries()) hit[k] = v;
        } catch { /* ignore */ }
      }

      adsHits.push(hit);
      console.log(`Captured GoogleAds hit: id=${hit.__conversion_id || hit.random || "?"} label=${hit.label || "?"}`);
    } catch (err) {
      console.error("GoogleAds parse failed:", err.message);
    }
  };

  page.on("request", capture);
  page.on("frameattached", (frame) => frame.on("request", capture));
  page.frames().forEach((frame) => frame.on("request", capture));
}

module.exports = attachGoogleAdsListener;
