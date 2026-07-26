const dataMatches = [
  ...((window.__JINCAI_DATA__ && Array.isArray(window.__JINCAI_DATA__.matches)) ? window.__JINCAI_DATA__.matches : []),
  ...((window.__FIXTURES_DATA__ && Array.isArray(window.__FIXTURES_DATA__.matches)) ? window.__FIXTURES_DATA__.matches : [])
];

const fallbackMatches = [
  {
    id: "demo-001",
    league: "英超",
    time: "20:30",
    home: "曼彻斯特城",
    away: "纽卡斯尔联",
    odds: "1.58",
    jcOdds: { win: "1.58", draw: "3.90", lose: "5.20", handicap: "-1", handicapLabel: "主让1球", handicapWin: "2.20", handicapDraw: "3.45", handicapLose: "2.62" },
    xgHome: 2.05,
    xgAway: 0.92,
    eloHome: 1908,
    eloAway: 1764,
    intent: { stars: 5, reason: "争冠关键战，主队战意强" },
    dataQuality: { real: ["演示场次"], derived: ["演示模型"], pending: ["真实赛果"] }
  }
];

const matches = dataMatches.length ? dataMatches : fallbackMatches;
const now = new Date();
const resultStatuses = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "FT", "AET", "PEN", "已完赛"]);

