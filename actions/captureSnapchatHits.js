// actions/captureSnapchatHits.js
// Captures Snapchat Pixel hits fired to tr.snapchat.com.
// Pixel reference: https://businesshelp.snapchat.com/s/article/snap-pixel
const { URL, URLSearchParams } = require("url");

function attachSnapchatListener(page, snapHits) {
  const capture = (request) => {
    try {
      const url = request.url();
      let host;
      try { host = new URL(url).hostname; } catch { return; }

      // Snap pixel hostname is tr.snapchat.com (sometimes tr6.snapchat.com)
      if (!/(?:^|\.)snapchat\.com$/.test(host)) return;
      if (!/^tr(?:\d+)?\./.test(host) && !/\/p(?:\?|$)/.test(url) && !/\/cm\/?$/.test(url)) return;

      const urlObj = new URL(url);
      const hit = { __platform: "SNAPCHAT", __url: url };
      for (const [k, v] of urlObj.searchParams.entries()) hit[k] = v;

      const body = request.postData();
      if (body && body.includes("=")) {
        try {
          const bodyParams = new URLSearchParams(body);
          for (const [k, v] of bodyParams.entries()) hit[k] = v;
        } catch { /* ignore */ }
      }

      // Must look like a real pixel event (pid is the pixel id; event = event name)
      if (!hit.pid && !hit.event && !hit.ev_type) return;

      snapHits.push(hit);
      console.log(`Captured Snapchat hit: event=${hit.event || hit.ev_type || "?"} pid=${hit.pid || "?"}`);
    } catch (err) {
      console.error("Snapchat parse failed:", err.message);
    }
  };

  page.on("request", capture);
  page.on("frameattached", (frame) => frame.on("request", capture));
  page.frames().forEach((frame) => frame.on("request", capture));
}

module.exports = attachSnapchatListener;
