// actions/capturePinterestHits.js
// Captures Pinterest Tag hits fired to ct.pinterest.com.
// Tag reference: https://help.pinterest.com/en/business/article/track-conversions-with-pinterest-tag
const { URL, URLSearchParams } = require("url");

function attachPinterestListener(page, pinHits) {
  const capture = (request) => {
    try {
      const url = request.url();
      let host;
      try { host = new URL(url).hostname; } catch { return; }
      if (!/(?:^|\.)pinterest\.com$/.test(host)) return;

      // Pinterest tag endpoints: /v3/, /user, /ct_uu
      const isTagPath = /\/v3\//.test(url) || /\/user\/?$/.test(url) || /\/ct_uu/.test(url);
      if (!isTagPath) return;

      const urlObj = new URL(url);
      const hit = { __platform: "PINTEREST", __url: url };
      for (const [k, v] of urlObj.searchParams.entries()) hit[k] = v;

      const body = request.postData();
      if (body && body.includes("=")) {
        try {
          const bodyParams = new URLSearchParams(body);
          for (const [k, v] of bodyParams.entries()) hit[k] = v;
        } catch { /* ignore */ }
      }

      // Must look like a real pixel event: tid = tag id, event = event name
      if (!hit.tid && !hit.event) return;

      pinHits.push(hit);
      console.log(`Captured Pinterest hit: event=${hit.event || "?"} tid=${hit.tid || "?"}`);
    } catch (err) {
      console.error("Pinterest parse failed:", err.message);
    }
  };

  page.on("request", capture);
  page.on("frameattached", (frame) => frame.on("request", capture));
  page.frames().forEach((frame) => frame.on("request", capture));
}

module.exports = attachPinterestListener;