function kickOffTime(match) {
  const dateText = String(match.utcDate || "").slice(0, 10);
  const timeText = String(match.time || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return null;
  return new Date(`${dateText}T${timeText}:00+08:00`);
}

function isSportteryMatch(match) {
  return match.source === "sporttery" || Boolean(match.jcNumber);
}

function isNightRecordMatch(match) {
  const hour = Number(String(match.time || "").slice(0, 2));
  return Number.isFinite(hour) && (hour >= 22 || hour < 10);
}

function hasStarted(match) {
  const status = String(match.apiFootball?.status || match.result?.status || "").toUpperCase();
  if (resultStatuses.has(status) || resultStatuses.has(match.result?.status)) return true;
  const kickOff = kickOffTime(match);
  return kickOff ? kickOff <= now : false;
}

function isHomePredictionMatch(match) {
  return isSportteryMatch(match) && !isNightRecordMatch(match) && !hasStarted(match);
}

function isRecordWaitingMatch(match) {
  return isSportteryMatch(match) && (isNightRecordMatch(match) || hasStarted(match) || Boolean(match.result?.score || match.score));
}

const homePredictionMatches = matches.filter(isHomePredictionMatch);
const recordWaitingMatches = matches.filter(isRecordWaitingMatch);
let activeLeague = "全部";

const leagueCloud = document.querySelector("#leagueCloud");
const sideLeagues = document.querySelector("#sideLeagues");
const matchFeed = document.querySelector("#matchFeed");
const feedTitle = document.querySelector("#feedTitle");
const searchInput = document.querySelector("#searchInput");
const allBtn = document.querySelector("#allBtn");
const dataStatus = document.querySelector("#dataStatus");
const liveClock = document.querySelector("#liveClock");
const heroAccuracy = document.querySelector("#heroAccuracy");
const heroIndexMove = document.querySelector("#heroIndexMove");
const heroXgEdge = document.querySelector("#heroXgEdge");
const heroRisk = document.querySelector("#heroRisk");
const liveGrid = document.querySelector("#liveGrid");

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function normalize(values) {
  const total = values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  return total ? values.map((value) => Math.max(0, Number(value) || 0) / total) : [0.42, 0.29, 0.29];
}

function poisson(goalCount, expectedGoals) {
  let factorial = 1;
  for (let index = 2; index <= goalCount; index += 1) factorial *= index;
  return (Math.exp(-expectedGoals) * Math.pow(expectedGoals, goalCount)) / factorial;
}

function marketProbabilities(match) {
  const odds = match.jcOdds ? [match.jcOdds.win, match.jcOdds.draw, match.jcOdds.lose] : [];
  const implied = odds.map((item) => {
    const number = Number(item);
    return Number.isFinite(number) && number > 1 ? 1 / number : 0;
  });
  return normalize(implied);
}

function calculateModel(match) {
  const homeXg = Math.max(0.15, Number(match.xgHome || 1.35));
  const awayXg = Math.max(0.15, Number(match.xgAway || 1.05));
  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let btts = 0;
  const scores = [];

  for (let h = 0; h <= 5; h += 1) {
    for (let a = 0; a <= 5; a += 1) {
      const probability = poisson(h, homeXg) * poisson(a, awayXg);
      if (h > a) home += probability;
      if (h === a) draw += probability;
      if (h < a) away += probability;
      if (h + a > 2.5) over25 += probability;
      if (h > 0 && a > 0) btts += probability;
      scores.push({ score: `${h}-${a}`, probability });
    }
  }

  const market = marketProbabilities(match);
  const model = normalize([home, draw, away].map((value, index) => value * 0.55 + market[index] * 0.45));
  const labels = ["主胜", "平局", "客胜"];
  const pickIndex = model.indexOf(Math.max(...model));
  const ranked = [...model].sort((a, b) => b - a);
  const lead = ranked[0] - ranked[1];
  const confidence = Math.round(Math.max(55, Math.min(88, 46 + ranked[0] * 45 + lead * 70)));
  const topScores = scores.sort((a, b) => b.probability - a.probability).slice(0, 2);
  const marketEdge = Math.round(Math.max(...model.map((value, index) => Math.abs(value - market[index]))) * 100);

  return {
    probabilities: model,
    market,
    pick: labels[pickIndex],
    confidence,
    scorePair: topScores.map((item) => item.score).join(" / "),
    over25,
    btts,
    homeXg,
    awayXg,
    marketEdge,
    goalsPick: over25 >= 0.5 ? "大 2.5 球" : "小 2.5 球",
    risk: confidence >= 75 ? "低" : confidence >= 65 ? "中" : "高",
    scores: topScores
  };
}

function trustTags(match) {
  const quality = match.dataQuality || {};
  const real = (quality.real || []).length;
  const derived = (quality.derived || []).length + (quality.estimated || []).length;
  const pending = (quality.pending || []).length;
  return `
    <div class="trust-tags">
      <span class="real">真实 ${real}</span>
      <span class="derived">派生 ${derived}</span>
      <span class="pending">待校验 ${pending}</span>
    </div>
  `;
}

function handicapText(match) {
  const odds = match.jcOdds;
  if (!odds || !odds.handicap) return "";
  return odds.handicapLabel || (Number(odds.handicap) > 0 ? `主受让${Math.abs(Number(odds.handicap))}球` : `主让${Math.abs(Number(odds.handicap))}球`);
}

function leagueGroups() {
  const map = new Map();
  for (const match of homePredictionMatches) {
    const league = match.league || "其他";
    map.set(league, (map.get(league) || 0) + 1);
  }
  return [["竞彩", "JC", homePredictionMatches.length], ...[...map.entries()].map(([league, count]) => [league, league, count])];
}

function renderLeagues() {
  const groups = leagueGroups();
  if (leagueCloud) {
    leagueCloud.innerHTML = groups.map(([name, code, count]) => `
      <button class="league-card" data-league="${name}">
        <span>${code}</span><strong>${name}</strong><small>${count} 场今日比赛</small>
      </button>
    `).join("");
  }
  if (sideLeagues) {
    sideLeagues.innerHTML = groups.map(([name, code, count]) => `
      <button class="side-league" data-league="${name}">
        <span>${code}</span><strong>${name}</strong><small>${count}</small>
      </button>
    `).join("");
  }
  document.querySelectorAll("[data-league]").forEach((button) => {
    button.addEventListener("click", () => {
      activeLeague = button.dataset.league || "全部";
      document.querySelectorAll("[data-league]").forEach((item) => {
        item.classList.toggle("selected", item.dataset.league === activeLeague);
      });
      document.querySelector("#predictions")?.scrollIntoView({ behavior: "smooth" });
      renderMatches();
    });
  });
}

function renderMatches() {
  if (!matchFeed) return;
  const query = (searchInput?.value || "").trim().toLowerCase();
  const filtered = homePredictionMatches.filter((match) => {
    const inLeague = activeLeague === "全部" || activeLeague === "竞彩" || match.league === activeLeague;
    const text = `${match.home} ${match.away} ${match.league} ${match.jcNumber || ""}`.toLowerCase();
    return inLeague && (!query || text.includes(query));
  });
  if (feedTitle) feedTitle.textContent = activeLeague === "全部" ? "今日比赛推荐" : `${activeLeague}比赛推荐`;
  if (!filtered.length) {
    matchFeed.innerHTML = `<article class="empty-state">当前分类暂无已同步场次，请切换“全部”或“竞彩”。</article>`;
    return;
  }
  matchFeed.innerHTML = filtered.map((match) => {
    const model = calculateModel(match);
    const thirdParty = match.thirdPartyCompare || match.footyMetrics;
    const thirdPartyLine = thirdParty?.direction ? `<small>机构对比 ${thirdParty.provider || "FootyMetrics"}：${thirdParty.direction.selection || "待确认"}</small>` : "";
    return `
      <article class="match-card tilt-card" data-detail-id="${match.id}" role="button" tabindex="0" aria-label="查看${match.home}对${match.away}详细解读">
        <div class="match-meta">
          <span>${match.jcNumber ? `${match.jcNumber} · ${match.league}` : match.league}</span><b>${match.time || "--:--"}</b><small>${match.jcNumber ? "竞彩" : "模型"}</small>
        </div>
        <div class="teams"><strong>${match.home}</strong><span>VS</span><strong>${match.away}</strong></div>
        <div class="tip-grid">
          <div class="info"><span>胜平负方向</span><b>${model.pick}</b></div>
          <div class="info"><span>比分倾向</span><b>${model.scorePair}</b></div>
          <div class="info"><span>大小球</span><b>${model.goalsPick}</b></div>
          <div class="info"><span>参考赔率</span><b>${match.odds || match.jcOdds?.win || "--"}</b></div>
        </div>
        <div class="prob-grid">
          <span>主胜 ${percent(model.probabilities[0])}</span>
          <span>平局 ${percent(model.probabilities[1])}</span>
          <span>客胜 ${percent(model.probabilities[2])}</span>
          <span>大2.5 ${percent(model.over25)}</span>
          <span>BTTS ${percent(model.btts)}</span>
        </div>
        <div class="module-grid">
          <span>战意 ${match.intent?.stars || 3}星</span>
          <span>赔率 竞彩SP</span>
          <span>三维权重 战意/赔率/状态</span>
          <span>数据源 ${match.source || "local"}</span>
        </div>
        <div class="model-note">
          ${thirdPartyLine}
          <span>${match.intent?.reason || "战意与阵容等待赛前校验"} · xG ${model.homeXg.toFixed(2)}-${model.awayXg.toFixed(2)}</span>
          <b>${match.jcOdds ? `竞彩SP ${match.jcOdds.win}/${match.jcOdds.draw}/${match.jcOdds.lose} · ${handicapText(match)}` : ""} 机构分歧 ${model.marketEdge}% · 风险${model.risk}</b>
          ${trustTags(match)}
        </div>
        <div class="confidence"><span>三维优先信心</span><div><i style="width:${model.confidence}%"></i></div><b>${model.confidence}%</b></div>
      </article>
    `;
  }).join("");
  document.querySelectorAll("[data-detail-id]").forEach((card) => {
    const open = () => {
      window.location.href = `./match.html?id=${encodeURIComponent(card.dataset.detailId)}`;
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open();
    });
  });
}

