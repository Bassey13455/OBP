const { chromium } = require("playwright");
const ExcelJS = require("exceljs");

const visitPage = require("./actions/visitPage");
const handleCookieBanner = require("./actions/handleCookieBanner");
const attachAdobeListener = require("./actions/captureAdobeHits");
const attachGA4Listener = require("./actions/captureGA4Hits");
const attachCJAHits = require("./actions/captureCJAHits");
const runJavascript = require("./actions/runJavascript");
const reloadPage = require("./actions/reloadPage");
const inputText = require("./actions/inputText");
const click = require("./actions/click");
const selectDropdown = require("./actions/selectDropdown");
const validationRules = require("./validations/PLPEventsValidationRules");

const adobeRules = validationRules.adobe || validationRules;
const ga4Rules = validationRules.ga4 || {};
const cjaRules = validationRules.cja || {};

// Excel sheet names can't contain : \ / ? * [ ]
function sanitiseSheetName(name) {
  return name.replace(/[:\\/?*\\[\\]]/g, "").substring(0, 31);
}

function cleanExcelValue(value) {
  if (value === null || value === undefined) return "";

  // Convert objects to JSON
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  // Force to string
  value = String(value);

  // Remove characters Excel cannot store
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
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
      console.log("\n🚨 BOT FILTER TRIGGERED! 🚨");
      console.log("Please solve the verification in the browser.");
      console.log("Press ENTER here to continue...");

      await new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", () => {
          process.stdin.pause();
          resolve();
        });
      });

      console.log("👍 Continuing automation.");
    }
  } catch (err) {
    console.log("⚠️ Failed checking bot-block state:", err);
  }
}

(async () => {
  // Launch browser
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  // Context setup
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-GB",
  });

  // Anti-bot patches
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = { runtime: {} };
    const origQuery = navigator.permissions.query;
    navigator.permissions.query = (p) =>
      p.name === "notifications"
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(p);
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-GB", "en"],
    });
  });

  const page = await context.newPage();
  const workbook = new ExcelJS.Workbook();
  let globalHits = [];
  let failures = []; // { platform, step, parameter, expected, actual, status }

  const randomDelay = async (min = 500, max = 1500) =>
    await page.waitForTimeout(min + Math.random() * (max - min));

  const runStep = async (step) => {
    console.log(`Running step: ${step.name}`);

    const adobeHits = [];
    const ga4Hits = [];
    const cjaHits = [];

    // Attach listeners fresh for this step
    attachAdobeListener(page, adobeHits);
    attachGA4Listener(page, ga4Hits);
    attachCJAHits(page, cjaHits);

    let didNavigate = false;
    const navigationPromise = page
      .waitForNavigation({ timeout: 5000 })
      .then(
        () => {
          didNavigate = true;
        },
        () => {}
      );

    await step.action();
    await navigationPromise.catch(() => {});
    await checkForBotBlock(page);

    if (!didNavigate) {
      try {
        await page.evaluate(() => window.scrollBy(0, 100));
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollBy(0, -100));
        await page.waitForTimeout(500);
      } catch (err) {
        console.log("Skipping scrolls (page context changed).");
      }
    }
    await checkForBotBlock(page);

    await page.waitForTimeout(8000);
    await checkForBotBlock(page);

// Small buffer for analytics calls that fire late
await page.waitForTimeout(1000);

// Rebuild hit arrays AFTER the wait
const adobeCaptured = [...adobeHits];
const ga4Captured = [...ga4Hits];
const cjaCaptured = [...cjaHits];
const stepCaptured = [...adobeCaptured, ...ga4Captured, ...cjaCaptured];

console.log("adobeCaptured.length:", adobeCaptured.length);
console.log("ga4Captured.length:", ga4Captured.length);
console.log("cjaCaptured.length:", cjaCaptured.length);

if (stepCaptured.length === 0) {
  console.log(`⚠️ WARNING: No hits captured for step: ${step.name}, creating sheet anyway.`);
} else {
  console.log(`📊 Captured ${stepCaptured.length} hits for step: ${step.name}`);
}

