/**
 * server.js
 * ------------------------------------------------------------------
 * Tiny native-Node companion server for journey-builder.html.
 * Lets the builder:
 *   - list / load / save journeys (./journeys/*.json)
 *   - kick off a run (spawns runner.js as a child process)
 *   - stream logs via SSE
 *   - browse + download output files in ./hits/
 *
 * No new npm deps; only built-in modules.
 * Default port 5173, override with PORT env var.
 * ------------------------------------------------------------------
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 5173;
const ROOT = __dirname;
const JOURNEYS_DIR = path.join(ROOT, "journeys");
const HITS_DIR = path.join(ROOT, "hits");

if (!fs.existsSync(JOURNEYS_DIR)) fs.mkdirSync(JOURNEYS_DIR, { recursive: true });
if (!fs.existsSync(HITS_DIR))     fs.mkdirSync(HITS_DIR, { recursive: true });

// In-memory run registry. Each entry:
// { id, journey, startedAt, done, exitCode, logs: string[], subscribers: Set<res>, runDir, child }
const runs = new Map();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(text);
}

function serveFile(res, absPath, fallbackType = "application/octet-stream") {
  fs.stat(absPath, (err, stat) => {
    if (err) return sendText(res, 404, "Not found");
    const ext = path.extname(absPath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js":   "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".css":  "text/css; charset=utf-8",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".png":  "image/png",
      ".svg":  "image/svg+xml",
    };
    res.writeHead(200, {
      "Content-Type": types[ext] || fallbackType,
      "Content-Length": stat.size,
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(absPath).pipe(res);
  });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeJourneyName(name) {
  return String(name || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
}

/* ------------------------------------------------------------------ */
/*  API handlers                                                      */
/* ------------------------------------------------------------------ */

function apiPing(req, res) {
  sendJson(res, 200, { ok: true, service: "obp-server", version: "1.0.0", cwd: ROOT });
}

function apiListJourneys(req, res) {
  const files = fs.readdirSync(JOURNEYS_DIR).filter(f => f.toLowerCase().endsWith(".json")).sort();
  const list = files.map(f => {
    const p = path.join(JOURNEYS_DIR, f);
    let name = f.replace(/\.json$/i, "");
    let steps = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      if (parsed && parsed.name) name = parsed.name;
      if (Array.isArray(parsed?.steps)) steps = parsed.steps.length;
    } catch { /* corrupt file — still list */ }
    return { file: f, slug: f.replace(/\.json$/i, ""), name, steps };
  });
  sendJson(res, 200, { journeys: list });
}

function apiGetJourney(req, res, slug) {
  const safe = safeJourneyName(slug);
  if (!safe) return sendText(res, 400, "Invalid name");
  const p = path.join(JOURNEYS_DIR, safe + ".json");
  if (!fs.existsSync(p)) return sendText(res, 404, "Not found");
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  fs.createReadStream(p).pipe(res);
}

async function apiSaveJourney(req, res, slug) {
  const safe = safeJourneyName(slug);
  if (!safe) return sendText(res, 400, "Invalid name");
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.steps)) throw new Error("Journey missing steps[]");
    const outPath = path.join(JOURNEYS_DIR, safe + ".json");
    fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
    sendJson(res, 200, { ok: true, file: path.basename(outPath) });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
  }
}

/* ------------------------------------------------------------------ */
/*  Run management                                                     */
/* ------------------------------------------------------------------ */

