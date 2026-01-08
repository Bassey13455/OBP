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
const validationRules = require("./validations/validationRules");

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
  let failures = [];

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


    // Store all hits for global summary
    globalHits.push(...adobeHits, ...ga4Hits, ...cjaHits);

    const adobeCaptured = adobeHits;
    const ga4Captured = ga4Hits;
    const cjaCaptured = cjaHits;
    const stepCaptured = [...adobeHits, ...ga4Hits, ...cjaHits];

    if (stepCaptured.length === 0) {
      console.log(`No hits found for step: ${step.name}`);
      return;
    }

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

      // Header row
      sheet.addRow("Param", ...platformHits.map((_, i) => `Hit ${i + 1}`));

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

        // At the moment we only validate Adobe hits, but structure allows GA4/CJA rules later
        const expected =
          platformLabel === "ADOBE"
            ? stepRule?.expectedHits?.[0]?.[key]
            : undefined;

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
      // Currently only Adobe has active rules; GA4/CJA reserved for future.
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
                step: `${step.name} [${platformLabel}]`,
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
        await visitPage(page, "https://storefront:rldev@development-tw.sfcc-ralphlauren-as.com/");
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
      },
    },
    {
      name: "Run JS Navigation & Click",
      action: async () => {
        await handleCookieBanner(page);
        await randomDelay();
        await Promise.all([
          page.waitForNavigation({ waitUntil: "load" }),
          runJavascript(page, () => {
            const menLink = document.querySelector(
              "#navigation ul.menu-category.level-1 li.nav-item a.desktop-only[data-cgid='men']"
            );
            if (menLink)
              menLink.dispatchEvent(
                new MouseEvent("mouseover", { bubbles: true })
              );
            const subLink = document.querySelectorAll(
              'a[data-cgid="men|clothing|men-clothing-poloshirts"]'
            )[0];
            if (subLink) subLink.click();
          }),
        ]);
        console.log("✅ Finished JS Navigation & Click step");
      },
    },
    {
      name: "Go to PLP",
      action: async () => {
        await visitPage(
          page,
          "https://development-tw.sfcc-ralphlauren-as.com/zh/men/clothing/polo-shirts"
        );
      },
    },
    {
      name: "Add to Wishlist",
      action: async () => {
        await click(page, "a.save-To-favorites");
        console.log("✅ Finished Add to Wishlist step");
      }
    },
    {
      name: "Click First Product",
      action: async () => {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "load" }),
          runJavascript(page, () => {
            document
              .querySelector(
                "div.grid-tile[data-position='3'] div.product-image a.thumb-link"
              )
              .click();
          }),
        ]);
        console.log("✅ Finished Click First Product step");
      },
    },
    {
      name: "Select First Colour",
      action: async () => {
        await runJavascript(page, () => {
          const el = document.querySelector(
            "ul.swatches.colorname li.selectable:not(.out) a"
          );
          if (el) el.click();
        });
        console.log("✅ Finished Select First Colour step");
      },
    },
    {
      name: "Select Second Size",
      action: async () => {
        await runJavascript(page, () => {
          const el = document.querySelector(
            "ul.swatches.primarysize li.selectable:not(.out):nth-child(2) a"
          );
          if (el) {
            el.dispatchEvent(new Event("mousedown"));
            el.click();
          }
        });
        console.log("✅ Finished Select Second Size step");
      },
    },
    {
      name: "Add to Cart",
      action: async () => {
        await runJavascript(page, () => {
          const btn = document.querySelector("#add-to-cart");
          if (btn) btn.click();
        });
        console.log("✅ Finished Add to Cart step");
      },
    },
    {
      name: "Click Quick Shop",
      action: async () => {
        click(page, "a.is-quick-shoppable");
        console.log("✅ Finished Click Quick Shop step");
      }
    },
    {
      name: "Click Mini Cart Link Load Cart Page",
      action: async () => {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "load" }),
          runJavascript(page, () => {
            document.querySelector("a.mini-cart-link").click();
          }),
        ]);
        console.log("✅ Finished Click Mini Cart Link Load Cart Page step");
      },
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

  // Validation Summary (only if there were failures)
  if (failures.length > 0) {
    console.log(`\n❌ ${failures.length} validation issues found.`);

    const summarySheet = workbook.addWorksheet("Validation Summary");

    // Define columns
    summarySheet.columns = [
      { header: "Step", key: "step", width: 30 },
      { header: "Parameter", key: "parameter", width: 25 },
      { header: "Expected", key: "expected", width: 60 },
      { header: "Actual", key: "actual", width: 60 },
      { header: "Status", key: "status", width: 10 },
    ];

    // Header styling
    summarySheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDDDDDD" },
      };
    });

    failures.forEach((fail) => {
      const row = summarySheet.addRow(fail);
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFCCCC" }, // red for failures
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });

    // Move "Validation Summary" to be first tab
    const vsSheet = workbook.getWorksheet("Validation Summary");
    const idx = workbook.worksheets.indexOf(vsSheet);
    if (idx > 0) {
      workbook.worksheets.splice(idx, 1);
      workbook.worksheets.splice(0, 0, vsSheet);
    }
  }


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

  await adobeWorkbook.xlsx.writeFile("index_adobe_hits_partial.xlsx");
  await ga4Workbook.xlsx.writeFile("index_ga4_hits_partial.xlsx");
  await cjaWorkbook.xlsx.writeFile("index_cja_hits_partial.xlsx");

  console.log("💾 Saved partial Adobe → index_adobe_hits_partial.xlsx");
  console.log("💾 Saved partial GA4 → index_ga4_hits_partial.xlsx");
  console.log("💾 Saved partial CJA → index_cja_hits_partial.xlsx");
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

        // Copy style safely
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

  await adobeWorkbook.xlsx.writeFile("index_adobe_hits_per_step.xlsx");
  await ga4Workbook.xlsx.writeFile("index_ga4_hits_per_step.xlsx");
  await cjaWorkbook.xlsx.writeFile("index_cja_hits_per_step.xlsx");

  console.log("💾 Saved Adobe → index_adobe_hits_per_step.xlsx");
  console.log("💾 Saved GA4 → index_ga4_hits_per_step.xlsx");
  console.log("💾 Saved CJA → index_cja_hits_per_step.xlsx");
  await browser.close();
})();
