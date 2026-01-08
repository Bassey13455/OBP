async function visitPage(page, url) {
  // Use 'load' instead of 'networkidle' to avoid timeout
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  console.log(`Visited ${url}`);
}

module.exports = visitPage;
