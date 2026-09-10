// server/server.js — HTTP server, static files, and API router.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as runs from "./runs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const CONFIG_PATH = path.join(__dirname, "..", "config", "projects.json");
const PORT = parseInt(process.env.PORT || "3777", 10);

// ── MIME types ─────────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function error(res, message, status = 400) {
  json(res, { error: message }, status);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function loadProjects() {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw).projects;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const parts = url.pathname.replace("/api/", "").split("/").filter(Boolean);

  try {
    // GET /api/projects
    if (method === "GET" && parts[0] === "projects" && parts.length === 1) {
      const projects = await loadProjects();
      return json(res, projects);
    }

    // POST /api/runs
    if (method === "POST" && parts[0] === "runs" && parts.length === 1) {
      const body = await readBody(req);
      const projects = await loadProjects();
      const project = projects.find((p) => p.id === body.projectId);
      if (!project) return error(res, `Project "${body.projectId}" not found.`, 404);

      const run = await runs.createRun(project, body.ticketId, body.ticketTitle, body.plan);
      return json(res, run, 201);
    }

    // GET /api/runs
    if (method === "GET" && parts[0] === "runs" && parts.length === 1) {
      return json(res, runs.listRuns());
    }

    // GET /api/runs/:id
    if (method === "GET" && parts[0] === "runs" && parts.length === 2 && !parts[1].includes("events")) {
      const run = runs.getRun(parts[1]);
      if (!run) return error(res, "Run not found.", 404);
      return json(res, run);
    }

    // GET /api/runs/:id/events (SSE)
    if (method === "GET" && parts[0] === "runs" && parts[2] === "events") {
      const runId = parts[1];
      const run = runs.getRun(runId);
      if (!run) return error(res, "Run not found.", 404);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Send existing events as a catch-up burst.
      for (const event of run.events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // Subscribe to new events.
      const unsubscribe = runs.subscribe(runId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      req.on("close", unsubscribe);
      return; // Keep the connection open.
    }

    // POST /api/runs/:id/steer
    if (method === "POST" && parts[0] === "runs" && parts[2] === "steer") {
      const body = await readBody(req);
      if (!body.message) return error(res, "Message is required.");
      await runs.steerRun(parts[1], body.message);
      return json(res, { ok: true });
    }

    // POST /api/runs/:id/stop
    if (method === "POST" && parts[0] === "runs" && parts[2] === "stop") {
      await runs.stopRun(parts[1]);
      return json(res, { ok: true });
    }

    // POST /api/runs/:id/pr
    if (method === "POST" && parts[0] === "runs" && parts[2] === "pr") {
      const pr = await runs.createPR(parts[1]);
      return json(res, pr);
    }

    return error(res, "Not found.", 404);
  } catch (err) {
    console.error(`API error: ${method} ${url.pathname}`, err.message);
    return error(res, err.message, 500);
  }
}

// ── Static file serving ────────────────────────────────────────────────────────

async function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === "/" ? "index.html" : req.url);
  filePath = path.normalize(filePath);

  // Prevent directory traversal.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath);
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// ── Server ─────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`X-Factory running at http://localhost:${PORT}`);
});
