import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "api-football.local.json");
const fixturesPath = path.join(root, "data", "api-football-fixtures.json");
const jincaiPath = path.join(root, "data", "jincai-fixtures.json");
const aliasesPath = path.join(root, "data", "team-aliases.json");
const outputPath = path.join(root, "data", "api-football-odds.json");

async function readJson(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

async function readConfig() {
  const fileConfig = await readJson(configPath, {});
  return {
    baseUrl: process.env.API_FOOTBALL_BASE_URL || fileConfig.baseUrl || "https://v3.football.api-sports.io",
    apiFootballKey: process.env.API_FOOTBALL_KEY || fileConfig.apiFootballKey,
    limit: Number(process.env.API_FOOTBALL_ODDS_LIMIT || fileConfig.oddsLimit || 40)
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

function fixtureMap(payload) {
  return new Map((payload.matches || [])
    .filter((item) => item.providerFixtureId)
    .map((item) => [String(item.providerFixtureId), item]));
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/football club|fc|cf|sc|afc|club/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function aliasNames(aliases, name) {
  const alias = aliases.teams?.[name] || {};
  return [
    name,
    alias.apiFootballName,
    alias.oddsApiName,
    alias.footyMetricsName,
    alias.clubEloName,
    ...(alias.names || [])
  ].filter(Boolean);
}

function teamMatches(aliases, localName, providerName, providerId) {
  const alias = aliases.teams?.[localName] || {};
  if (alias.apiFootballId && Number(alias.apiFootballId) === Number(providerId)) return true;
  const provider = normalizeName(providerName);
  const names = aliasNames(aliases, localName).map(normalizeName).filter(Boolean);
  if (names.includes(provider)) return true;
  return names.some((name) => name.length >= 5 && provider.length >= 5 && (name.includes(provider) || provider.includes(name)));
}

function closeDate(a, b) {
  const left = new Date(a || 0);
  const right = new Date(b || 0);
  if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) {
    return String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
  }
  return Math.abs(left.getTime() - right.getTime()) <= 36 * 60 * 60 * 1000;
}

function findFixtureId(match, fixtures, aliases) {
  if (match.apiFootball?.fixtureId) return String(match.apiFootball.fixtureId);
  const found = fixtures.find((fixture) => (
    closeDate(match.utcDate, fixture.utcDate) &&
    teamMatches(aliases, match.home, fixture.home, fixture.homeId) &&
    teamMatches(aliases, match.away, fixture.away, fixture.awayId)
  ));
  return found?.providerFixtureId ? String(found.providerFixtureId) : null;
}

function findBet(bookmakers, wanted) {
  const wantedNames = wanted.map(normalizeName);
  for (const bookmaker of bookmakers || []) {
    for (const bet of bookmaker.bets || []) {
      const betName = normalizeName(bet.name);
      if (wantedNames.some((name) => betName.includes(name))) {
        return { bookmaker: bookmaker.name, bet };
      }
    }
  }
  return null;
}

function valueOdd(values, selectors) {
  const normalized = selectors.map(normalizeName);
  const found = (values || []).find((item) => {
    const label = normalizeName(item.value);
    return normalized.some((selector) => label === selector || label.includes(selector));
  });
  const odd = Number(found?.odd);
  return Number.isFinite(odd) ? odd : null;
}

function simplifyOdds(responseItem) {
  const bookmakers = responseItem.bookmakers || [];
  const matchWinner = findBet(bookmakers, ["Match Winner", "1x2", "Fulltime Result"]);
  const goals = findBet(bookmakers, ["Goals Over/Under", "Over/Under", "Total Goals"]);
  const bothTeamsScore = findBet(bookmakers, ["Both Teams Score", "Both Teams To Score"]);
  return {
    update: responseItem.update || null,
    league: responseItem.league || null,
    fixture: responseItem.fixture || null,
    matchWinner: matchWinner ? {
      bookmaker: matchWinner.bookmaker,
      home: valueOdd(matchWinner.bet.values, ["Home", "1"]),
      draw: valueOdd(matchWinner.bet.values, ["Draw", "X"]),
      away: valueOdd(matchWinner.bet.values, ["Away", "2"])
    } : null,
    goalsOverUnder: goals ? {
      bookmaker: goals.bookmaker,
      over25: valueOdd(goals.bet.values, ["Over 2.5"]),
      under25: valueOdd(goals.bet.values, ["Under 2.5"])
    } : null,
    bothTeamsScore: bothTeamsScore ? {
      bookmaker: bothTeamsScore.bookmaker,
      yes: valueOdd(bothTeamsScore.bet.values, ["Yes"]),
      no: valueOdd(bothTeamsScore.bet.values, ["No"])
    } : null,
    bookmakerCount: bookmakers.length
  };
}

async function main() {
  const config = await readConfig();
  if (!config.apiFootballKey) {
    throw new Error("Missing API-Football key. Set API_FOOTBALL_KEY or config/api-football.local.json.");
  }

  const fixturesPayload = await readJson(fixturesPath, { matches: [] });
  const fixtures = fixtureMap(fixturesPayload);
  const aliases = await readJson(aliasesPath, { teams: {} });
  const jincai = await readJson(jincaiPath, { matches: [] });
  const base = config.baseUrl.replace(/\/$/, "");
  const matched = [];
  const unmatched = [];
  const errors = [];

  const targets = (jincai.matches || [])
    .map((match) => ({ match, fixtureId: findFixtureId(match, fixturesPayload.matches || [], aliases) }))
    .filter((item) => item.fixtureId)
    .slice(0, config.limit);

  for (const { match, fixtureId } of targets) {
    const fixture = fixtures.get(fixtureId);
    try {
      const payload = await fetchJson(`${base}/odds?fixture=${encodeURIComponent(fixtureId)}`, config.apiFootballKey);
      const response = payload.response || [];
      if (!response.length) {
        unmatched.push({ id: match.id, jcNumber: match.jcNumber, fixtureId, home: match.home, away: match.away });
        continue;
      }
      matched.push({
        localId: match.id,
        jcNumber: match.jcNumber,
        fixtureId,
        providerFixture: fixture || null,
        odds: simplifyOdds(response[0])
      });
    } catch (error) {
      errors.push({ id: match.id, fixtureId, error: error.message });
    }
  }

  const output = {
    source: "api-football-odds",
    generatedAt: new Date().toISOString(),
    targetCount: targets.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    errorCount: errors.length,
    matched,
    unmatched,
    errors
  };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`API-Football odds: targets ${targets.length}, matched ${matched.length}, unmatched ${unmatched.length}, errors ${errors.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
