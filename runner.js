/**
 * runner.js
 * -----------------------------------------------------------------
 * JSON-driven Playwright runner for the OBP journey framework.
 *
 * Usage:
 *   node runner.js                      # reads ./journey.json
 *   node runner.js path/to/journey.json # reads a specific file
 *   node runner.js checkout             # resolves to ./journeys/checkout.json
 *   node runner.js --list               # list all journeys in ./journeys/
 *   node runner.js --all                # run every .json in ./journeys/
 *   node runner.js --dry-run            # parse + validate only, no browser
 *
 * Outputs go to:
 *   hits/<journey_slug>/<YYYY-MM-DD_HH-MM-SS>/
 *     {journey}_adobe_hits_per_step.xlsx
 *     {journey}_ga4_hits_per_step.xlsx
 *     {journey}_cja_hits_per_step.xlsx
 *
 * If a step errors, partial files are written into the same run folder.
 * On successful completion they're cleaned up automatically.
 *
 * Main execution logic lives in runner-core.js. This file only handles
 * CLI args, config loading, and dry-run mode.
 * -----------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const rawArgs = process.argv.slice(2);
const FLAGS = new Set(rawArgs.filter(a => a.startsWith("--")));
const DRY_RUN = FLAGS.has("--dry-run");
const LIST = FLAGS.has("--list");
const ALL = FLAGS.has("--all");
const positional = rawArgs.find(a => !a.startsWith("--"));

const JOURNEYS_DIR = path.resolve("journeys");

function listJourneyFiles() {
  if (!fs.existsSync(JOURNEYS_DIR)) return [];
  return fs.readdirSync(JOURNEYS_DIR)
    .filter(f => f.toLowerCase().endsWith(".json"))
    .map(f => path.join(JOURNEYS_DIR, f))
    .sort();
}

function resolveJourneyArg(arg) {
  if (!arg) return path.resolve("./journey.json");
  if (fs.existsSync(arg)) return path.resolve(arg);
  const named = path.join(JOURNEYS_DIR, arg.endsWith(".json") ? arg : arg + ".json");
  if (fs.existsSync(named)) return named;
  return path.resolve(arg);
}

if (LIST) {
  const files = listJourneyFiles();
  if (!files.length) {
    console.log("No journeys found in ./journeys/");
    console.log("Tip: export JSON from journey-builder.html into ./journeys/,");
    console.log("     or run 'node runner.js' against the default ./journey.json.");
  } else {
    console.log("Available journeys (" + files.length + "):");
    files.forEach(f => {
      const name = path.basename(f, ".json");
      let stepCount = "?";
      try { stepCount = JSON.parse(fs.readFileSync(f, "utf8")).steps?.length ?? "?"; } catch {}
      console.log("  - " + name + "  (" + stepCount + " steps)  [" + path.relative(process.cwd(), f) + "]");
    });
  }
  process.exit(0);
}

const journeyPaths = ALL ? listJourneyFiles() : [resolveJourneyArg(positional)];

if (!journeyPaths.length) {
  console.error("ERROR: No journey files to run.");
  console.error("   Add one to ./journeys/ or pass a path: node runner.js path/to/file.json");
  process.exit(1);
}

for (const p of journeyPaths) {
  if (!fs.existsSync(p)) {
    console.error("ERROR: Config not found: " + p);
    console.error("   Run 'node runner.js --list' to see available journeys.");
    process.exit(1);
  }
}

function loadAndValidate(p) {
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!c || typeof c !== "object") throw new Error(p + ": config must be an object");
  if (!Array.isArray(c.steps)) throw new Error(p + ": config.steps must be an array");
  c.steps.forEach((s, i) => {
    if (!s.name) throw new Error(p + ": step " + i + " missing 'name'");
    if (!Array.isArray(s.actions)) throw new Error(p + ": step '" + s.name + "' missing actions[]");
  });
  console.log("Loaded \"" + (c.name || path.basename(p)) + "\" - " + c.steps.length + " step(s). [" + path.relative(process.cwd(), p) + "]");
  return c;
}

const configs = journeyPaths.map(p => ({ path: p, config: loadAndValidate(p) }));

if (DRY_RUN) {
  console.log("\n--dry-run: configs valid, exiting without launching a browser.");
  for (const { path: p, config } of configs) {
    console.log("\n" + (config.name || path.basename(p)));
    config.steps.forEach((s, i) => {
      const ruleCount =
        (s.validations?.adobe?.length || 0) +
        (s.validations?.ga4?.length || 0) +
        (s.validations?.cja?.length || 0);
      console.log("  " + (i + 1) + ". " + s.name + "  [" + s.actions.length + " actions, " + ruleCount + " rules]");
    });
  }
  process.exit(0);
}

const runAllJourneys = require("./runner-core");
runAllJourneys(configs).catch(err => {
  console.error("Runner crashed:", err);
  process.exit(1);
});