// Add ALL captured hits to global summary (AFTER WAIT!)
globalHits.push(...stepCaptured);


    // Helper to build per-platform sheet (Adobe / GA4 / CJA) for this step
    const createSheetForPlatform = (platformLabel, platformHits) => {
      if (!platformHits || platformHits.length === 0) return;

      const allKeys = Array.from(
        new Set(platformHits.flatMap((hit) => Object.keys(hit)))
      );

      const sheetNameBase = `${platformLabel} Step - ${step.name}`;
      const sheet = workbook.addWorksheet(sanitiseSheetName(sheetNameBase));

      const stepRule =
        platformLabel === "ADOBE"
          ? adobeRules[step.name]
          : platformLabel === "GA4"
          ? ga4Rules[step.name]
          : platformLabel === "CJA"
          ? cjaRules[step.name]
          : null;

      // Header row (FIXED: must pass an array)
      sheet.addRow(["Param", ...platformHits.map((_, i) => `Hit ${i + 1}`)]);

      // Header styling
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDDDDDD" }, // light grey
        };
      });

      // Data rows with colouring based on simple per-param rule (first expectedHits entry)
      allKeys.forEach((key) => {
        const rowValues = [key];
        platformHits.forEach((hit) => rowValues.push(cleanExcelValue(hit[key])));
        const newRow = sheet.addRow(rowValues);

        // Use rules for ALL platforms (Adobe, GA4, CJA)
        const expected = stepRule?.expectedHits?.[0]?.[key];

        let isPass = false;

        if (expected !== undefined) {
          const actualValues = platformHits
            .map((hit) => hit[key] ?? "")
            .join(" | ");

          if (Array.isArray(expected)) {
            isPass = expected.every((exp) =>
              actualValues.match(
                exp instanceof RegExp ? exp : new RegExp(exp, "i")
              )
            );
          } else if (expected instanceof RegExp) {
            isPass = expected.test(actualValues);
          } else {
            isPass = actualValues.includes(expected);
          }
        } else {
          // No rule → treat as pass (keep green)
          isPass = true;
        }

        const fillColor = isPass ? "FFDFFFD6" : "FFFFCCCC"; // green / red
        newRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: fillColor },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFCCCCCC" } },
            bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
            left: { style: "thin", color: { argb: "FFCCCCCC" } },
            right: { style: "thin", color: { argb: "FFCCCCCC" } },
          };
        });
      });

      // Full validation block using expectedHits across all params
      if (stepRule && stepRule.expectedHits) {
        let allPass = true;

        for (const expected of stepRule.expectedHits) {
          for (const [param, expectedValue] of Object.entries(expected)) {
            const allActualValues = platformHits
              .map((hit) => hit[param])
              .filter((v) => v !== undefined);

            let paramPass = false;

            if (Array.isArray(expectedValue)) {
              // Must match all patterns across any hit
              paramPass = expectedValue.every((regex) =>
                allActualValues.some((val) =>
                  regex instanceof RegExp
                    ? regex.test(String(val))
                    : String(val) === String(regex)
                )
              );
            } else if (expectedValue instanceof RegExp) {
              paramPass = allActualValues.some((val) =>
                expectedValue.test(String(val))
              );
            } else {
              paramPass = allActualValues.includes(String(expectedValue));
            }

            const row = sheet.addRow({
              Step: step.name,
              Parameter: param,
              Expected: Array.isArray(expectedValue)
                ? expectedValue.map(String).join(", ")
                : String(expectedValue),
              Actual: cleanExcelValue(allActualValues.join(" | ")),
              Status: paramPass ? "Pass" : "Fail",
            });

            const fillColor = paramPass ? "FFDFFFD6" : "FFFFCCCC";
            row.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: fillColor },
              };
              cell.border = {
                top: { style: "thin", color: { argb: "FFCCCCCC" } },
                bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
                left: { style: "thin", color: { argb: "FFCCCCCC" } },
                right: { style: "thin", color: { argb: "FFCCCCCC" } },
              };
            });

            if (!paramPass) {
              allPass = false;
              failures.push({
                platform: platformLabel,
                step: step.name,
                parameter: param,
                expected: Array.isArray(expectedValue)
                  ? expectedValue.map(String).join(", ")
                  : String(expectedValue),
                actual: cleanExcelValue(allActualValues.join(" | ")),
                status: "Fail",
              });
            }
          }
        }

        // Per-step summary row for this platform
        const summaryRow = sheet.addRow({
          Step: `${step.name} [${platformLabel}]`,
          Status: allPass ? "Pass" : "Fail",
        });
        summaryRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: allPass ? "FFDFFFD6" : "FFFFCCCC" },
          };
          cell.font = { bold: true };
        });
      }
    };

    // Create one sheet per platform per step
    createSheetForPlatform("ADOBE", adobeCaptured);
    createSheetForPlatform("GA4", ga4Captured);
    createSheetForPlatform("CJA", cjaCaptured);
  };

  // Define steps (journey unchanged, plus Alloy debug step)
  const steps = [
    {
      name: "Manual Human Confirmation",
      action: async () => {
        await visitPage(
          page,
          "https://storefront:rldev@development-tw.sfcc-ralphlauren-as.com/"
        );
        console.log(
          "\n=== Please complete the 'Press & Hold' verification manually ==="
        );
        console.log("Press ENTER here to continue...");
        await new Promise((resolve) => {
          process.stdin.resume();
          process.stdin.once("data", () => {
            process.stdin.pause();
            resolve();
          });
        });
        await page.waitForTimeout(2000);
      },
    },
    {
      name: "Enable Alloy Debug",
      action: async () => {
        await runJavascript(page, () => {
          try {
            if (window.alloy) {
              window.alloy("setDebug", { enabled: true });
            } else if (window.adobe && window.adobe.alloy) {
              window.adobe.alloy("setDebug", { enabled: true });
            }
          } catch (e) {
            // swallow
          }
        });
        console.log("✅ Enabled Alloy debug");
        await page.waitForTimeout(1000);
      },
    },
    {
      name: "Reload Home Page",
      action: async () => {
        await reloadPage(page);
        await handleCookieBanner(page);
        await reloadPage(page);
        await randomDelay();
        console.log("✅ Finished Reload Home Page step");
      },
    },
    {
      name: "Navigate to PLP",
      action: async () => {
        await visitPage(page, "https://development-tw.sfcc-ralphlauren-as.com/zh/men/clothing/polo-shirts");
        await randomDelay();
        console.log("✅ Finished Navigate to PLP step");
      }
    },
    {
      name: "Click Product Filter",
      action: async () => {
        await click(page, "a.js-refinement-option");
        console.log("✅ Finished Click Product Filter step");
      }
    },
    {
      name: "Click Refinement Filter",
      action: async () => {
        await click(page, ".show-refine-bar");
        console.log("✅ Finished Click Refinement Filter step");
      }
    },
    {
      name: "Sort PLP",
      action: async () => {
        await click(page, "button.sorting-options-btn");
        console.log("✅ Finished Sort PLP step");
      }
    },
    {
      name: "Go to Sales PLP",
      action: async () => {
        await visitPage(page, "https://development-tw.sfcc-ralphlauren-as.com/zh/sale/shop-all");
        await randomDelay();
        console.log("✅ Finished Go to Sales PLP step");

      }
    },
    {
      name: "Click View More Button",
      action: async () => {
        await click(page, "a.more-button");
        console.log("✅ Finished Click View More Button step");
      }
    }
  ];
  //// END steps

  // Run all steps
  for (const step of steps) {
    console.log(`\n===== Starting Step: ${step.name} =====`);

    try {
      await runStep(step);
    } catch (err) {
      console.error(`\n❌ ERROR during step: ${step.name}`);
      console.error(err);

      console.log("\n📦 Exporting partial results before stopping...");

      await exportPartialResults(workbook);

      console.log("\n❓ Continue to next step? (y/n)");

      const answer = await new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", (d) => {
          process.stdin.pause();
          resolve(String(d).trim().toLowerCase());
        });
      });

      if (answer !== "y") {
        console.log("🛑 Stopping test early.");
        await browser.close();
        process.exit(0);
      }

      console.log("➡️ Continuing to next step...");
    }
  }

  // Final summary sheet (all hits mixed, Adobe + GA4 + CJA)
  if (globalHits.length > 0) {
    const summarySheet = workbook.addWorksheet("Summary");
    const summaryKeys = Array.from(
      new Set(globalHits.flatMap((hit) => Object.keys(hit)))
    );
    summarySheet.addRow(["Param", ...globalHits.map((_, i) => `Hit ${i + 1}`)]);
    summaryKeys.forEach((key) => {
      summarySheet.addRow([
        key,
        ...globalHits.map((hit) => cleanExcelValue(hit[key])),
      ]);
    });
  }

  // Build separate validation workbook with Adobe / GA4 / CJA tabs
  if (failures.length > 0) {
    console.log(`\n❌ ${failures.length} validation issues found.`);

    const validationWorkbook = new ExcelJS.Workbook();

    const adobeSheet = validationWorkbook.addWorksheet("Adobe");
    const ga4Sheet = validationWorkbook.addWorksheet("GA4");
    const cjaSheet = validationWorkbook.addWorksheet("CJA");

    function setupValidationSheet(sheet) {
      sheet.columns = [
        { header: "Platform", key: "platform", width: 10 },
        { header: "Step", key: "step", width: 30 },
        { header: "Parameter", key: "parameter", width: 25 },
        { header: "Expected", key: "expected", width: 60 },
        { header: "Actual", key: "actual", width: 60 },
        { header: "Status", key: "status", width: 10 },
      ];
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDDDDDD" },
        };
      });
    }

    setupValidationSheet(adobeSheet);
    setupValidationSheet(ga4Sheet);
    setupValidationSheet(cjaSheet);

    failures.forEach((fail) => {
      let sheet;
      if (fail.platform === "ADOBE") sheet = adobeSheet;
      else if (fail.platform === "GA4") sheet = ga4Sheet;
      else if (fail.platform === "CJA") sheet = cjaSheet;
      else return;

      const row = sheet.addRow(fail);
      // EXTREMELY IMPORTANT: failures are red
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFCCCC" },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });

    await validationWorkbook.xlsx.writeFile(
      "PLPEvents_validation_summary.xlsx"
    );
    console.log(
      "💾 Saved Validation Summary → PLPEvents_validation_summary.xlsx"
    );
  }

  // Split workbook into Adobe vs GA4 vs CJA files
  const adobeWorkbook = new ExcelJS.Workbook();
  const ga4Workbook = new ExcelJS.Workbook();
  const cjaWorkbook = new ExcelJS.Workbook();

  function cloneSheetSafe(sourceSheet, targetSheet) {
    sourceSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const newRow = targetSheet.getRow(rowNumber);

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const newCell = newRow.getCell(colNumber);
        newCell.value = cell.value;

        // Copy style safely (includes red/green from validation rows)
        if (cell.style) {
          newCell.style = JSON.parse(JSON.stringify(cell.style));
        }
      });

      newRow.commit();
    });
  }

  workbook.worksheets.forEach((sheet) => {
    if (sheet.name.includes("GA4")) {
      const newSheet = ga4Workbook.addWorksheet(sheet.name);
      cloneSheetSafe(sheet, newSheet);
    } else if (sheet.name.includes("CJA")) {
      const newSheet = cjaWorkbook.addWorksheet(sheet.name);
      cloneSheetSafe(sheet, newSheet);
    } else {
      const newSheet = adobeWorkbook.addWorksheet(sheet.name);
      cloneSheetSafe(sheet, newSheet);
    }
  });

  await adobeWorkbook.xlsx.writeFile("PLPEvents_adobe_hits_per_step.xlsx");
  await ga4Workbook.xlsx.writeFile("PLPEvents_ga4_hits_per_step.xlsx");
  await cjaWorkbook.xlsx.writeFile("PLPEvents_cja_hits_per_step.xlsx");

  console.log("💾 Saved Adobe → PLPEvents_adobe_hits_per_step.xlsx");
  console.log("💾 Saved GA4 → PLPEvents_ga4_hits_per_step.xlsx");
  console.log("💾 Saved CJA → PLPEvents_cja_hits_per_step.xlsx");

  await browser.close();
})();

