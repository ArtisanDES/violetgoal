import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const files = [
  {
    json: path.join(root, "data", "jincai-fixtures.json"),
    js: path.join(root, "src", "generated-jincai-fixtures.js"),
    global: "__JINCAI_DATA__"
  },
  {
    json: path.join(root, "data", "fixtures.json"),
    js: path.join(root, "src", "generated-fixtures.js"),
    global: "__FIXTURES_DATA__"
  }
];
const overridesPath = path.join(root, "data", "provider-overrides.json");
const apiFootballPath = path.join(root, "data", "api-football-fixtures.json");
const oddsApiIoPath = path.join(root, "data", "odds-api-io.json");
const clubEloPath = path.join(root, "data", "clubelo.json");
const footyMetricsPath = path.join(root, "data", "footymetrics-public.json");
const aliasesPath = path.join(root, "data", "team-aliases.json");
const unmatchedPath = path.join(root, "data", "api-football-unmatched.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function keyFor(match) {
  return [
    String(match.id || ""),
    String(match.jcNumber || ""),
    `${match.home || ""} vs ${match.away || ""}`,
    `${match.utcDate || ""} ${match.home || ""} ${match.away || ""}`
  ].filter(Boolean);
}

function normalizeProviderOverrides(payload) {
  const map = new Map();
  for (const item of payload.matches || []) {
    for (const key of keyFor(item)) map.set(key, item);
  }
  return map;
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

function matchDate(value) {
  return String(value || "").slice(0, 10);
}

function teamMatches(localName, providerName, providerId, aliases) {
  const alias = readAlias(aliases, localName);
  if (alias.apiFootballId && Number(alias.apiFootballId) === Number(providerId)) return true;
  const names = [localName, alias.apiFootballName, ...(alias.names || [])].filter(Boolean).map(normalizeName);
  return names.includes(normalizeName(providerName));
}

function apiFootballPatch(local, provider) {
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
      status: finished ? "已完赛" : provider.status,
      score
    },
    dataQuality: {
      real: ["API-Football赛程", finished ? "API-Football赛果" : "API-Football赛程状态"].filter(Boolean),
      pending: finished ? [] : ["赛后赛果"]
    }
  };
}

function normalizeApiFootball(payload, aliases) {
  const matches = payload.matches || [];
  return {
    findPatch(local) {
      const sameDate = matches.filter((provider) => matchDate(provider.utcDate) === matchDate(local.utcDate));
      const found = sameDate.find((provider) => (
        teamMatches(local.home, provider.home, provider.homeId, aliases) &&
        teamMatches(local.away, provider.away, provider.awayId, aliases)
      ));
      return found ? apiFootballPatch(local, found) : null;
    },
    candidates(local) {
      return matches
        .filter((provider) => matchDate(provider.utcDate) === matchDate(local.utcDate))
        .slice(0, 12)
        .map((provider) => ({
          fixtureId: provider.providerFixtureId,
          league: provider.league,
          home: provider.home,
          away: provider.away,
          homeId: provider.homeId,
          awayId: provider.awayId,
          utcDate: provider.utcDate
        }));
    }
  };
}

function normalizeOddsApiIo(payload) {
  const map = new Map((payload.matched || []).map((item) => [String(item.localId), item]));
  return {
    findPatch(match) {
      const item = map.get(String(match.id));
      if (!item) return null;
      return {
        oddsApiIo: {
          event: item.event,
          odds: item.odds,
          error: item.error
        },
        dataQuality: {
          real: item.odds ? ["外围赔率"] : ["外围赛事匹配"],
          pending: item.odds ? [] : ["外围赔率"]
        }
      };
    }
  };
}

function normalizeClubElo(payload) {
  const map = new Map((payload.teams || [])
    .filter((team) => team.row?.Elo)
    .map((team) => [String(team.localName), Number(team.row.Elo)]));
  return {
    findPatch(match) {
      const home = map.get(String(match.home));
      const away = map.get(String(match.away));
      if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
      return {
        eloHome: Math.round(home),
        eloAway: Math.round(away),
        clubElo: {
          home,
          away
        },
        dataQuality: {
          real: ["ClubElo真实评分"],
          pending: []
        }
      };
    }
  };
}

