/**
 * runner-export.js
 * ------------------------------------------------------------------
 * Workbook export.
 *
 * Splits the combined in-memory workbook (one sheet per platform/step)
 * into:
 *   - One workbook per platform that captured anything, containing
 *     ONLY that platform's sheets + (if any) that platform's validation
 *     summary. Platforms with no hits get no file.
 *   - A combined <stem>_all_hits.xlsx with every sheet plus the
 *     cross-platform Summary + Validation Summary.
 * ------------------------------------------------------------------
 */

const path = require("path");
const ExcelJS = require("exceljs");
const { PLATFORMS, cleanExcelValue } = require("./runner-sheets");

function cloneSheet(src, dst) {
  src.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = dst.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);
      newCell.value = cell.value;
      if (cell.style) newCell.style = JSON.parse(JSON.stringify(cell.style));
    });
    newRow.commit();
  });
}

function addValidationSummarySheet(book, rows) {
  const vs = book.addWorksheet("Validation Summary");
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
  rows.forEach(f => {
    const r = vs.addRow(f);
    r.eachCell(c => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCCCC" } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
  });
  const idx = book.worksheets.indexOf(vs);
  if (idx > 0) {
    book.worksheets.splice(idx, 1);
    book.worksheets.splice(0, 0, vs);
  }
}

function addGlobalSummarySheet(book, globalHits) {
  if (!globalHits.length) return;
  const summarySheet = book.addWorksheet("Summary");
  const keys = Array.from(new Set(globalHits.flatMap(h => Object.keys(h))));
  summarySheet.addRow(["Param", ...globalHits.map((_, i) => `Hit ${i + 1}`)]);
  keys.forEach(k => summarySheet.addRow([k, ...globalHits.map(h => cleanExcelValue(h[k]))]));
  summarySheet.getRow(1).eachCell(c => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
  });
}

async function exportWorkbooks(wb, stem, runDir, partial, opts = {}) {
  const globalHits = opts.globalHits || [];
  const failures = opts.failures || [];
  const suffix = partial ? "_partial" : "_per_step";
  const written = [];
  const labelStr = partial ? "partial" : "final";

  // Per-platform workbooks — strict prefix match, no cross-platform bleed.
  for (const { label, fileSuffix } of PLATFORMS) {
    const prefix = `${label} Step - `;
    const matching = wb.worksheets.filter(s => s.name.startsWith(prefix));
    if (!matching.length) continue;

    const book = new ExcelJS.Workbook();
    for (const src of matching) cloneSheet(src, book.addWorksheet(src.name));

    const platformFailures = failures.filter(f => f.step.includes(`[${label}]`));
    if (platformFailures.length) addValidationSummarySheet(book, platformFailures);

    const outPath = path.join(runDir, `${stem}_${fileSuffix}${suffix}.xlsx`);
    await book.xlsx.writeFile(outPath);
    written.push(outPath);
    console.log(`Saved ${labelStr} ${label.padEnd(9)} -> ${path.relative(process.cwd(), outPath)}`);
  }

  // Combined master workbook — every per-platform sheet + global summaries.
  const combined = new ExcelJS.Workbook();
  for (const src of wb.worksheets) cloneSheet(src, combined.addWorksheet(src.name));
  addGlobalSummarySheet(combined, globalHits);
  if (failures.length) addValidationSummarySheet(combined, failures);

  const combinedPath = path.join(runDir, `${stem}_all_hits${suffix}.xlsx`);
  await combined.xlsx.writeFile(combinedPath);
  written.push(combinedPath);
  console.log(`Saved ${labelStr} ${"ALL".padEnd(9)} -> ${path.relative(process.cwd(), combinedPath)}`);

  return written;
}

module.exports = { exportWorkbooks };