async function apiStartRun(req, res) {
  try {
    const body = await readBody(req);
    const parsed = body ? JSON.parse(body) : {};
    const slug = safeJourneyName(parsed.slug);
    if (!slug) return sendJson(res, 400, { ok: false, error: "Missing slug" });
    const p = path.join(JOURNEYS_DIR, slug + ".json");
    if (!fs.existsSync(p)) return sendJson(res, 404, { ok: false, error: "Journey not found" });

    // `headed` controls whether Chromium is visible during the run.
    //   true  -> visible window   (OBP_HEADLESS=0)
    //   false -> background only  (OBP_HEADLESS=1)
    //   undefined -> let the journey JSON decide
    const headedSpecified = typeof parsed.headed === "boolean";
    const runEnv = { ...process.env, FORCE_COLOR: "0" };
    if (headedSpecified) runEnv.OBP_HEADLESS = parsed.headed ? "0" : "1";

    const id = crypto.randomBytes(6).toString("hex");
    const run = {
      id,
      slug,
      startedAt: Date.now(),
      done: false,
      exitCode: null,
      logs: [],
      subscribers: new Set(),
      runDir: null,
      child: null,
    };
    runs.set(id, run);

    // Spawn runner.js <slug>. We use node to avoid PATH issues with npm scripts.
    const child = spawn(process.execPath, ["runner.js", slug], {
      cwd: ROOT,
      env: runEnv,
    });
    run.child = child;

    const push = (type, line) => {
      const entry = { t: Date.now(), type, line };
      run.logs.push(entry);
      // Keep log buffer bounded
      if (run.logs.length > 5000) run.logs.splice(0, run.logs.length - 5000);
      for (const sub of run.subscribers) {
        try { sub.write(`data: ${JSON.stringify(entry)}\n\n`); } catch { /* ignore */ }
      }
      // Detect the run output folder from the known log line
      const m = typeof line === "string" && line.match(/Run output folder:\s*(.+)\s*$/);
      if (m && !run.runDir) run.runDir = m[1].trim();
    };

    const lineBuf = { out: "", err: "" };
    const feed = (stream, data) => {
      lineBuf[stream] += data.toString();
      let idx;
      while ((idx = lineBuf[stream].indexOf("\n")) >= 0) {
        const line = lineBuf[stream].slice(0, idx).replace(/\r$/, "");
        lineBuf[stream] = lineBuf[stream].slice(idx + 1);
        push(stream === "out" ? "stdout" : "stderr", line);
      }
    };
    child.stdout.on("data", d => feed("out", d));
    child.stderr.on("data", d => feed("err", d));
    child.on("close", code => {
      if (lineBuf.out) push("stdout", lineBuf.out); lineBuf.out = "";
      if (lineBuf.err) push("stderr", lineBuf.err); lineBuf.err = "";
      run.exitCode = code;
      run.done = true;
      const final = { t: Date.now(), type: "done", exitCode: code, runDir: run.runDir, files: listRunFiles(run.runDir) };
      for (const sub of run.subscribers) {
        try {
          sub.write(`data: ${JSON.stringify(final)}\n\n`);
          sub.end();
        } catch { /* ignore */ }
      }
      run.subscribers.clear();
    });

    sendJson(res, 200, { ok: true, id });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

function listRunFiles(runDir) {
  if (!runDir) return [];
  const abs = path.isAbsolute(runDir) ? runDir : path.join(ROOT, runDir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter(f => f.toLowerCase().endsWith(".xlsx"))
    .sort()
    .map(f => ({ name: f, relative: path.relative(ROOT, path.join(abs, f)).replace(/\\/g, "/") }));
}

function apiStreamRun(req, res, id) {
  const run = runs.get(id);
  if (!run) return sendText(res, 404, "Unknown run");
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  // Replay buffered logs
  for (const entry of run.logs) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  if (run.done) {
    const final = { t: Date.now(), type: "done", exitCode: run.exitCode, runDir: run.runDir, files: listRunFiles(run.runDir) };
    res.write(`data: ${JSON.stringify(final)}\n\n`);
    res.end();
    return;
  }
  run.subscribers.add(res);
  req.on("close", () => run.subscribers.delete(res));
}

function apiStopRun(req, res, id) {
  const run = runs.get(id);
  if (!run) return sendJson(res, 404, { ok: false, error: "Unknown run" });
  if (run.done) return sendJson(res, 200, { ok: true, already: true });
  try { run.child.kill("SIGTERM"); } catch { /* ignore */ }
  sendJson(res, 200, { ok: true });
}

function apiListRuns(req, res) {
  const list = [...runs.values()].map(r => ({
    id: r.id,
    slug: r.slug,
    startedAt: r.startedAt,
    done: r.done,
    exitCode: r.exitCode,
    runDir: r.runDir,
    lines: r.logs.length,
  })).sort((a, b) => b.startedAt - a.startedAt);
  sendJson(res, 200, { runs: list });
}

function serveHitsFile(res, relPath) {
  // Prevent escaping the hits dir
  const normalised = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.join(ROOT, normalised);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return sendText(res, 403, "Forbidden");
  serveFile(res, abs);
}

/* ------------------------------------------------------------------ */
/*  Router                                                            */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = u.pathname;

  try {
    if (req.method === "GET" && (pathname === "/" || pathname === "/journey-builder.html")) {
      return serveFile(res, path.join(ROOT, "journey-builder.html"));
    }
    if (req.method === "GET" && pathname === "/builder-server.js") {
      return serveFile(res, path.join(ROOT, "builder-server.js"));
    }
    if (req.method === "GET" && pathname === "/api/ping") return apiPing(req, res);
    if (req.method === "GET" && pathname === "/api/journeys") return apiListJourneys(req, res);

    const getJM = pathname.match(/^\/api\/journeys\/([^/]+)$/);
    if (getJM) {
      if (req.method === "GET") return apiGetJourney(req, res, getJM[1]);
      if (req.method === "POST" || req.method === "PUT") return apiSaveJourney(req, res, getJM[1]);
    }

    if (req.method === "POST" && pathname === "/api/run") return apiStartRun(req, res);
    if (req.method === "GET" && pathname === "/api/runs") return apiListRuns(req, res);

    const streamM = pathname.match(/^\/api\/runs\/([a-f0-9]+)\/stream$/);
    if (streamM && req.method === "GET") return apiStreamRun(req, res, streamM[1]);
    const stopM = pathname.match(/^\/api\/runs\/([a-f0-9]+)\/stop$/);
    if (stopM && req.method === "POST") return apiStopRun(req, res, stopM[1]);

    // Static file routes
    if (req.method === "GET" && pathname.startsWith("/hits/")) {
      return serveHitsFile(res, pathname.replace(/^\//, ""));
    }
    if (req.method === "GET" && pathname.startsWith("/actions/") && pathname.endsWith(".js")) {
      // Helpful during development; static serve source JS
      return serveFile(res, path.join(ROOT, pathname.replace(/^\//, "")));
    }

    sendText(res, 404, `Not found: ${pathname}`);
  } catch (err) {
    console.error("Server error:", err);
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`OBP companion server listening on http://localhost:${PORT}`);
  console.log(`  Builder:       http://localhost:${PORT}/`);
  console.log(`  Journeys dir:  ${path.relative(ROOT, JOURNEYS_DIR) || JOURNEYS_DIR}`);
  console.log(`  Hits dir:      ${path.relative(ROOT, HITS_DIR) || HITS_DIR}`);
});
