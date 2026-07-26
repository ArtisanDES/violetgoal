import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "api-football.local.json");
const outputPath = path.join(root, "data", "api-football-fixtures.json");
const unmatchedPath = path.join(root, "data", "api-football-unmatched.json");

async function readJson(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function datesBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to || from}T00:00:00Z`);
  const dates = [];
  for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

async function readConfig() {
  const fileConfig = await readJson(configPath, {});
  return {
    baseUrl: process.env.API_FOOTBALL_BASE_URL || fileConfig.baseUrl || "https://v3.football.api-sports.io",
    apiFootballKey: process.env.API_FOOTBALL_KEY || fileConfig.apiFootballKey,
    dateFrom: process.env.DATE_FROM || fileConfig.dateFrom || new Date().toISOString().slice(0, 10),
    dateTo: process.env.DATE_TO || fileConfig.dateTo || process.env.DATE_FROM || fileConfig.dateFrom || new Date().toISOString().slice(0, 10)
  };
}

async function fetchJson(url, key) {
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": key
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  return response.json();
}

function normalizeFixture(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const teams = item.teams || {};
  const goals = item.goals || {};
  const score = item.score || {};

  return {
    provider: "api-football",
    providerFixtureId: fixture.id,
    utcDate: fixture.date,
    timestamp: fixture.timestamp,
    status: fixture.status?.short || fixture.status?.long || "TBD",
    elapsed: fixture.status?.elapsed || null,
    venue: fixture.venue?.name || "",
    league: league.name || "",
    leagueId: league.id || null,
    season: league.season || null,
    round: league.round || "",
    country: league.country || "",
    home: teams.home?.name || "",
    away: teams.away?.name || "",
    homeId: teams.home?.id || null,
    awayId: teams.away?.id || null,
    homeWinner: teams.home?.winner,
    awayWinner: teams.away?.winner,
    goalsHome: goals.home,
    goalsAway: goals.away,
    score: {
      halftime: score.halftime || {},
      fulltime: score.fulltime || {},
      extratime: score.extratime || {},
      penalty: score.penalty || {}
    }
  };
}

async function main() {
  const config = await readConfig();
  if (!config.apiFootballKey) {
    throw new Error("Missing API-Football key. Set API_FOOTBALL_KEY or config/api-football.local.json.");
  }

  const matches = [];
  const errors = [];
  for (const date of datesBetween(config.dateFrom, config.dateTo)) {
    const url = `${config.baseUrl.replace(/\/$/, "")}/fixtures?date=${encodeURIComponent(date)}`;
    try {
      const payload = await fetchJson(url, config.apiFootballKey);
      matches.push(...(payload.response || []).map(normalizeFixture));
      console.log(`OK API-Football ${date}: ${(payload.response || []).length}`);
    } catch (error) {
      errors.push({ date, error: error.message });
      console.error(`FAIL API-Football ${date}: ${error.message}`);
    }
  }

  const output = {
    source: "api-football",
    generatedAt: new Date().toISOString(),
    dateFrom: config.dateFrom,
    dateTo: config.dateTo,
    count: matches.length,
    errors,
    matches
  };

  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(unmatchedPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    message: "Use data/team-aliases.json to map Chinese Sporttery team names to API-Football names or ids.",
    unmatched: []
  }, null, 2), "utf8");
  console.log(`Wrote ${matches.length} API-Football fixtures to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
