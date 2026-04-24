/**
 * runner-core.js
 * Main journey execution loop. Invoked by runner.js with a list of
 * loaded configs. Sheet rendering lives in runner-sheets.js and
 * workbook export lives in runner-export.js so each file stays
 * comfortably under the Write tool's ~16KB truncation threshold.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");

const visitPage = require("./actions/visitPage");
const reloadPage = require("./actions/reloadPage");
const click = require("./actions/click");
const inputText = require("./actions/inputText");
const selectDropdown = require("./actions/selectDropdown");
const runJavascript = require("./actions/runJavascript");
const handleCookieBanner = require("./actions/handleCookieBanner");
const consentBanner = require("./actions/consentBanner");

const attachAdobeListener = require("./actions/captureAdobeHits");
const attachGA4Listener = require("./actions/captureGA4Hits");
const attachCJAHits = require("./actions/captureCJAHits");
const attachMetaListener = require("./actions/captureMetaHits");
const attachTikTokListener = require("./actions/captureTikTokHits");
const attachSnapchatListener = require("./actions/captureSnapchatHits");
const attachPinterestListener = require("./actions/capturePinterestHits");
const attachGoogleAdsListener = require("./actions/captureGoogleAdsHits");

const { renderPlatformSheet } = require("./runner-sheets");
const { exportWorkbooks } = require("./runner-export");

const HITS_ROOT = path.resolve("hits");

function safeFileStem(n) {
  return String(n || "journey").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "journey";
}
function timestampFolder() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => { process.stdin.pause(); resolve(); });
  });
}
function askYesNo(q) {
  console.log(q);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", d => { process.stdin.pause(); resolve(String(d).trim().toLowerCase()); });
  });
}

const BOT_BLOCK_PATTERNS = [
  "Access to this page has been denied",
  "Press & Hold",
  "press-and-hold",
  "Pardon Our Interruption",
  "Please verify you are a human",
];

async function isPageBlocked(page) {
  try {
    const title = await page.title();
    const html = await page.content();
    return BOT_BLOCK_PATTERNS.some(p => title.includes(p) || html.includes(p));
  } catch {
    return false; // page closed/navigating — don't misread as blocked
  }
}

// Wait for a bot-challenge page to clear. Strategy:
//   1. Poll the DOM every 2s for the blocking markers to disappear.
//   2. Simultaneously accept ENTER on stdin as a "skip" signal (CLI-only).
//   3. Bail after BOT_MAX_WAIT_MS so a forgotten run can't hang the server forever.
// Returns once the page is clear OR the user forces continuation OR timeout.
async function checkForBotBlock(page) {
  if (!(await isPageBlocked(page))) return;

  const MAX_WAIT_MS = Number(process.env.OBP_BOT_WAIT_MS) || 5 * 60 * 1000;
  const POLL_MS = 2000;
  const deadline = Date.now() + MAX_WAIT_MS;

  console.log("\n!! BOT FILTER TRIGGERED !!");
  console.log("Solve the challenge in the Chromium window — the run will resume automatically once the page clears.");
  console.log(`(Waiting up to ${Math.round(MAX_WAIT_MS / 1000)}s. Press ENTER in this terminal to skip immediately.)`);

  // Optional stdin skip — silently no-op when stdin isn't interactive (server-spawned child).
  let stdinSkipped = false;
  const onStdinData = () => { stdinSkipped = true; };
  try {
    process.stdin.resume();
    process.stdin.once("data", onStdinData);
  } catch { /* stdin unavailable — polling still works */ }

  try {
    while (Date.now() < deadline) {
      if (stdinSkipped) {
        console.log("Continue signal received — resuming automation.");
        return;
      }
      if (!(await isPageBlocked(page))) {
        console.log("Bot filter cleared — resuming automation.");
        return;
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
    console.log(`Bot filter still present after ${Math.round(MAX_WAIT_MS / 1000)}s — giving up and continuing.`);
  } finally {
    try {
      process.stdin.removeListener("data", onStdinData);
      process.stdin.pause();
    } catch { /* ignore */ }
  }
}

async function runAction(page, act) {
  switch (act.type) {
    case "visitPage":          return visitPage(page, act.url);
    case "reloadPage":         return reloadPage(page);
    case "click":              return click(page, act.selector);
    case "inputText":          return inputText(page, act.selector, act.text);
    case "selectDropdown":     return selectDropdown(page, act.selector, act.value);
    case "handleCookieBanner": return handleCookieBanner(page);
    case "consentBanner":      return consentBanner(page, {
      choice: act.choice,
      url: act.url,
      timeout: act.timeout,
      customSelector: act.customSelector,
    });
    case "wait":               return page.waitForTimeout(Number(act.ms) || 1000);
    case "randomDelay": {
      const min = Number(act.min) || 500;
      const max = Number(act.max) || 1500;
      return page.waitForTimeout(min + Math.random() * (max - min));
    }
    case "manualConfirm": {
      console.log(`\n=== ${act.prompt || "Manual confirmation required"} ===`);
      console.log("Press ENTER here to continue...");
      return waitForEnter();
    }
    case "runJavascript": {
      if (act.waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "load" }).catch(() => {}),
          runJavascript(page, act.code),
        ]);
      } else {
        await runJavascript(page, act.code);
      }
      return;
    }
    default:
      console.warn(`Unknown action type: ${act.type}`);
  }
}

