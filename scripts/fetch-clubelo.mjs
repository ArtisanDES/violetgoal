import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const aliasesPath = path.join(root, "data", "team-aliases.json");
const jincaiPath = path.join(root, "data", "jincai-fixtures.json");
const outputPath = path.join(root, "data", "clubelo.json");
const baseUrl = process.env.CLUBELO_BASE_URL || "http://api.clubelo.com";

async function readJson(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/);
  const headers = rows.shift().split(",");
  return rows.map((row) => {
    const values = row.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/football club|fc|cf|sc|afc|club/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function aliasCandidates(aliases, name) {
  const alias = aliases.teams?.[name] || {};
  return [alias.clubEloName].filter(Boolean);
}

async function fetchClub(name) {
  const url = `${baseUrl}/${encodeURIComponent(name)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const text = await response.text();
  if (!text.trim() || text.includes("not found")) return null;
  const rows = parseCsv(text);
  return rows.at(-1) || null;
}

async function findClubElo(localName, aliases) {
  const candidates = aliasCandidates(aliases, localName);
  if (!candidates.length) return { localName, missing: true, tried: [], reason: "missing clubEloName alias" };
  const seen = new Set();
  for (const candidate of candidates) {
    const key = normalizeName(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      const row = await fetchClub(candidate);
      if (row?.Elo) return { localName, query: candidate, row };
    } catch {
      // Try next alias.
    }
  }
  return { localName, missing: true, tried: candidates };
}

async function main() {
  const aliases = await readJson(aliasesPath, { teams: {} });
  const jincai = await readJson(jincaiPath, { matches: [] });
  const names = [...new Set((jincai.matches || []).flatMap((match) => [match.home, match.away]))];
  const teams = [];

  for (const name of names) {
    teams.push(await findClubElo(name, aliases));
  }

  const output = {
    source: "clubelo",
    endpoint: baseUrl,
    generatedAt: new Date().toISOString(),
    count: teams.filter((team) => team.row?.Elo).length,
    teams
  };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`ClubElo matched ${output.count}/${teams.length} teams`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
