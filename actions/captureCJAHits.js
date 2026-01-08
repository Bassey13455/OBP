// actions/captureCJAHits.js

function flatten(obj, prefix = "", out = {}) {
  if (obj === null || obj === undefined) return out;

  if (typeof obj !== "object") {
    out[prefix.replace(/\.$/, "")] = obj;
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((value, index) => {
      flatten(value, `${prefix}${index}.`, out);
    });
    return out;
  }

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const newPrefix = prefix ? `${prefix}${key}.` : `${key}.`;
    if (value && typeof value === "object") {
      flatten(value, newPrefix, out);
    } else {
      out[newPrefix.replace(/\.$/, "")] = value;
    }
  }

  return out;
}

function attachCJAHits(page, cjaHits) {
  console.log(`Attaching CJA listener to page: ${page.url()}`);

  const handleRequest = (request) => {
    const url = request.url();

    // DEBUG
    // console.log("REQ:", url);

    // MATCH ANY Adobe AEP interact/collect request
    if (
      !url.match(/interact|collect|v1\/(events|interact|collect)/i) ||
      !url.match(/smetrics|ralphlauren|adobedc|rlcdn/i)
    ) {
      return;
    }

    const body = request.postData();
    if (!body) return;

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return;
    }

    if (!payload.events || !Array.isArray(payload.events)) return;

    payload.events.forEach((eventObj, index) => {
      const hit = {};
      flatten(eventObj, "", hit);
      hit.__platform = "CJA";
      hit.__eventIndex = index;

      cjaHits.push(hit);

      const label =
        hit["xdm.eventType"] ||
        hit["eventType"] ||
        `eventIndex_${index}`;

      console.log("🎯 CJA HIT:", label);
    });
  };

  page.on("request", handleRequest);

  // Also track frame network traffic
  page.on("frameattached", (frame) =>
    frame.on("request", handleRequest)
  );

  page.frames().forEach((frame) =>
    frame.on("request", handleRequest)
  );
}

module.exports = attachCJAHits;
