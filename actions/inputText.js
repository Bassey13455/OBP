// actions/inputText.js
module.exports = async function inputText(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 5000 }); // wait until field exists
  await page.fill(selector, text); // clear + type
  console.log(`✅ Inputted text into ${selector}: "${text}"`);
};
