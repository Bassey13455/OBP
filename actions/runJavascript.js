// actions/runJavascript.js
async function runJavascript(page, script) {
  // script can be a string of JS code or a function
  let result;
  try {
    if (typeof script === "function") {
      result = await page.evaluate(script);
    } else if (typeof script === "string") {
      result = await page.evaluate(new Function(script));
    } else {
      throw new Error("Script must be a string or function");
    }
    console.log("JavaScript executed successfully:", result);
    return result;
  } catch (err) {
    console.error("Error running JavaScript:", err);
    return null;
  }
}

module.exports = runJavascript;
