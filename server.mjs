import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const port = Number(process.env.PORT || 8080);
const syncIntervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES || 10);
const syncIntervalMs = Math.max(1, syncIntervalMinutes) * 60 * 1000;
let syncing = false;
let lastSyncStartedAt = null;
let lastSyncFinishedAt = null;
let lastSyncExitCode = null;
let lastSportteryExitCode = null;
let lastApiFootballExitCode = null;
let lastOddsApiIoExitCode = null;
let lastClubEloExitCode = null;
let lastFootyMetricsExitCode = null;
let lastEnrichExitCode = null;
let snapshotCaptureRunning = false;
let matchArchiveRunning = false;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function runSnapshotCapture() {
  if (snapshotCaptureRunning) return;
  snapshotCaptureRunning = true;
  const capture = spawn(process.execPath, ["scripts/capture-predictions.mjs"], {
    cwd: root,
    stdio: "inherit"
  });
  capture.on("exit", () => {
    snapshotCaptureRunning = false;
  });
}

function runMatchArchive() {
  if (matchArchiveRunning) return;
  matchArchiveRunning = true;
  const archive = spawn(process.execPath, ["scripts/archive-matches.mjs"], {
    cwd: root,
    stdio: "inherit"
  });
  archive.on("exit", () => {
    matchArchiveRunning = false;
  });
}

function runSync() {
  if (syncing) return;
  syncing = true;
  lastSyncStartedAt = new Date().toISOString();
  const footballData = spawn(process.execPath, ["scripts/fetch-football-data.mjs"], {
    cwd: root,
    stdio: "inherit"
  });

  footballData.on("exit", (code) => {
    lastSyncExitCode = code;
    const sporttery = spawn(process.execPath, ["scripts/fetch-sporttery.mjs"], {
      cwd: root,
      stdio: "inherit"
    });
    sporttery.on("exit", (sportteryCode) => {
      lastSportteryExitCode = sportteryCode;
      const apiFootball = spawn(process.execPath, ["scripts/fetch-api-football.mjs"], {
        cwd: root,
        stdio: "inherit"
      });
      apiFootball.on("exit", (apiFootballCode) => {
        lastApiFootballExitCode = apiFootballCode;
        const oddsApiIo = spawn(process.execPath, ["scripts/fetch-odds-api-io.mjs"], {
          cwd: root,
          stdio: "inherit"
        });
        oddsApiIo.on("exit", (oddsApiIoCode) => {
          lastOddsApiIoExitCode = oddsApiIoCode;
          const clubElo = spawn(process.execPath, ["scripts/fetch-clubelo.mjs"], {
            cwd: root,
            stdio: "inherit"
          });
          clubElo.on("exit", (clubEloCode) => {
            lastClubEloExitCode = clubEloCode;
            const footyMetrics = spawn(process.execPath, ["scripts/fetch-footymetrics.mjs"], {
              cwd: root,
              stdio: "inherit"
            });
            footyMetrics.on("exit", (footyMetricsCode) => {
              lastFootyMetricsExitCode = footyMetricsCode;
              const enrich = spawn(process.execPath, ["scripts/enrich-matches.mjs"], {
                cwd: root,
                stdio: "inherit"
              });
              enrich.on("exit", (enrichCode) => {
                lastEnrichExitCode = enrichCode;
                lastSyncFinishedAt = new Date().toISOString();
                syncing = false;
              });
            });
          });
        });
      });
    });
  });
}

async function readJson(relativePath, fallback) {
  try {
    const raw = await fs.readFile(path.join(root, relativePath), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isAuthorized(request) {
  const adminToken = process.env.ADMIN_SYNC_TOKEN;
  if (!adminToken) return false;
  return request.headers.authorization === `Bearer ${adminToken}`;
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.normalize(path.join(root, requested));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, syncing, lastSyncStartedAt, lastSyncFinishedAt, lastSyncExitCode, lastSportteryExitCode, lastApiFootballExitCode, lastOddsApiIoExitCode, lastClubEloExitCode, lastFootyMetricsExitCode, lastEnrichExitCode }));
    return;
  }

  if (request.url === "/api/fixtures") {
    const footballData = await readJson("data/fixtures.json", { source: "football-data.org", generatedAt: null, matches: [] });
    const sporttery = await readJson("data/jincai-fixtures.json", { source: "sporttery", generatedAt: null, matches: [] });
    const payload = {
      source: "merged",
      generatedAt: new Date().toISOString(),
      sources: {
        footballData: {
          generatedAt: footballData.generatedAt,
          count: footballData.matches?.length || 0
        },
        sporttery: {
          generatedAt: sporttery.generatedAt,
          count: sporttery.matches?.length || 0,
          error: sporttery.error
        }
      },
      matches: [
        ...(sporttery.matches || []),
        ...(footballData.matches || [])
      ]
    };
    payload.count = payload.matches.length;
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(payload));
    return;
  }

  if (request.url === "/api/sync-status") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ syncing, lastSyncStartedAt, lastSyncFinishedAt, lastSyncExitCode, lastSportteryExitCode, lastApiFootballExitCode, lastOddsApiIoExitCode, lastClubEloExitCode, lastFootyMetricsExitCode, lastEnrichExitCode }));
    return;
  }

  if (request.url === "/api/sync" && request.method === "POST") {
    if (!isAuthorized(request)) {
      response.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, message: "unauthorized" }));
      return;
    }
    runSync();
    response.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, message: "sync started" }));
    return;
  }

  const filePath = safePath(request.url || "/");
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": filePath.endsWith(".html") || filePath.endsWith(".css") || path.basename(filePath).startsWith("generated-")
        ? "no-store"
        : "public, max-age=60"
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Site running at http://127.0.0.1:${port}`);
  console.log(`Football data sync interval: ${syncIntervalMinutes} minute(s)`);
  runSync();
  runMatchArchive();
  runSnapshotCapture();
  setInterval(runSync, syncIntervalMs);
  setInterval(runMatchArchive, 60 * 1000);
  setInterval(runSnapshotCapture, 60 * 1000);
});
