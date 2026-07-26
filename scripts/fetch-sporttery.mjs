import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputPath = path.join(root, "data", "jincai-fixtures.json");
const generatedJsPath = path.join(root, "src", "generated-jincai-fixtures.js");
const endpoint = process.env.SPORTTERY_ENDPOINT || "https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry";

function pick(record, keys, fallback = "") {
  for (const key of keys) {
    if (record && record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return fallback;
}

function decimal(value, fallback = "待同步") {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : fallback;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function handicapLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const number = Number(text);
  if (!Number.isFinite(number) || number === 0) return "平手";
  return number > 0 ? `主受让${Math.abs(number)}球` : `主让${Math.abs(number)}球`;
}

function parseRank(value) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function rankEdge(homeRank, awayRank) {
  const home = parseRank(homeRank);
  const away = parseRank(awayRank);
  if (!home || !away) return 0;
  return Math.max(-18, Math.min(18, away - home)) * 1.4;
}

function scoreLabel(key) {
  const match = key.match(/^s(\d{2})s(\d{2})$/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : "";
}

function scoreOdds(crs = {}) {
  return Object.keys(crs)
    .map((key) => ({ label: scoreLabel(key), odds: numberOrNull(crs[key]) }))
    .filter((item) => item.label && item.odds)
    .sort((a, b) => a.odds - b.odds)
    .slice(0, 6);
}

function totalGoalOdds(ttg = {}) {
  return Object.keys(ttg)
    .map((key) => {
      const match = key.match(/^s(\d)$/);
      return match ? { label: `${match[1]}球`, odds: numberOrNull(ttg[key]) } : null;
    })
    .filter((item) => item && item.odds)
    .sort((a, b) => a.odds - b.odds)
    .slice(0, 6);
}

function halfFullOdds(hafu = {}) {
  const names = { h: "胜", d: "平", a: "负" };
  return Object.keys(hafu)
    .map((key) => {
      const match = key.match(/^([hda])([hda])$/);
      return match ? { label: `${names[match[1]]}/${names[match[2]]}`, odds: numberOrNull(hafu[key]) } : null;
    })
    .filter((item) => item && item.odds)
    .sort((a, b) => a.odds - b.odds)
    .slice(0, 6);
}

function updateStamp(pool = {}) {
  return [pool.updateDate, pool.updateTime].filter(Boolean).join(" ");
}

function previousTrend(previous, winOdds, drawOdds, loseOdds) {
  if (!previous?.jcOdds) return { home: 0, draw: 0, away: 0 };
  return {
    home: Number((Number(previous.jcOdds.win) - Number(winOdds)).toFixed(2)) || 0,
    draw: Number((Number(previous.jcOdds.draw) - Number(drawOdds)).toFixed(2)) || 0,
    away: Number((Number(previous.jcOdds.lose) - Number(loseOdds)).toFixed(2)) || 0
  };
}

function derivedXgFromMarkets(crs = {}, ttg = {}, rank = 0) {
  const scores = scoreOdds(crs);
  const bestScore = scores[0]?.label || "";
  const parts = bestScore.split("-").map(Number);
  const totals = totalGoalOdds(ttg);
  const bestTotal = Number((totals[0]?.label || "").replace("球", ""));
  const total = Number.isFinite(bestTotal) ? bestTotal : 2.5;
  const homeScore = Number.isFinite(parts[0]) ? parts[0] : 1;
  const awayScore = Number.isFinite(parts[1]) ? parts[1] : 1;
  const scoreTotal = Math.max(1, homeScore + awayScore);
  const rankBoost = Math.max(-0.18, Math.min(0.18, rank / 120));
  return {
    home: Number(Math.max(0.25, (total * (homeScore / scoreTotal)) + 0.25 + rankBoost).toFixed(2)),
    away: Number(Math.max(0.25, (total * (awayScore / scoreTotal)) + 0.25 - rankBoost).toFixed(2))
  };
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data?.matches)) return payload.data.matches;
  if (Array.isArray(payload?.value?.matches)) return payload.value.matches;
  if (Array.isArray(payload?.value?.matchInfoList)) {
    return payload.value.matchInfoList.flatMap((group) => Array.isArray(group.subMatchList) ? group.subMatchList : []);
  }
  if (payload?.data && typeof payload.data === "object") {
    return Object.values(payload.data).flatMap((value) => Array.isArray(value) ? value : []);
  }
  return [];
}

function toLocalMatch(record, index, previousByNumber = new Map()) {
  const jcNumber = String(pick(record, ["num", "matchNum", "match_num", "matchId", "id"], `竞彩${index + 1}`));
  const league = pick(record, ["leagueName", "leagueAbbName", "leagueAllName", "league", "l_cn", "competitionName"], "竞彩");
  const home = pick(record, ["homeTeamAbbName", "homeTeamAllName", "homeTeam", "home", "h_cn", "hostName", "homeTeamName"], "主队待定");
  const away = pick(record, ["awayTeamAbbName", "awayTeamAllName", "awayTeam", "away", "a_cn", "guestName", "awayTeamName"], "客队待定");
  const matchDate = pick(record, ["matchDate", "businessDate", "date", "b_date"], "");
  const matchTime = pick(record, ["matchTime", "startTime", "time"], "");
  const startTime = matchTime || matchDate;
  const had = record.had || record.HAD || record.spf || {};
  const hhad = record.hhad || record.HHAD || record.rqspf || {};
  const crs = record.crs || {};
  const ttg = record.ttg || {};
  const hafu = record.hafu || {};
  const winOdds = decimal(pick(record, ["h", "win", "oddsWin"], had.h || had.home || had.win || had.hadH));
  const drawOdds = decimal(pick(record, ["d", "draw", "oddsDraw"], had.d || had.draw || had.hadD));
  const loseOdds = decimal(pick(record, ["a", "lose", "oddsLose"], had.a || had.away || had.lose || had.hadA));
  const handicap = pick(record, ["handicap", "fixedodds", "goalLine", "goalLineValue", "rq"], hhad.handicap || hhad.goalLine || hhad.goalLineValue || "");
  const homeRank = record.homeRank || "";
  const awayRank = record.awayRank || "";
  const edge = rankEdge(homeRank, awayRank);
  const derivedXg = derivedXgFromMarkets(crs, ttg, edge);
  const previous = previousByNumber.get(jcNumber);
  const trend = previousTrend(previous, winOdds, drawOdds, loseOdds);

  return {
    id: `jc-${jcNumber}`,
    source: "sporttery",
    jcNumber,
    league,
    time: matchTime ? String(matchTime).slice(0, 5) : "待定",
    utcDate: matchDate || startTime || null,
    home,
    away,
    homeRank,
    awayRank,
    status: pick(record, ["status", "sellStatus", "matchStatus"], "销售中"),
    marketName: "竞彩胜平负",
    odds: winOdds,
    jcOdds: {
      win: winOdds,
      draw: drawOdds,
      lose: loseOdds,
      handicap,
      handicapLabel: handicapLabel(handicap),
      handicapWin: decimal(hhad.h || hhad.home || hhad.win || hhad.hhadH),
      handicapDraw: decimal(hhad.d || hhad.draw || hhad.hhadD),
      handicapLose: decimal(hhad.a || hhad.away || hhad.lose || hhad.hhadA)
    },
    level: "免费",
    seasonPhase: "常规赛季",
    xgHome: derivedXg.home,
    xgAway: derivedXg.away,
    eloHome: Math.round(1700 + edge * 3),
    eloAway: Math.round(1700 - edge * 3),
    institutional: normalizeOdds([winOdds, drawOdds, loseOdds]),
    intent: { home: 55 + Math.max(0, edge), draw: 50, away: 55 + Math.max(0, -edge), stars: 3, reason: `${homeRank || "主队排名待校验"} vs ${awayRank || "客队排名待校验"}，战意/伤停等待赛前情报校验` },
    oddsTrend: trend,
    formHistory: { home: 52 + Math.max(0, edge), draw: 45, away: 52 + Math.max(0, -edge) },
    fundamentals: { form: 0, lineup: 0, homeEdge: 5, motivation: 0, tempo: 0 },
    indicators: { shots: 0, boxAttack: 0, possession: 0, xgTrend: 0 },
    ai: normalizeOdds([winOdds, drawOdds, loseOdds]),
    sportteryMarkets: {
      scoreOdds: scoreOdds(crs),
      totalGoalOdds: totalGoalOdds(ttg),
      halfFullOdds: halfFullOdds(hafu),
      updateTimes: {
        spf: updateStamp(had),
        handicap: updateStamp(hhad),
        score: updateStamp(crs),
        totalGoals: updateStamp(ttg),
        halfFull: updateStamp(hafu)
      }
    },
    dataQuality: {
      real: ["竞彩场次", "胜平负SP", "让球SP", "让球方向", "比分SP", "总进球SP", "半全场SP", "球队排名"],
      derived: ["xG由竞彩比分/总进球SP反推", "ELO由排名差临时折算", "近期状态由排名与市场概率辅助"],
      pending: ["伤停阵容", "完整积分形势", "赛后赛果", "第三方真实xG/ELO"]
    }
  };
}

function normalizeOdds(values) {
  const implied = values.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 1 ? 1 / number : 0;
  });
  const total = implied.reduce((sum, value) => sum + value, 0);
  return total > 0 ? implied.map((value) => value / total) : [0.42, 0.29, 0.29];
}

