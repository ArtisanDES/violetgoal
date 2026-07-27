import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sources = [
  path.join(root, "data", "jincai-fixtures.json"),
  path.join(root, "data", "fixtures.json")
];
const historyPath = path.join(root, "data", "match-history.json");
const generatedPath = path.join(root, "src", "generated-match-history.js");
const apiFootballPath = path.join(root, "data", "api-football-fixtures.json");
const aliasesPath = path.join(root, "data", "team-aliases.json");

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

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/football club|fc|cf|sc|afc|club/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function readAlias(aliases, name) {
  return aliases.teams?.[name] || {};
}

function aliasNames(aliases, name) {
  const alias = readAlias(aliases, name);
  return [
    name,
    alias.apiFootballName,
    alias.oddsApiName,
    alias.footyMetricsName,
    alias.clubEloName,
    ...(alias.names || [])
  ].filter(Boolean);
}

function matchDate(value) {
  return String(value || "").slice(0, 10);
}

function closeDate(a, b) {
  const left = new Date(a || 0);
  const right = new Date(b || 0);
  if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) {
    return matchDate(a) === matchDate(b);
  }
  return Math.abs(left.getTime() - right.getTime()) <= 36 * 60 * 60 * 1000;
}

function teamMatches(localName, providerName, providerId, aliases) {
  const alias = readAlias(aliases, localName);
  if (alias.apiFootballId && Number(alias.apiFootballId) === Number(providerId)) return true;
  const normalizedProvider = normalizeName(providerName);
  const names = aliasNames(aliases, localName).map(normalizeName).filter(Boolean);
  if (names.includes(normalizedProvider)) return true;
  return names.some((name) => (
    name.length >= 5 &&
    normalizedProvider.length >= 5 &&
    (name.includes(normalizedProvider) || normalizedProvider.includes(name))
  ));
}

function apiFootballPatch(provider) {
  const finished = ["FT", "AET", "PEN"].includes(provider.status);
  const score = provider.goalsHome !== null && provider.goalsAway !== null
    ? `${provider.goalsHome}-${provider.goalsAway}`
    : null;

  return {
    apiFootball: {
      fixtureId: provider.providerFixtureId,
      leagueId: provider.leagueId,
      season: provider.season,
      round: provider.round,
      venue: provider.venue,
      status: provider.status,
      elapsed: provider.elapsed
    },
    result: {
      status: finished ? "\u5df2\u5b8c\u8d5b" : provider.status,
      score
    },
    dataQuality: {
      real: ["API-Football\u8d5b\u7a0b", finished ? "API-Football\u8d5b\u679c" : "API-Football\u8d5b\u7a0b\u72b6\u6001"].filter(Boolean),
      pending: finished ? [] : ["\u8d5b\u540e\u8d5b\u679c"]
    }
  };
}

function findApiFootballMatch(local, providers, aliases) {
  return providers
    .filter((provider) => closeDate(provider.utcDate, local.utcDate))
    .find((provider) => (
      teamMatches(local.home, provider.home, provider.homeId, aliases) &&
      teamMatches(local.away, provider.away, provider.awayId, aliases)
    ));
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

const apiFootball = await readJson(apiFootballPath, { matches: [] });
const aliases = await readJson(aliasesPath, { teams: {} });
let resultsUpdated = 0;
for (const [id, match] of Object.entries(history.matches)) {
  const provider = findApiFootballMatch(match, apiFootball.matches || [], aliases);
  if (!provider) continue;
  const beforeScore = match.result?.score || null;
  history.matches[id] = mergeDefined(match, apiFootballPatch(provider));
  const afterScore = history.matches[id].result?.score || null;
  if (afterScore && afterScore !== beforeScore) resultsUpdated += 1;
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
console.log(`Backfilled ${resultsUpdated} archived result(s) from API-Football.`);
