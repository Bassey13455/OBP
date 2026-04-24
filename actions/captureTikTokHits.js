// actions/captureTikTokHits.js
// Captures TikTok Pixel hits fired to analytics.tiktok.com.
// Pixel reference: https://business-api.tiktok.com/portal/docs?id=1739585702922241
const { URL, URLSearchParams } = require("url");

function attachTikTokListener(page, tiktokHits) {
  const capture = async (request) => {
    try {
      const url = request.url();
      let host;
      try { host = new URL(url).hostname; } catch { return; }
      if (!/(?:^|\.)tiktok\.com$/.test(host)) return;

      // Skip the config bootstrap script
      if (/\/events\.js(?:\?|$)/.test(url)) return;

      // Real events go to /api/v2/pixel (and /api/v2/pixel/batch)
      const isPixelPath = /\/api\/v\d+\/pixel/.test(url) || /\/pixel\/track/.test(url);
      if (!isPixelPath) return;

      const urlObj = new URL(url);
      const hit = { __platform: "TIKTOK", __url: url };
      for (const [k, v] of urlObj.searchParams.entries()) hit[k] = v;

      const body = request.postData();
      if (body) {
        // TikTok usually POSTs JSON
        try {
          const parsed = JSON.parse(body);
          const flat = flattenForHit(parsed);
          Object.assign(hit, flat);
        } catch {
          try {
            const bodyParams = new URLSearchParams(body);
            for (const [k, v] of bodyParams.entries()) hit[k] = v;
          } catch { /* ignore */ }
        }
      }

      tiktokHits.push(hit);
      console.log(`Captured TikTok hit: event=${hit.event || hit.event_name || "?"}`);
    } catch (err) {
      console.error("TikTok parse failed:", err.message);
    }
  };

  page.on("request", capture);
  page.on("frameattached", (frame) => frame.on("request", capture));
  page.frames().forEach((frame) => frame.on("request", capture));
}

// Flatten a nested JSON into dot-notation keys so ExcelJS can render them.
function flattenForHit(obj, prefix = "", out = {}) {
  if (obj === null || obj === undefined) { out[prefix || "value"] = ""; return out; }
  if (typeof obj !== "object") { out[prefix || "value"] = obj; return out; }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flattenForHit(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    flattenForHit(v, key, out);
  }
  return out;
}

module.exports = attachTikTokListener;
