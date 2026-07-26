import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const required = [
  ["fetch-sporttery", ["scripts/fetch-sporttery.mjs"]]
];

const optional = [
  ["fetch-football-data", ["scripts/fetch-football-data.mjs"], "FOOTBALL_DATA_TOKEN"],
  ["fetch-api-football", ["scripts/fetch-api-football.mjs"], "API_FOOTBALL_KEY"],
  ["fetch-api-football-odds", ["scripts/fetch-api-football-odds.mjs"], "API_FOOTBALL_KEY"],
  ["fetch-odds-api-io", ["scripts/fetch-odds-api-io.mjs"], "ODDS_API_IO_KEY"],
  ["fetch-clubelo", ["scripts/fetch-clubelo.mjs"]],
  ["fetch-footymetrics", ["scripts/fetch-footymetrics.mjs"]]
];

const finalizers = [
  ["enrich-matches", ["scripts/enrich-matches.mjs"]],
  ["archive-matches", ["scripts/archive-matches.mjs"]],
  ["capture-predictions", ["scripts/capture-predictions.mjs"]]
];

const guardedFiles = [
  "data/jincai-fixtures.json",
  "src/generated-jincai-fixtures.js"
];

async function readBackups(files) {
  const backups = new Map();
  for (const file of files) {
    try {
      backups.set(file, await fs.readFile(file));
    } catch {
      backups.set(file, null);
    }
  }
  return backups;
}

async function restoreBackups(backups) {
  for (const [file, buffer] of backups) {
    if (buffer) await fs.writeFile(file, buffer);
  }
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function runNode(label, args) {
  return new Promise((resolve) => {
    console.log(`\n> ${label}`);
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function runRequired() {
  const backups = await readBackups(guardedFiles);
  for (const [label, args] of required) {
    const code = await runNode(label, args);
    if (code !== 0) {
      await restoreBackups(backups);
      console.log(`${label} failed; restored previous bundled data and continuing.`);
    }
  }
}

async function runOptional() {
  for (const [label, args, envName] of optional) {
    if (envName && !hasEnv(envName)) {
      console.log(`\n> ${label}\nSkipped: missing ${envName}.`);
      continue;
    }
    const code = await runNode(label, args);
    if (code !== 0) {
      console.log(`Skipped failed optional provider: ${label}.`);
    }
  }
}

async function runFinalizers() {
  for (const [label, args] of finalizers) {
    const code = await runNode(label, args);
    if (code !== 0) throw new Error(`${label} failed.`);
  }
}

await runRequired();
await runOptional();
await runFinalizers();
