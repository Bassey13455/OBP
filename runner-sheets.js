/**
 * runner-sheets.js
 * ------------------------------------------------------------------
 * Sheet rendering + shared helpers. Multi-platform aware.
 *
 * Per-step sheets are named "<LABEL> Step - <stepName>" so the export
 * layer (runner-export.js) can route them to the right per-platform
 * workbook without any cross-platform bleed.
 *
 * Adding a new pixel = append to PLATFORMS and wire it in runner-core.
 * ------------------------------------------------------------------
 */

const PLATFORMS = [
  { label: "ADOBE",     fileSuffix: "adobe_hits" },
  { label: "GA4",       fileSuffix: "ga4_hits" },
  { label: "CJA",       fileSuffix: "cja_hits" },
  { label: "META",      fileSuffix: "meta_hits" },
  { label: "TIKTOK",    fileSuffix: "tiktok_hits" },
  { label: "SNAPCHAT",  fileSuffix: "snapchat_hits" },
  { label: "PINTEREST", fileSuffix: "pinterest_hits" },
  { label: "GOOGLEADS", fileSuffix: "googleads_hits" },
];

function sanitiseSheetName(n) {
  return String(n || "").replace(/[:\\/?*\[\]]/g, "").substring(0, 31);
}
function cleanExcelValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") { try { return JSON.stringify(v); } catch { return ""; } }
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
function buildMatcher(rule) {
  const flags = rule.flags || "i";
  if (rule.type === "regex") {
    const re = new RegExp(rule.expected, flags);
    return (actuals) => actuals.some(v => re.test(String(v)));
  }
  if (rule.type === "regexAll") {
    const arr = Array.isArray(rule.expected)
      ? rule.expected
      : String(rule.expected || "").split("|").filter(Boolean);
    const regs = arr.map(p => new RegExp(p, flags));
    return (actuals) => regs.every(re => actuals.some(v => re.test(String(v))));
  }
  const needle = String(rule.expected ?? "");
  return (actuals) => actuals.some(v => String(v).includes(needle));
}

function stepSheetName(platformLabel, stepName) {
  return sanitiseSheetName(`${platformLabel} Step - ${stepName}`);
}

function renderPlatformSheet(wb, platformLabel, step, hits, rules, failures) {
  const allKeys = Array.from(new Set(hits.flatMap(h => Object.keys(h))));
  const sheet = wb.addWorksheet(stepSheetName(platformLabel, step.name));
  sheet.addRow(["Param", ...hits.map((_, i) => `Hit ${i + 1}`)]);
  sheet.getRow(1).eachCell(c => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
  });

  const ruleByParam = Object.fromEntries((rules || []).map(r => [r.param, r]));
  allKeys.forEach(key => {
    const rowVals = [key, ...hits.map(h => cleanExcelValue(h[key]))];
    const newRow = sheet.addRow(rowVals);
    let isPass = true;
    const rule = ruleByParam[key];
    if (rule) isPass = buildMatcher(rule)(hits.map(h => h[key] ?? ""));
    const fg = isPass ? "FFDFFFD6" : "FFFFCCCC";
    newRow.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fg } };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCCCCCC" } },
        bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        left: { style: "thin", color: { argb: "FFCCCCCC" } },
        right: { style: "thin", color: { argb: "FFCCCCCC" } },
      };
    });
  });

  if (!rules || !rules.length) return;
  let allPass = true;
  sheet.addRow([]);
  const headerRow = sheet.addRow(["Parameter", "Expected", "Actual", "Status"]);
  headerRow.font = { bold: true };
  rules.forEach(rule => {
    const actuals = hits.map(h => h[rule.param]).filter(v => v !== undefined);
    const paramPass = buildMatcher(rule)(actuals);
    const row = sheet.addRow([
      rule.param,
      Array.isArray(rule.expected) ? rule.expected.join(", ") : String(rule.expected),
      cleanExcelValue(actuals.join(" | ")),
      paramPass ? "Pass" : "Fail",
    ]);
    const fg = paramPass ? "FFDFFFD6" : "FFFFCCCC";
    row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fg } }; });
    if (!paramPass) {
      allPass = false;
      failures.push({
        step: `${step.name} [${platformLabel}]`,
        parameter: rule.param,
        expected: Array.isArray(rule.expected) ? rule.expected.join(", ") : String(rule.expected),
        actual: cleanExcelValue(actuals.join(" | ")),
        status: "Fail",
      });
    }
  });
  const summaryRow = sheet.addRow([`${step.name} [${platformLabel}]`, "", "", allPass ? "Pass" : "Fail"]);
  summaryRow.eachCell(c => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: allPass ? "FFDFFFD6" : "FFFFCCCC" } };
  });
}

// No-op for backward compatibility. Global Summary / Validation Summary now
// live inside exportWorkbooks so they only appear in the combined master file.
function addGlobalSheets() { /* no-op */ }

module.exports = {
  PLATFORMS,
  sanitiseSheetName,
  cleanExcelValue,
  buildMatcher,
  stepSheetName,
  renderPlatformSheet,
  addGlobalSheets,
};
