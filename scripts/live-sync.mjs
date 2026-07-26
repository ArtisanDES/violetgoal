import { spawn } from "node:child_process";

const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES || 10);
const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
let running = false;
let snapshotCaptureRunning = false;
let matchArchiveRunning = false;

function runSnapshotCapture() {
  if (snapshotCaptureRunning) return;
  snapshotCaptureRunning = true;
  const child = spawn(process.execPath, ["scripts/capture-predictions.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
  child.on("exit", () => {
    snapshotCaptureRunning = false;
  });
}

function runMatchArchive() {
  if (matchArchiveRunning) return;
  matchArchiveRunning = true;
  const child = spawn(process.execPath, ["scripts/archive-matches.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
  child.on("exit", () => {
    matchArchiveRunning = false;
  });
}

function runSync() {
  if (running) {
    console.log("Sync skipped: previous run still active");
    return;
  }

  running = true;
  const startedAt = new Date().toISOString();
  console.log(`Sync started at ${startedAt}`);

  const child = spawn(process.execPath, ["scripts/fetch-football-data.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit"
  });

  child.on("exit", (code) => {
    const sporttery = spawn(process.execPath, ["scripts/fetch-sporttery.mjs"], {
      cwd: process.cwd(),
      stdio: "inherit"
    });
    sporttery.on("exit", (sportteryCode) => {
      const apiFootball = spawn(process.execPath, ["scripts/fetch-api-football.mjs"], {
        cwd: process.cwd(),
        stdio: "inherit"
      });
      apiFootball.on("exit", (apiFootballCode) => {
        const oddsApiIo = spawn(process.execPath, ["scripts/fetch-odds-api-io.mjs"], {
          cwd: process.cwd(),
          stdio: "inherit"
        });
        oddsApiIo.on("exit", (oddsApiIoCode) => {
          const clubElo = spawn(process.execPath, ["scripts/fetch-clubelo.mjs"], {
            cwd: process.cwd(),
            stdio: "inherit"
          });
          clubElo.on("exit", (clubEloCode) => {
            const footyMetrics = spawn(process.execPath, ["scripts/fetch-footymetrics.mjs"], {
              cwd: process.cwd(),
              stdio: "inherit"
            });
            footyMetrics.on("exit", (footyMetricsCode) => {
              const enrich = spawn(process.execPath, ["scripts/enrich-matches.mjs"], {
                cwd: process.cwd(),
                stdio: "inherit"
              });
              enrich.on("exit", (enrichCode) => {
                running = false;
                const finishedAt = new Date().toISOString();
                console.log(`Sync finished at ${finishedAt} with football-data code ${code}, sporttery code ${sportteryCode}, api-football code ${apiFootballCode}, odds-api-io code ${oddsApiIoCode}, clubelo code ${clubEloCode}, footymetrics code ${footyMetricsCode}, enrich code ${enrichCode}`);
              });
            });
          });
        });
      });
    });
  });
}

runSync();
runMatchArchive();
runSnapshotCapture();
setInterval(runSync, intervalMs);
setInterval(runMatchArchive, 60 * 1000);
setInterval(runSnapshotCapture, 60 * 1000);

console.log(`Live sync active. Interval: ${intervalMinutes} minute(s).`);
