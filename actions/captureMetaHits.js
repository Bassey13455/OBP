// actions/captureMetaHits.js
// Captures Meta (Facebook) Pixel hits fired to facebook.com/tr.
// Pixel reference: https://developers.facebook.com/docs/meta-pixel/reference
const { URL, URLSearchParams } = require("url");

function attachMetaListener(page, metaHits) {
  const capture = (request) => {
    try {
      const url = request.url();
      let host;
      try { host = new URL(url).hostname; } catch { return; }

      // Meta pixel fires to www.facebook.com/tr (image beacon + XHR)
      const isMetaHost = /(?:^|\.)facebook\.com$/.test(host);
      if (!isMetaHost) return;
      if (!/\/tr(?:\/|\?|$)/.test(url)) return;

      const urlObj = new URL(url);
      const hit = { __platform: "META", __url: url };
      for (const [k, v] of urlObj.searchParams.entries()) hit[k] = v;

      const body = request.postData();
      if (body && body.includes("=")) {
        try {
          const bodyParams = new URLSearchParams(body);
          for (const [k, v] of bodyParams.entries()) hit[k] = v;
        } catch { /* ignore */ }
      }

      // Must look like a pixel event (id + ev are both required)
      if (!hit.id && !hit.ev) return;

      metaHits.push(hit);
      console.log(`Captured Meta hit: ev=${hit.ev || "?"} id=${hit.id || "?"}`);
    } catch (err) {
      console.error("Meta parse failed:", err.message);
    }
  };

  page.on("request", capture);
  page.on("frameattached", (frame) => frame.on("request", capture));
  page.frames().forEach((frame) => frame.on("request", capture));
}

module.exports = attachMetaListener;
