import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "odds-api-io.local.json");
const aliasesPath = path.join(root, "data", "team-aliases.json");
const jincaiPath = path.join(root, "data", "jincai-fixtures.json");
const outputPath = path.join(root, "data", "odds-api-io.json");

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
    key: process.env.ODDS_API_IO_KEY || process.env.THE_ODDS_API_KEY || fileConfig.oddsApiIoKey,
    baseUrl: process.env.ODDS_API_IO_BASE_URL || fileConfig.baseUrl || "https://api.odds-api.io/v3",
    sport: process.env.ODDS_API_IO_SPORT || fileConfig.sport || "football",
    limit: Number(process.env.ODDS_API_IO_LIMIT || fileConfig.limit || 500),
    bookmakers: process.env.ODDS_API_IO_BOOKMAKERS || fileConfig.bookmakers || "Bet365,Unibet,Betfair"
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/football club|fc|cf|sc|afc|club/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function aliasNames(aliases, name) {
  const alias = aliases.teams?.[name] || {};
  return [name, alias.apiFootballName, alias.oddsApiName, alias.footyMetricsName, alias.clubEloName, ...(alias.names || [])]
    .filter(Boolean)
    .map(normalizeName);
}

function sameDate(a, b) {
  const left = new Date(a || 0);
  const right = new Date(b || 0);
  if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) {
    return String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
  }
  return Math.abs(left.getTime() - right.getTime()) <= 36 * 60 * 60 * 1000;
}

function teamMatches(localNames, providerName) {
  const normalized = normalizeName(providerName);
  if (localNames.includes(normalized)) return true;
  return localNames.some((name) => (
    name.length >= 5 &&
    normalized.length >= 5 &&
    (name.includes(normalized) || normalized.includes(name))
  ));
}

function findEvent(match, events, aliases) {
  const homeNames = aliasNames(aliases, match.home);
  const awayNames = aliasNames(aliases, match.away);
  return events.find((event) => (
    sameDate(match.utcDate, event.date) &&
    teamMatches(homeNames, event.home) &&
    teamMatches(awayNames, event.away)
  ));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

function simplifyEvent(event) {
  return {
    eventId: event.id,
    sport: event.sport?.slug || event.sport || "",
    league: event.league?.name || event.league || "",
    leagueSlug: event.league?.slug || "",
    home: event.home,
    away: event.away,
    date: event.date,
    status: event.status
  };
}

function simplifyOdds(eventId, odds) {
  const mappedBookmakers = (!Array.isArray(odds.bookmakers) && odds.bookmakers && typeof odds.bookmakers === "object")
    ? Object.entries(odds.bookmakers).flatMap(([bookmakerName, markets]) => (
      (Array.isArray(markets) ? markets : []).map((market) => ({ ...market, bookmaker: bookmakerName }))
    ))
    : [];
  const mappedMl = mappedBookmakers.find((market) => ["ml", "1x2", "match winner", "match_winner"].includes(String(market.name || market.key || market.market || "").toLowerCase()));
  const mappedOdds = Array.isArray(mappedMl?.odds) ? mappedMl.odds[0] : null;
  if (mappedOdds) {
    return {
      eventId,
      raw: odds,
      bookmaker: mappedMl.bookmaker || "",
      market: mappedMl.name || "ML",
      home: mappedOdds.home || null,
      draw: mappedOdds.draw || null,
      away: mappedOdds.away || null,
      bookmakers: odds.bookmakers || odds
    };
  }

  const rawBookmakers = Array.isArray(odds.bookmakers) ? odds.bookmakers : [];
  const markets = rawBookmakers.flatMap((bookmaker) => {
    const bookmakerName = bookmaker.name || bookmaker.bookmaker || bookmaker.key || "";
    const marketList = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];
    return marketList.map((market) => ({ ...market, bookmaker: bookmakerName }));
  });
  const h2hMarket = markets.find((market) => {
    const key = String(market.key || market.market || market.name || "").toLowerCase();
    return ["h2h", "1x2", "match_winner", "winner", "full_time_result"].some((item) => key.includes(item));
  }) || markets.find((market) => Array.isArray(market.outcomes) && market.outcomes.length >= 3);
  const outcomes = Array.isArray(h2hMarket?.outcomes) ? h2hMarket.outcomes : [];
  const home = outcomes.find((item) => /home|1|主/i.test(String(item.name || item.label || item.selection || "")));
  const draw = outcomes.find((item) => /draw|x|平/i.test(String(item.name || item.label || item.selection || "")));
  const away = outcomes.find((item) => /away|2|客/i.test(String(item.name || item.label || item.selection || "")));
  return {
    eventId,
    raw: odds,
    bookmaker: h2hMarket?.bookmaker || rawBookmakers[0]?.name || rawBookmakers[0]?.bookmaker || "",
    market: h2hMarket?.key || h2hMarket?.market || h2hMarket?.name || "",
    home: home?.price || home?.odds || home?.decimal || null,
    draw: draw?.price || draw?.odds || draw?.decimal || null,
    away: away?.price || away?.odds || away?.decimal || null,
    bookmakers: odds.bookmakers || odds
  };
}