// Partial export used on step errors
async function exportPartialResults(workbook) {
  const ExcelJS = require("exceljs");

  const adobeWorkbook = new ExcelJS.Workbook();
  const ga4Workbook = new ExcelJS.Workbook();
  const cjaWorkbook = new ExcelJS.Workbook();

  function cloneSheetSafe(sourceSheet, targetSheet) {
    sourceSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const newRow = targetSheet.getRow(rowNumber);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const newCell = newRow.getCell(colNumber);
        newCell.value = cell.value;
        if (cell.style) {
          newCell.style = JSON.parse(JSON.stringify(cell.style));
        }
      });
      newRow.commit();
    });
  }

  workbook.worksheets.forEach((sheet) => {
    if (sheet.name.includes("GA4")) {
      const newSheet = ga4Workbook.addWorksheet(sheet.name);
      cloneSheetSafe(sheet, newSheet);
    } else if (sheet.name.includes("CJA")) {
      const newSheet = cjaWorkbook.addWorksheet(sheet.name);
      cloneSheetSafe(sheet, newSheet);
    } else {
      const newSheet = adobeWorkbook.addWorksheet(sheet.name);
      cloneSheetSafe(sheet, newSheet);
    }
  });

  await adobeWorkbook.xlsx.writeFile("PLPEvents_adobe_hits_partial.xlsx");
  await ga4Workbook.xlsx.writeFile("PLPEvents_ga4_hits_partial.xlsx");
  await cjaWorkbook.xlsx.writeFile("PLPEvents_cja_hits_partial.xlsx");

  console.log("💾 Saved partial Adobe → PLPEvents_adobe_hits_partial.xlsx");
  console.log("💾 Saved partial GA4 → PLPEvents_ga4_hits_partial.xlsx");
  console.log("💾 Saved partial CJA → PLPEvents_cja_hits_partial.xlsx");
}
