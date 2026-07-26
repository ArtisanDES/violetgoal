import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sources = [
  path.join(root, "data", "jincai-fixtures.json"),
  path.join(root, "data", "fixtures.json")
];
const historyPath = path.join(root, "data", "match-history.json");
const generatedPath = path.join(root, "src", "generated-match-history.js");

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function mergeDefined(previous, current) {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(current || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeDefined(previous?.[key] || {}, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

const history = await readJson(historyPath, { version: 1, launchedAt: new Date().toISOString(), matches: {} });
history.matches ||= {};
const now = new Date().toISOString();
let added = 0;
let updated = 0;

for (const sourcePath of sources) {
  const source = await readJson(sourcePath, { matches: [] });
  for (const match of source.matches || []) {
    const id = String(match.id || match.jcNumber || "");
    if (!id) continue;
    const previous = history.matches[id];
    history.matches[id] = {
      ...mergeDefined(previous || {}, match),
      archive: {
        firstSeenAt: previous?.archive?.firstSeenAt || now,
        lastSeenAt: now
      }
    };
    if (previous) updated += 1;
    else added += 1;
  }
}

history.updatedAt = now;
const payload = {
  version: history.version,
  launchedAt: history.launchedAt,
  updatedAt: history.updatedAt,
  matches: history.matches
};
await fs.writeFile(historyPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await fs.writeFile(generatedPath, `window.__MATCH_HISTORY__ = ${JSON.stringify(payload)};\n`, "utf8");
console.log(`Match history: ${Object.keys(history.matches).length} total, ${added} added, ${updated} updated.`);
