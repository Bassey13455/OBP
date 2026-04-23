/**
 * runner-sheets.js
 * Excel sheet rendering + workbook export. Kept separate from
 * runner-core.js so each file stays comfortably below the Write
 * tool's ~16KB truncation threshold.
 */

const path = require("path");
const ExcelJS = require("exceljs");

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

function renderPlatformSheet(wb, platformLabel, step, hits, rules, failures) {
  const allKeys = Array.from(new Set(hits.flatMap(h => Object.keys(h))));
  const sheet = wb.addWorksheet(sanitiseSheetName(`${platformLabel} Step - ${step.name}`));
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

function addGlobalSheets(workbook, globalHits, failures) {
  if (globalHits.length > 0) {
    const summarySheet = workbook.addWorksheet("Summary");
    const keys = Array.from(new Set(globalHits.flatMap(h => Object.keys(h))));
    summarySheet.addRow(["Param", ...globalHits.map((_, i) => `Hit ${i + 1}`)]);
    keys.forEach(k => summarySheet.addRow([k, ...globalHits.map(h => cleanExcelValue(h[k]))]));
  }
  if (failures.length > 0) {
    const vs = workbook.addWorksheet("Validation Summary");
    vs.columns = [
      { header: "Step", key: "step", width: 30 },
      { header: "Parameter", key: "parameter", width: 25 },
      { header: "Expected", key: "expected", width: 60 },
      { header: "Actual", key: "actual", width: 60 },
      { header: "Status", key: "status", width: 10 },
    ];
    vs.getRow(1).eachCell(c => {
      c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
    });
    failures.forEach(f => {
      const r = vs.addRow(f);
      r.eachCell(c => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCCCC" } };
        c.alignment = { vertical: "middle", wrapText: true };
      });
    });
    const idx = workbook.worksheets.indexOf(vs);
    if (idx > 0) {
      workbook.worksheets.splice(idx, 1);
      workbook.worksheets.splice(0, 0, vs);
    }
  }
}

async function exportWorkbooks(wb, stem, runDir, partial) {
  const adobe = new ExcelJS.Workbook();
  const ga4 = new ExcelJS.Workbook();
  const cja = new ExcelJS.Workbook();
  const cloneSheet = (src, dst) => {
    src.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const newRow = dst.getRow(rowNumber);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const newCell = newRow.getCell(colNumber);
        newCell.value = cell.value;
        if (cell.style) newCell.style = JSON.parse(JSON.stringify(cell.style));
      });
      newRow.commit();
    });
  };
  wb.worksheets.forEach(sheet => {
    if (sheet.name.includes("GA4")) cloneSheet(sheet, ga4.addWorksheet(sheet.name));
    else if (sheet.name.includes("CJA")) cloneSheet(sheet, cja.addWorksheet(sheet.name));
    else cloneSheet(sheet, adobe.addWorksheet(sheet.name));
  });
  const suffix = partial ? "_partial" : "_per_step";
  const aPath = path.join(runDir, `${stem}_adobe_hits${suffix}.xlsx`);
  const gPath = path.join(runDir, `${stem}_ga4_hits${suffix}.xlsx`);
  const cPath = path.join(runDir, `${stem}_cja_hits${suffix}.xlsx`);
  await adobe.xlsx.writeFile(aPath);
  await ga4.xlsx.writeFile(gPath);
  await cja.xlsx.writeFile(cPath);
  const label = partial ? "partial" : "final";
  console.log(`Saved ${label} Adobe -> ${path.relative(process.cwd(), aPath)}`);
  console.log(`Saved ${label} GA4   -> ${path.relative(process.cwd(), gPath)}`);
  console.log(`Saved ${label} CJA   -> ${path.relative(process.cwd(), cPath)}`);
  return [aPath, gPath, cPath];
}

module.exports = {
  sanitiseSheetName,
  cleanExcelValue,
  buildMatcher,
  renderPlatformSheet,
  addGlobalSheets,
  exportWorkbooks,
};