function aliasNames(aliases, name) {
  const alias = aliases.teams?.[name] || {};
  return [name, alias.apiFootballName, alias.oddsApiName, alias.clubEloName, alias.footyMetricsName, ...(alias.names || [])]
    .filter(Boolean)
    .map(normalizeName)
    .filter((item) => item.length > 2);
}

function normalizeFootyMetrics(payload, aliases) {
  const rows = payload.rows || [];
  return {
    findPatch(match) {
      const homeNames = aliasNames(aliases, match.home);
      const awayNames = aliasNames(aliases, match.away);
      const matchedRows = rows.filter((row) => (
        homeNames.includes(normalizeName(row.home)) &&
        awayNames.includes(normalizeName(row.away))
      ));
      if (!matchedRows.length) return null;
      const oneX2 = matchedRows.find((row) => row.matchResult)?.matchResult;
      const directionRow = matchedRows.find((row) => row.bestTip);
      const direction = directionRow?.bestTip ? {
        market: directionRow.bestTip.marketLabel || directionRow.bestTip.market || directionRow.path,
        selection: directionRow.bestTip.label || directionRow.bestTip.selection,
        probability: directionRow.bestTip.prob,
        odds: directionRow.bestTip.odds,
        edge: directionRow.bestTip.edge,
        bookmaker: directionRow.bestTip.bookmaker
      } : null;
      const tips = matchedRows
        .filter((row) => row.bestTip)
        .map((row) => ({
          market: row.bestTip.marketLabel || row.bestTip.market || row.path,
          selection: row.bestTip.label || row.bestTip.selection,
          probability: row.bestTip.prob,
          odds: row.bestTip.odds,
          edge: row.bestTip.edge,
          bookmaker: row.bestTip.bookmaker
        }))
        .slice(0, 8);
      const patch = {
        footyMetrics: {
          role: "third-party-institution-compare",
          rows: matchedRows.slice(0, 12),
          direction,
          matchResult: oneX2 || null,
          tips,
          generatedAt: payload.generatedAt
        },
        thirdPartyCompare: {
          provider: "FootyMetrics",
          direction,
          matchResult: oneX2 || null,
          tips,
          generatedAt: payload.generatedAt
        },
        dataQuality: {
          real: ["FootyMetrics公开模型参考"],
          pending: []
        }
      };
      return patch;
    }
  };
}

function mergeQuality(match, patch) {
  const current = match.dataQuality || {};
  const incoming = patch.dataQuality || {};
  const cleanFootyMetrics = (items = []) => items.filter((item) => !String(item).includes("FootyMetrics"));
  const incomingReal = cleanFootyMetrics(incoming.real);
  if (patch.thirdPartyCompare?.provider === "FootyMetrics") {
    incomingReal.push("FootyMetrics第三方机构预测对比");
  }
  return {
    real: [...new Set([...cleanFootyMetrics(current.real), ...incomingReal])],
    derived: [...new Set([...cleanFootyMetrics(current.derived), ...cleanFootyMetrics(incoming.derived)])],
    estimated: [...new Set([...cleanFootyMetrics(current.estimated), ...cleanFootyMetrics(incoming.estimated)])],
    pending: [...new Set([...cleanFootyMetrics(current.pending), ...cleanFootyMetrics(incoming.pending)])]
      .filter((item) => !(incoming.real || []).includes(item))
  };
}