async function runJourney(config, sourcePath) {
  const browserCfg = config.browser || {};
  const viewport = browserCfg.viewport || { width: 1366, height: 768 };
  const stem = safeFileStem(config.name || path.basename(sourcePath, ".json"));

  const runDir = path.join(HITS_ROOT, stem, timestampFolder());
  fs.mkdirSync(runDir, { recursive: true });
  console.log(`\nRun output folder: ${path.relative(process.cwd(), runDir)}`);

  // OBP_HEADLESS env var overrides the journey config:
  //   "1" / "true"  -> force headless
  //   "0" / "false" -> force visible (show Chromium window)
  //   unset         -> use journey's browser.headless setting (default: visible)
  let headless = !!browserCfg.headless;
  const envHeadless = String(process.env.OBP_HEADLESS || "").toLowerCase();
  if (envHeadless === "1" || envHeadless === "true")  headless = true;
  if (envHeadless === "0" || envHeadless === "false") headless = false;

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent: browserCfg.userAgent || undefined,
    viewport,
    locale: browserCfg.locale || "en-GB",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = { runtime: {} };
    const origQuery = navigator.permissions.query;
    navigator.permissions.query = (p) =>
      p.name === "notifications"
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(p);
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-GB", "en"] });
  });

  const page = await context.newPage();
  const workbook = new ExcelJS.Workbook();
  const failures = [];
  const globalHits = [];
  const partialFilesWritten = new Set();

  async function runStep(step) {
    console.log(`\n===== Starting Step: ${step.name} =====`);
    const buckets = {
      ADOBE:     [],
      GA4:       [],
      CJA:       [],
      META:      [],
      TIKTOK:    [],
      SNAPCHAT:  [],
      PINTEREST: [],
      GOOGLEADS: [],
    };
    attachAdobeListener(page, buckets.ADOBE);
    attachGA4Listener(page, buckets.GA4);
    attachCJAHits(page, buckets.CJA);
    attachMetaListener(page, buckets.META);
    attachTikTokListener(page, buckets.TIKTOK);
    attachSnapchatListener(page, buckets.SNAPCHAT);
    attachPinterestListener(page, buckets.PINTEREST);
    attachGoogleAdsListener(page, buckets.GOOGLEADS);

    let didNavigate = false;
    const navP = page.waitForNavigation({ timeout: 5000 })
      .then(() => { didNavigate = true; }, () => {});

    for (const act of step.actions) await runAction(page, act);
    await navP.catch(() => {});

    // Let a bot interstitial present itself before we check once.
    // checkForBotBlock now blocks until the page clears (or timeout), so a single
    // call per step is enough — three calls previously spammed the log on
    // stubborn challenges like Ralph Lauren's Akamai interstitial.
    await checkForBotBlock(page);

    if (!didNavigate) {
      try {
        await page.evaluate(() => window.scrollBy(0, 100));
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollBy(0, -100));
        await page.waitForTimeout(500);
      } catch { /* page may have navigated */ }
    }
    await page.waitForTimeout(8000);

    // Aggregate for the master Summary sheet
    for (const hits of Object.values(buckets)) globalHits.push(...hits);

    // Per-platform, per-step sheets + validation
    const rulesOf = {
      ADOBE:     step.validations?.adobe     || [],
      GA4:       step.validations?.ga4       || [],
      CJA:       step.validations?.cja       || [],
      META:      step.validations?.meta      || [],
      TIKTOK:    step.validations?.tiktok    || [],
      SNAPCHAT:  step.validations?.snapchat  || [],
      PINTEREST: step.validations?.pinterest || [],
      GOOGLEADS: step.validations?.googleads || [],
    };
    for (const label of Object.keys(buckets)) {
      const hits = buckets[label];
      if (!hits.length) continue;
      renderPlatformSheet(workbook, label, step, hits, rulesOf[label], failures);
    }
  }

  let stoppedEarly = false;
  for (const step of config.steps) {
    try {
      await runStep(step);
    } catch (err) {
      console.error(`\nERROR during step: ${step.name}`);
      console.error(err);
      console.log("\nExporting partial results before asking to continue...");
      const written = await exportWorkbooks(workbook, stem, runDir, true, { globalHits, failures });
      written.forEach(p => partialFilesWritten.add(p));
      const answer = await askYesNo("\nContinue to next step? (y/n): ");
      if (answer !== "y") {
        console.log("Stopping test early - partial results kept.");
        stoppedEarly = true;
        await browser.close();
        break;
      }
    }
  }

  if (!stoppedEarly) {
    if (failures.length > 0) console.log(`\n${failures.length} validation issues found.`);

    await exportWorkbooks(workbook, stem, runDir, false, { globalHits, failures });

    if (partialFilesWritten.size) {
      console.log(`Cleaning up ${partialFilesWritten.size} partial file(s) after successful run.`);
      for (const p of partialFilesWritten) {
        try { fs.unlinkSync(p); } catch (e) { console.warn(`  couldn't delete ${p}: ${e.message}`); }
      }
    }

    await browser.close();
  }

  console.log(`\nAll outputs: ${path.relative(process.cwd(), runDir)}`);
  return { stoppedEarly, runDir, failures: failures.length };
}

module.exports = async function main(configs) {
  for (let i = 0; i < configs.length; i++) {
    const { path: p, config } = configs[i];
    console.log(`\n======================================================`);
    console.log(`Journey ${i + 1}/${configs.length}: ${config.name || path.basename(p)}`);
    console.log(`======================================================`);
    try {
      await runJourney(config, p);
    } catch (err) {
      console.error(`Journey "${config.name}" crashed:`, err);
    }
  }
  console.log("\nAll journeys finished.");
};
