/**
 * actions/consentBanner.js
 * ------------------------------------------------------------------
 * Loads a page (optional) and handles a cookie-consent banner by
 * clicking either "Accept All" or "Deny / Reject All". Supports the
 * major Consent Management Platforms out of the box and falls back
 * to generic heuristics. You can also pass a custom selector to
 * override everything.
 *
 * Options:
 *   choice:         "acceptAll" | "deny"   (default "acceptAll")
 *   url:            Optional URL. If provided, the page is navigated
 *                   there first (with waitUntil: "load").
 *   timeout:        How long to wait for the banner, in ms
 *                   (default 10000).
 *   customSelector: CSS selector that overrides the built-in list.
 *                   If set, only this selector is tried.
 *
 * Returns: { clicked: boolean, selector?: string }
 * ------------------------------------------------------------------
 */

const SELECTORS = {
  acceptAll: [
    // OneTrust
    "#onetrust-accept-btn-handler",
    "button#accept-recommended-btn-handler",
    ".onetrust-close-btn-handler",
    // Cookiebot
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyLevelButtonAccept",
    "#CybotCookiebotDialogBodyButtonAccept",
    // TrustArc
    "#truste-consent-button",
    ".truste-button2",
    "a.call",
    // Quantcast / Sourcepoint
    'button.qc-cmp2-summary-buttons[mode="primary"]',
    'button[aria-label="AGREE"]',
    "button.sp_choice_type_11",
    // Didomi
    "#didomi-notice-agree-button",
    // Usercentrics
    'button[data-testid="uc-accept-all-button"]',
    // Axeptio
    "button#axeptio_btn_acceptAll",
    // Osano
    ".osano-cm-accept-all",
    // CookieYes
    ".cky-btn-accept",
    // Klaro
    ".cm-btn-success",
    // Generic fallbacks
    'button[id*="accept-all" i]',
    'button[class*="accept-all" i]',
    'button[id*="acceptall" i]',
    'button[class*="acceptall" i]',
    'button[aria-label*="accept all" i]',
    'button[id*="accept" i]:not([id*="selected" i])',
    'button[class*="accept" i]:not([class*="selected" i])',
  ],
  deny: [
    // OneTrust
    "#onetrust-reject-all-handler",
    ".ot-pc-refuse-all-handler",
    ".save-preference-btn-handler.onetrust-close-btn-handler",
    // Cookiebot
    "#CybotCookiebotDialogBodyButtonDecline",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
    // TrustArc
    ".truste-button3",
    "#truste-consent-required",
    // Quantcast / Sourcepoint
    'button.qc-cmp2-summary-buttons[mode="secondary"]',
    "button.sp_choice_type_12",
    "button.sp_choice_type_13",
    // Didomi
    "#didomi-notice-disagree-button",
    'button[aria-label="Disagree to our data processing terms"]',
    // Usercentrics
    'button[data-testid="uc-deny-all-button"]',
    // Axeptio
    "button#axeptio_btn_dismiss",
    // Osano
    ".osano-cm-denyAll",
    ".osano-cm-deny",
    // CookieYes
    ".cky-btn-reject",
    // Klaro
    ".cm-btn-danger",
    ".cm-btn-decline",
    // Generic fallbacks
    'button[id*="reject-all" i]',
    'button[class*="reject-all" i]',
    'button[id*="rejectall" i]',
    'button[class*="rejectall" i]',
    'button[id*="deny" i]',
    'button[class*="deny" i]',
    'button[id*="decline" i]',
    'button[class*="decline" i]',
    'button[aria-label*="reject" i]',
    'button[aria-label*="deny" i]',
    'button[aria-label*="decline" i]',
  ],
};

/**
 * @param {import('playwright').Page} page
 * @param {{ choice?: "acceptAll"|"deny", url?: string, timeout?: number, customSelector?: string }} [opts]
 */
async function consentBanner(page, opts = {}) {
  const choice = opts.choice === "deny" ? "deny" : "acceptAll";
  const timeout = Number(opts.timeout) || 10000;
  const customSelector = opts.customSelector || null;

  if (opts.url) {
    console.log(`Consent banner: navigating to ${opts.url}`);
    await page.goto(opts.url, { waitUntil: "load", timeout: 60000 });
  }

  const selectors = customSelector ? [customSelector] : SELECTORS[choice];
  const label = choice === "deny" ? "Deny / Reject All" : "Accept All";
  console.log(`Consent banner: looking for "${label}" (timeout ${timeout}ms)...`);

  const start = Date.now();
  while (Date.now() - start < timeout) {
    // Search the main page and any iframes (many CMPs render in iframes)
    const frames = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
    for (const frame of frames) {
      for (const sel of selectors) {
        try {
          const loc = frame.locator(sel).first();
          const visible = await loc.isVisible({ timeout: 150 }).catch(() => false);
          if (visible) {
            await loc.click({ timeout: 2000 });
            const where = frame === page.mainFrame() ? "page" : `iframe (${frame.url() || "anonymous"})`;
            console.log(`Consent banner: clicked "${label}" via ${sel} [${where}]`);
            // Small settle delay for the banner to close and any consent events to fire
            await page.waitForTimeout(600);
            return { clicked: true, selector: sel };
          }
        } catch {
          // Selector may not be valid in this frame; keep going
        }
      }
    }
    await page.waitForTimeout(250);
  }

  console.log(`Consent banner: no "${label}" button found within ${timeout}ms (continuing).`);
  return { clicked: false };
}

module.exports = consentBanner;
