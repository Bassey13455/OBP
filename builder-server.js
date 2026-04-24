/**
 * builder-server.js
 * ------------------------------------------------------------------
 * Lives next to journey-builder.html. When the HTML is served by
 * server.js (i.e. /api/ping answers), this wires up the Server panel:
 *   - list / load / save journeys against the local JSON folder
 *   - kick off a run, stream logs via SSE, show output files
 *
 * Loaded unconditionally — if /api/ping fails, we leave the Server
 * panel hidden so the file:// flow keeps working.
 * ------------------------------------------------------------------
 */

(function () {
  // Helpers that duplicate small bits from the inline script so this file is
  // self-contained. The inline globals `journey`, `activeStepIndex`, `renderAll`,
  // `toast`, and `$` are reused directly.
  const $ = (s) => document.querySelector(s);
  let currentRunId = null;
  let currentRunES = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  function slugify(name) {
    return String(name || "journey").trim().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "journey";
  }

  async function detectServer() {
    try {
      const r = await fetch("/api/ping", { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && j.ok) ? j : null;
    } catch { return null; }
  }

  async function refreshJourneys() {
    try {
      const r = await fetch("/api/journeys");
      const j = await r.json();
      const sel = $("#server-journey-list");
      if (!sel) return;
      if (!j.journeys || !j.journeys.length) {
        sel.innerHTML = `<option value="">(none found)</option>`;
        return;
      }
      sel.innerHTML = j.journeys.map((x) =>
        `<option value="${esc(x.slug)}">${esc(x.name)} (${x.steps ?? "?"} steps)</option>`
      ).join("");
    } catch (err) {
      const s = $("#server-status"); if (s) s.textContent = "error: " + err.message;
    }
  }

  function openStream(id) {
    if (currentRunES) { try { currentRunES.close(); } catch {} }
    const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/stream`);
    currentRunES = es;
    const logEl = $("#server-run-log");
    const filesEl = $("#server-run-files");

    es.onmessage = (ev) => {
      let entry;
      try { entry = JSON.parse(ev.data); } catch { return; }
      if (entry.type === "done") {
        logEl.textContent += `\n--- finished, exit ${entry.exitCode} ---\n`;
        $("#btn-server-stop").style.display = "none";
        const files = entry.files || [];
        if (files.length) {
          filesEl.innerHTML = `<strong>Output files:</strong><br>` + files.map((f) => {
            const href = "/" + f.relative.split("/").map(encodeURIComponent).join("/");
            return `<a href="${href}" target="_blank" style="color:#8df;">${esc(f.name)}</a>`;
          }).join("<br>");
        } else {
          filesEl.textContent = "No output files (check the log).";
        }
        es.close();
        currentRunES = null;
        return;
      }
      logEl.textContent += (entry.type === "stderr" ? "[err] " : "") + (entry.line || "") + "\n";
      logEl.scrollTop = logEl.scrollHeight;
    };
    es.onerror = () => {
      logEl.textContent += "\n[stream closed]\n";
      try { es.close(); } catch {}
      currentRunES = null;
      $("#btn-server-stop").style.display = "none";
    };
  }

  async function bind() {
    const info = await detectServer();
    if (!info) return;
    $("#server-panel").style.display = "";
    const statusEl = $("#server-status");
    statusEl.textContent = "connected";
    statusEl.style.color = "#6a6";

    // Show the actual on-disk folder so it's obvious where journeys live.
    const pathEl = $("#server-journeys-path");
    if (pathEl && info.cwd) {
      pathEl.textContent = info.cwd.replace(/\\/g, "/").replace(/\/?$/, "/") + "journeys/";
      pathEl.title = "All Save / Load operations write to this folder on disk.";
    }

    await refreshJourneys();

    $("#btn-server-load").addEventListener("click", async () => {
      const slug = $("#server-journey-list").value;
      if (!slug) return;
      try {
        const r = await fetch(`/api/journeys/${encodeURIComponent(slug)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!j.steps) throw new Error("Invalid journey JSON");
        window.setJourney(j);
        window.toast(`Loaded "${slug}" from server`);
      } catch (err) {
        window.toast("Load failed: " + err.message, true);
      }
    });

    $("#btn-server-save").addEventListener("click", async () => {
      const defaultSlug = slugify(window.journey.name || "journey");
      const slug = prompt("Save as slug (letters/numbers/_-):", defaultSlug);
      if (!slug) return;
      try {
        const r = await fetch(`/api/journeys/${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(window.journey, null, 2),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "save failed");
        window.toast(`Saved to server as ${j.file}`);
        await refreshJourneys();
      } catch (err) {
        window.toast("Save failed: " + err.message, true);
      }
    });

    $("#btn-server-run").addEventListener("click", async () => {
      const slug = $("#server-journey-list").value;
      if (!slug) { window.toast("Pick a journey first", true); return; }
      $("#server-run-output").style.display = "";
      $("#server-run-log").textContent = "";
      $("#server-run-files").innerHTML = "";
      $("#server-run-id").textContent = "starting...";
      const headed = !!($("#server-run-headed") && $("#server-run-headed").checked);
      try {
        const r = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, headed }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "start failed");
        currentRunId = j.id;
        $("#server-run-id").textContent = "run " + j.id;
        $("#btn-server-stop").style.display = "";
        openStream(j.id);
      } catch (err) {
        window.toast("Run failed: " + err.message, true);
        $("#server-run-id").textContent = "";
      }
    });

    $("#btn-server-stop").addEventListener("click", async () => {
      if (!currentRunId) return;
      try { await fetch(`/api/runs/${currentRunId}/stop`, { method: "POST" }); } catch {}
      $("#btn-server-stop").style.display = "none";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
