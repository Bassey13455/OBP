async function handleCookieBanner(page) {
  // Example: click "Accept" if banner exists
  const acceptButton = await page.$("button#onetrust-accept-btn-handler");
  if (acceptButton) {
    await acceptButton.click();
    console.log("Cookie banner accepted");
  }
}

module.exports = handleCookieBanner;
