/**
 * runner-core.js
 * Main journey execution loop. Invoked by runner.js with a list of
 * loaded configs. Sheet rendering and workbook export live in
 * runner-sheets.js so each file stays under the Write size limit.
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

const sheets = require("./runner-sheets");
const { cleanExcelValue, renderPlatformSheet, addGlobalSheets, exportWorkbooks } = sheets;

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

async function checkForBotBlock(page) {
  try {
    const title = await page.title();
    const html = await page.content();
    if (
      title.includes("Access to this page has been denied") ||
      html.includes("Access to this page has been denied") ||
      html.includes("Press & Hold") ||
      html.includes("press-and-hold")
    ) {
      console.log("\n!! BOT FILTER TRIGGERED !!");
      console.log("Please solve the verification in the browser, then press ENTER here...");
      await waitForEnter();
      console.log("Continuing automation.");
    }
  } catch (err) {
    console.log("Failed checking bot-block state:", err.message);
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

  const browser = await chromium.launch({
    headless: !!browserCfg.headless,
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
    const adobeHits = [];
    const ga4Hits = [];
    const cjaHits = [];
    attachAdobeListener(page, adobeHits);
    attachGA4Listener(page, ga4Hits);
    attachCJAHits(page, cjaHits);

    let didNavigate = false;
    const navP = page.waitForNavigation({ timeout: 5000 })
      .then(() => { didNavigate = true; }, () => {});

    for (const act of step.actions) await runAction(page, act);
    await navP.catch(() => {});
    await checkForBotBlock(page);

    if (!didNavigate) {
      try {
        await page.evaluate(() => window.scrollBy(0, 100));
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollBy(0, -100));
        await page.waitForTimeout(500);
      } catch { /* page may have navigated */ }
    }
    await checkForBotBlock(page);
    await page.waitForTimeout(8000);
    await checkForBotBlock(page);

    globalHits.push(...adobeHits, ...ga4Hits, ...cjaHits);

    const platformMap = {
      ADOBE: { hits: adobeHits, rules: step.validations?.adobe || [] },
      GA4:   { hits: ga4Hits,   rules: step.validations?.ga4   || [] },
      CJA:   { hits: cjaHits,   rules: step.validations?.cja   || [] },
    };
    for (const [label, { hits, rules }] of Object.entries(platformMap)) {
      if (!hits.length) continue;
      renderPlatformSheet(workbook, label, step, hits, rules, failures);
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
      const written = await exportWorkbooks(workbook, stem, runDir, true);
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
    addGlobalSheets(workbook, globalHits, failures);
    if (failures.length > 0) console.log(`\n${failures.length} validation issues found.`);

    await exportWorkbooks(workbook, stem, runDir, false);

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