function applyPatch(match, patch) {
  if (!patch) return match;
  const merged = {
    ...match,
    ...patch,
    jcOdds: { ...(match.jcOdds || {}), ...(patch.jcOdds || {}) },
    sportteryMarkets: { ...(match.sportteryMarkets || {}), ...(patch.sportteryMarkets || {}) },
    intent: { ...(match.intent || {}), ...(patch.intent || {}) },
    oddsTrend: { ...(match.oddsTrend || {}), ...(patch.oddsTrend || {}) },
    formHistory: { ...(match.formHistory || {}), ...(patch.formHistory || {}) },
    fundamentals: { ...(match.fundamentals || {}), ...(patch.fundamentals || {}) },
    indicators: { ...(match.indicators || {}), ...(patch.indicators || {}) }
  };
  merged.dataQuality = mergeQuality(match, patch);
  return merged;
}

async function writePayload(target, payload) {
  await fs.writeFile(target.json, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(target.js, `window.${target.global} = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
}

async function main() {
  const overrides = normalizeProviderOverrides(await readJson(overridesPath, { matches: [] }));
  const aliases = await readJson(aliasesPath, { teams: {} });
  const apiFootball = normalizeApiFootball(await readJson(apiFootballPath, { matches: [] }), aliases);
  const oddsApiIo = normalizeOddsApiIo(await readJson(oddsApiIoPath, { matched: [] }));
  const clubElo = normalizeClubElo(await readJson(clubEloPath, { teams: [] }));
  const footyMetrics = normalizeFootyMetrics(await readJson(footyMetricsPath, { rows: [] }), aliases);
  const unmatched = [];
  const summary = [];

  for (const target of files) {
    const payload = await readJson(target.json, null);
    if (!payload || !Array.isArray(payload.matches)) continue;

    let applied = 0;
    payload.matches = payload.matches.map((match) => {
      const manualPatch = keyFor(match).map((key) => overrides.get(key)).find(Boolean);
      const apiPatch = apiFootball.findPatch(match);
      const oddsPatch = oddsApiIo.findPatch(match);
      const eloPatch = clubElo.findPatch(match);
      const footyPatch = footyMetrics.findPatch(match);
      const patch = manualPatch || apiPatch || oddsPatch || eloPatch || footyPatch
        ? applyPatch(applyPatch(applyPatch(applyPatch(applyPatch(match, apiPatch), oddsPatch), eloPatch), footyPatch), manualPatch)
        : null;
      if (manualPatch || apiPatch || oddsPatch || eloPatch || footyPatch) applied += 1;
      if (!apiPatch && match.source === "sporttery") {
        unmatched.push({
          id: match.id,
          jcNumber: match.jcNumber,
          utcDate: match.utcDate,
          home: match.home,
          away: match.away,
          candidates: apiFootball.candidates(match)
        });
      }
      return patch || match;
    });
    payload.enrichedAt = new Date().toISOString();
    payload.enrichment = {
      providerOverrides: applied,
      apiFootball: (await readJson(apiFootballPath, { matches: [] })).matches?.length ? "synced" : "no synced payload",
      oddsApiIo: (await readJson(oddsApiIoPath, { matched: [] })).matched?.length ? "synced" : "no synced payload",
      clubElo: (await readJson(clubEloPath, { teams: [] })).count ? "synced" : "no synced payload",
      footyMetrics: (await readJson(footyMetricsPath, { rows: [] })).rows?.length ? "synced" : "no synced payload",
      theSports: process.env.THESPORTS_KEY ? "configured" : "missing THESPORTS_KEY",
      theOddsApi: process.env.THE_ODDS_API_KEY ? "configured" : "missing THE_ODDS_API_KEY"
    };
    await writePayload(target, payload);
    summary.push(`${path.basename(target.json)}: ${payload.matches.length} matches, ${applied} override(s)`);
  }

  await fs.writeFile(unmatchedPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    unmatched
  }, null, 2), "utf8");
  console.log(summary.join("\n") || "No fixture payloads found.");
  if (!process.env.API_FOOTBALL_KEY || !process.env.THESPORTS_KEY || !process.env.THE_ODDS_API_KEY) {
    console.log("External paid providers are wired as config slots. Add keys to enable live provider fetches.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