async function fetchSporttery() {
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "VioletGoal/1.0 (+football prediction dashboard)",
      "Accept": "application/json,text/plain,*/*",
      "Referer": "https://m.sporttery.cn/"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  const text = await response.text();
  return JSON.parse(text);
}

async function writePayload(payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(generatedJsPath, `window.__JINCAI_DATA__ = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
}

async function readPreviousMatches() {
  try {
    const raw = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(raw);
    return new Map((payload.matches || []).map((match) => [String(match.jcNumber), match]));
  } catch {
    return new Map();
  }
}

async function main() {
  const previousByNumber = await readPreviousMatches();
  const payload = await fetchSporttery();
  const rows = normalizeRows(payload);
  const matches = rows.map((record, index) => toLocalMatch(record, index, previousByNumber)).filter((match) => match.home !== "主队待定" || match.away !== "客队待定");
  const output = {
    source: "sporttery",
    endpoint,
    generatedAt: new Date().toISOString(),
    count: matches.length,
    matches
  };
  await writePayload(output);
  console.log(`Wrote ${matches.length} sporttery matches to ${outputPath}`);
  console.log(`Wrote browser data package to ${generatedJsPath}`);
}

main().catch(async (error) => {
  const fallback = {
    source: "sporttery",
    endpoint,
    generatedAt: new Date().toISOString(),
    count: 0,
    error: error.message,
    matches: []
  };
  await writePayload(fallback);
  console.error(`Sporttery sync failed: ${error.message}`);
  process.exitCode = 1;
});