function updateHero() {
  const models = homePredictionMatches.map(calculateModel);
  const avgConfidence = models.reduce((sum, model) => sum + model.confidence, 0) / Math.max(1, models.length);
  const avgXg = models.reduce((sum, model) => sum + Math.abs(model.homeXg - model.awayXg), 0) / Math.max(1, models.length);
  const avgEdge = models.reduce((sum, model) => sum + model.marketEdge, 0) / Math.max(1, models.length);
  if (heroAccuracy) heroAccuracy.textContent = `${avgConfidence.toFixed(1)}%`;
  if (heroIndexMove) heroIndexMove.textContent = `分歧${Math.round(avgEdge)}%`;
  if (heroXgEdge) heroXgEdge.textContent = avgXg.toFixed(2);
  if (heroRisk) heroRisk.textContent = avgConfidence >= 72 ? "低" : avgConfidence >= 62 ? "中" : "高";
}

function updateRecords() {
  const count = recordWaitingMatches.length;
  document.querySelector("#recordYesterdayCount") && (document.querySelector("#recordYesterdayCount").textContent = `0 / ${count}`);
  document.querySelector("#recordYesterdayRate") && (document.querySelector("#recordYesterdayRate").textContent = "待结算");
  document.querySelector("#recordYesterdayUnits") && (document.querySelector("#recordYesterdayUnits").textContent = "截至当前时间");
  document.querySelector("#recordWeekCount") && (document.querySelector("#recordWeekCount").textContent = `0 / ${count}`);
  document.querySelector("#recordWeekRate") && (document.querySelector("#recordWeekRate").textContent = "待结算");
  document.querySelector("#recordWeekUnits") && (document.querySelector("#recordWeekUnits").textContent = "截至当前时间");
  document.querySelector("#recordMonthCount") && (document.querySelector("#recordMonthCount").textContent = `0 / ${count}`);
  document.querySelector("#recordMonthRate") && (document.querySelector("#recordMonthRate").textContent = "待结算");
  document.querySelector("#recordMonthUnits") && (document.querySelector("#recordMonthUnits").textContent = "截至当前时间");
}

function updateClock() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const currentTime = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (liveClock) liveClock.textContent = currentTime;
  ["recordYesterdayUnits", "recordWeekUnits", "recordMonthUnits"].forEach((id) => {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = `截至 ${currentTime}`;
  });
}

function renderLiveGrid() {
  if (!liveGrid) return;
  liveGrid.innerHTML = homePredictionMatches.slice(0, 6).map((match) => `
    <article class="live-card"><span>竞彩 ${match.jcNumber || ""}</span><strong>${match.home} vs ${match.away}</strong><small>${match.time || "--:--"} · ${match.jcOdds ? `SP ${match.jcOdds.win}/${match.jcOdds.draw}/${match.jcOdds.lose}` : "等待指数"}</small></article>
  `).join("");
}

allBtn?.addEventListener("click", () => {
  activeLeague = "全部";
  renderMatches();
});
searchInput?.addEventListener("input", renderMatches);

if (dataStatus) {
  const source = window.__JINCAI_DATA__ || window.__FIXTURES_DATA__;
  dataStatus.textContent = `首页预测：${homePredictionMatches.length} 场 · 命中纪录待回传：${recordWaitingMatches.length} 场 · ${source?.enrichedAt || source?.generatedAt || "等待同步"}`;
}

renderLeagues();
renderMatches();
renderLiveGrid();
updateHero();
updateRecords();
updateClock();
setInterval(updateClock, 1000);