function oddsUrl(base, key, eventId, bookmakers) {
  const url = new URL(`${base}/odds`);
  url.searchParams.set("apiKey", key);
  url.searchParams.set("eventId", eventId);
  if (bookmakers) url.searchParams.set("bookmakers", bookmakers);
  return url.toString();
}

function normalizeBookmakers(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !["pinnacle", "betfair"].includes(item.toLowerCase()))
    .slice(0, 2)
    .join(",");
}

async function fetchOddsWithFallback(base, config, eventId) {
  const preferred = normalizeBookmakers(config.bookmakers);
  const bet365Only = normalizeBookmakers("Bet365");
  const attempts = [
    preferred,
    bet365Only
  ].filter((item, index, list) => list.indexOf(item) === index);
  const errors = [];
  for (const bookmakers of attempts) {
    try {
      const payload = await fetchJson(oddsUrl(base, config.key, eventId, bookmakers));
      return { odds: simplifyOdds(eventId, payload), error: null };
    } catch (err) {
      errors.push(`${bookmakers || "all"}: ${err.message}`);
    }
  }
  return { odds: null, error: errors.join(" | ") };
}

async function main() {
  const config = await readConfig();
  if (!config.key) throw new Error("Missing Odds-API.io key. Set ODDS_API_IO_KEY or config/odds-api-io.local.json.");

  const aliases = await readJson(aliasesPath, { teams: {} });
  const jincai = await readJson(jincaiPath, { matches: [] });
  const base = config.baseUrl.replace(/\/$/, "");
  const eventsUrl = `${base}/events?apiKey=${encodeURIComponent(config.key)}&sport=${encodeURIComponent(config.sport)}&limit=${encodeURIComponent(config.limit)}`;
  const eventsPayload = await fetchJson(eventsUrl);
  const events = Array.isArray(eventsPayload) ? eventsPayload : (eventsPayload.events || eventsPayload.response || []);
  const matched = [];
  const unmatched = [];

  for (const match of jincai.matches || []) {
    const event = findEvent(match, events, aliases);
    if (!event) {
      unmatched.push({ id: match.id, jcNumber: match.jcNumber, home: match.home, away: match.away, utcDate: match.utcDate });
      continue;
    }
    const { odds, error } = await fetchOddsWithFallback(base, config, event.id);
    matched.push({
      localId: match.id,
      jcNumber: match.jcNumber,
      event: simplifyEvent(event),
      odds,
      error
    });
  }

  const output = {
    source: "odds-api-io",
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    sampleEvents: events.slice(0, 80).map(simplifyEvent),
    matched,
    unmatched
  };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Odds-API.io events: ${events.length}, matched: ${matched.length}, unmatched: ${unmatched.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
