import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "football-data.local.json");
const outputPath = path.join(root, "data", "fixtures.json");
const generatedJsPath = path.join(root, "src", "generated-fixtures.js");
const baseUrl = "https://api.football-data.org/v4";

function normalizeDate(value) {
  if (value) return value;
  return new Date().toISOString().slice(0, 10);
}

async function readConfig() {
  let fileConfig = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    fileConfig = JSON.parse(raw);
  } catch {
    const exampleRaw = await fs.readFile(path.join(root, "config", "football-data.example.json"), "utf8");
    fileConfig = JSON.parse(exampleRaw);
  }

  return {
    ...fileConfig,
    footballDataToken: process.env.FOOTBALL_DATA_TOKEN || fileConfig.footballDataToken,
    dateFrom: process.env.DATE_FROM || fileConfig.dateFrom,
    dateTo: process.env.DATE_TO || fileConfig.dateTo
  };
}

function toLocalMatch(match, leagueName) {
  return {
    id: match.id,
    source: "football-data.org",
    league: leagueName || match.competition?.name || match.competition?.code,
    competitionCode: match.competition?.code,
    time: new Date(match.utcDate).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai"
    }),
    utcDate: match.utcDate,
    home: match.homeTeam?.shortName || match.homeTeam?.name || "主队待定",
    away: match.awayTeam?.shortName || match.awayTeam?.name || "客队待定",
    status: match.status,
    matchday: match.matchday,
    stage: match.stage,
    area: match.area?.name,
    marketName: "胜平负",
    odds: "待同步",
    level: "免费",
    seasonPhase: "常规赛季",
    xgHome: 1.45,
    xgAway: 1.1,
    eloHome: 1700,
    eloAway: 1700,
    institutional: [0.42, 0.29, 0.29],
    intent: {
      home: 60,
      draw: 50,
      away: 55,
      stars: 3,
      reason: "赛程已抓取，战意等待伤停与积分形势校验"
    },
    oddsTrend: { home: 0, draw: 0, away: 0 },
    formHistory: { home: 55, draw: 45, away: 50 },
    fundamentals: { form: 0, lineup: 0, homeEdge: 5, motivation: 0, tempo: 0 },
    indicators: { shots: 0, boxAttack: 0, possession: 0, xgTrend: 0 },
    ai: [0.42, 0.29, 0.29]
  };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": token
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  return response.json();
}

async function main() {
  const config = await readConfig();
  if (!config.footballDataToken || config.footballDataToken.includes("环境变量")) {
    throw new Error("Missing Football-Data token. Set FOOTBALL_DATA_TOKEN in the production environment.");
  }
  const dateFrom = normalizeDate(config.dateFrom);
  const dateTo = normalizeDate(config.dateTo || dateFrom);
  const competitionCodes = Object.keys(config.competitions || {});
  const matches = [];

  for (const code of competitionCodes) {
    const url = `${baseUrl}/competitions/${encodeURIComponent(code)}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    try {
      const payload = await fetchJson(url, config.footballDataToken);
      const leagueName = config.competitions[code];
      matches.push(...(payload.matches || []).map((match) => toLocalMatch(match, leagueName)));
      console.log(`OK ${code}: ${(payload.matches || []).length}`);
    } catch (error) {
      console.error(`FAIL ${code}: ${error.message}`);
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({
    source: "football-data.org",
    generatedAt: new Date().toISOString(),
    dateFrom,
    dateTo,
    count: matches.length,
    matches
  }, null, 2), "utf8");

  await fs.writeFile(generatedJsPath, `window.__FIXTURES_DATA__ = ${JSON.stringify({
    source: "football-data.org",
    generatedAt: new Date().toISOString(),
    dateFrom,
    dateTo,
    count: matches.length,
    matches
  }, null, 2)};\n`, "utf8");

  console.log(`Wrote ${matches.length} matches to ${outputPath}`);
  console.log(`Wrote browser data package to ${generatedJsPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
