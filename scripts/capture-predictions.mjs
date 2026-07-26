import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "data", "jincai-fixtures.json");
const historyPath = path.join(root, "data", "prediction-snapshots.json");
const generatedPath = path.join(root, "src", "generated-prediction-snapshots.js");
const captureWindowMs = 20 * 60 * 1000;

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function shanghaiDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function previousDate(dateText) {
  const noon = new Date(`${dateText}T12:00:00+08:00`);
  noon.setUTCDate(noon.getUTCDate() - 1);
  return shanghaiDate(noon);
}

function lockTime(match) {
  const dateText = String(match.utcDate || "").slice(0, 10);
  const timeText = String(match.time || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return null;
  const [hour] = timeText.split(":").map(Number);
  if (hour >= 22) return new Date(`${dateText}T21:00:00+08:00`);
  if (hour < 11) return new Date(`${previousDate(dateText)}T21:00:00+08:00`);
  return new Date(new Date(`${dateText}T${timeText}:00+08:00`).getTime() - 60 * 60 * 1000);
}

const source = await readJson(sourcePath, { matches: [] });
const history = await readJson(historyPath, { version: 1, snapshots: {} });
history.snapshots ||= {};
const now = new Date();
let captured = 0;

for (const match of source.matches || []) {
  const id = String(match.id || match.jcNumber || "");
  if (!id || history.snapshots[id]) continue;
  const deadline = lockTime(match);
  if (!deadline) continue;
  const age = now.getTime() - deadline.getTime();
  if (age < 0 || age > captureWindowMs) continue;
  history.snapshots[id] = {
    matchId: id,
    capturedAt: now.toISOString(),
    lockTime: deadline.toISOString(),
    policy: Number(String(match.time || "").slice(0, 2)) >= 22 || Number(String(match.time || "").slice(0, 2)) < 11
      ? "21:00_FIXED"
      : "T_MINUS_60",
    match
  };
  captured += 1;
}

history.updatedAt = now.toISOString();
await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
await fs.writeFile(generatedPath, `window.__PREDICTION_SNAPSHOTS__ = ${JSON.stringify(history)};\n`, "utf8");
console.log(`Prediction snapshots: ${Object.keys(history.snapshots).length} total, ${captured} captured now.`);
