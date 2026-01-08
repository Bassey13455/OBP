// Use page as a parameter so the function knows which page to act on
async function click(page, selector) {
  await page.click(selector);
  console.log(`Clicked element: ${selector}`);
}

module.exports = click;
