/**
 * Reloads the current page safely without waiting for all network requests
 * @param {import('playwright').Page} page
 */
async function reloadPage(page) {
  console.log("Reloading the page...");
  try {
    await page.reload(); // simple reload
    await page.waitForTimeout(3000); // small wait to capture delayed hits
    console.log("Page reloaded.");
  } catch (err) {
    console.warn("Reload failed, continuing anyway:", err.message);
  }
}

module.exports = reloadPage;
