const pageMatches = [
  ...((window.__JINCAI_DATA__ && Array.isArray(window.__JINCAI_DATA__.matches)) ? window.__JINCAI_DATA__.matches : []),
  ...((window.__FIXTURES_DATA__ && Array.isArray(window.__FIXTURES_DATA__.matches)) ? window.__FIXTURES_DATA__.matches : [])
];

function pageHeader(active) {
  return `
    <header class="site-header">
      <div class="nav">
        <a class="logo" href="./index.html"><span>球</span><strong>紫域进球</strong></a>
        <nav>
          <a href="./index.html#predictions">今日预测</a>
          <a class="${active === "results" ? "active" : ""}" href="./results.html">命中记录</a>
          <a class="${active === "live" ? "active" : ""}" href="./live.html">实时直播</a>
        </nav>
        <div class="nav-actions">
          <button class="outline-button">中文</button>
          <a class="solid-button" href="./login.html">登录</a>
        </div>
      </div>
    </header>
  `;
}

function pagePercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function pageExactPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function pageProviderPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number > 1 ? `${Math.round(number)}%` : pagePercent(number);
}

function pageNormalize(values) {
  const total = values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  return total ? values.map((value) => Math.max(0, Number(value) || 0) / total) : [0.42, 0.29, 0.29];
}

function pagePoisson(goalCount, expectedGoals) {
  let factorial = 1;
  for (let index = 2; index <= goalCount; index += 1) factorial *= index;
  return (Math.exp(-expectedGoals) * Math.pow(expectedGoals, goalCount)) / factorial;
}

function pageMarket(match) {
  const odds = match.jcOdds ? [match.jcOdds.win, match.jcOdds.draw, match.jcOdds.lose] : [];
  return pageNormalize(odds.map((item) => {
    const number = Number(item);
    return Number.isFinite(number) && number > 1 ? 1 / number : 0;
  }));
}

function pagePoissonModel(match) {
  const homeXg = Math.max(0.15, Number(match.xgHome || 1.35));
  const awayXg = Math.max(0.15, Number(match.xgAway || 1.05));
  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let btts = 0;
  const scores = [];
  for (let h = 0; h <= 6; h += 1) {
    for (let a = 0; a <= 6; a += 1) {
      const probability = pagePoisson(h, homeXg) * pagePoisson(a, awayXg);
      if (h > a) home += probability;
      if (h === a) draw += probability;
      if (h < a) away += probability;
      if (h + a > 2.5) over25 += probability;
      if (h > 0 && a > 0) btts += probability;
      scores.push({ score: `${h}-${a}`, probability });
    }
  }
  return {
    probabilities: pageNormalize([home, draw, away]),
    over25,
    btts,
    homeXg,
    awayXg,
    scores: scores.sort((a, b) => b.probability - a.probability).slice(0, 5)
  };
}

function pageMatchModel(match) {
  const poisson = pagePoissonModel(match);
  const market = pageMarket(match);
  const probabilities = pageNormalize(poisson.probabilities.map((value, index) => value * 0.55 + market[index] * 0.45));
  const labels = ["主胜", "平局", "客胜"];
  const pickIndex = probabilities.indexOf(Math.max(...probabilities));
  const ranked = [...probabilities].sort((a, b) => b - a);
  const lead = ranked[0] - ranked[1];
  const marketEdge = Math.round(Math.max(...probabilities.map((value, index) => Math.abs(value - market[index]))) * 100);
  return {
    pick: labels[pickIndex],
    confidence: Math.round(Math.max(55, Math.min(88, 46 + ranked[0] * 45 + lead * 70))),
    probabilities,
    poisson,
    market,
    marketEdge
  };
}

function pageQualityTags(match) {
  const quality = match.dataQuality || {};
  const real = (quality.real || []).length;
  const derived = (quality.derived || []).length + (quality.estimated || []).length;
  const pending = (quality.pending || []).length;
  return `
    <div class="trust-tags" aria-label="数据可信度">
      <span class="real">真实 ${real}</span>
      <span class="derived">派生 ${derived}</span>
      <span class="pending">待校验 ${pending}</span>
    </div>
  `;
}

function pageScoreParts(score) {
  const match = String(score || "").match(/(\d+)\s*[-:]\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function pagePredictionLock(match) {
  const dateText = String(match.utcDate || "").slice(0, 10);
  const timeText = String(match.time || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) {
    return { text: "等待赛程时间", policy: "锁定时间待定" };
  }
  const [hour] = timeText.split(":").map(Number);
  const kickOff = new Date(`${dateText}T${timeText}:00+08:00`);
  let deadline;
  let policy;
  if (hour >= 22 || hour < 11) {
    deadline = new Date(kickOff);
    if (hour < 11) deadline.setUTCDate(deadline.getUTCDate() - 1);
    deadline.setUTCHours(13, 0, 0, 0);
    policy = "夜间场次 · 21:00 锁定";
  } else {
    deadline = new Date(kickOff.getTime() - 60 * 60 * 1000);
    policy = "常规场次 · 赛前 1 小时锁定";
  }
  return {
    date: deadline,
    text: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(deadline).replace(/\//g, "-"),
    policy
  };
}

function pageReviewMarkets(match, model, parts) {
  const predictedScores = model.poisson.scores.slice(0, 2).map((item) => item.score);
  const overPick = model.poisson.over25 >= 0.5 ? "大 2.5" : "小 2.5";
  const bttsPick = model.poisson.btts >= 0.5 ? "是" : "否";
  const handicap = Number(match.jcOdds?.handicap);
  const handicapOdds = [match.jcOdds?.handicapWin, match.jcOdds?.handicapDraw, match.jcOdds?.handicapLose].map(Number);
  const handicapLabels = ["让胜", "让平", "让负"];
  const handicapPick = handicapOdds.every((value) => Number.isFinite(value) && value > 1)
    ? handicapLabels[handicapOdds.indexOf(Math.min(...handicapOdds))]
    : "待同步";
  const actualGoals = parts ? parts[0] + parts[1] : null;
  const actualBtts = parts ? parts[0] > 0 && parts[1] > 0 : null;
  let handicapActual = null;
  if (parts && Number.isFinite(handicap)) {
    const adjustedHome = parts[0] + handicap;
    handicapActual = adjustedHome > parts[1] ? "让胜" : adjustedHome === parts[1] ? "让平" : "让负";
  }
  const rows = [
    { market: "胜平负", pick: model.pick, actual: parts ? (parts[0] > parts[1] ? "主胜" : parts[0] === parts[1] ? "平局" : "客胜") : null },
    { market: "比分", pick: predictedScores.join(" / "), actual: parts ? `${parts[0]}-${parts[1]}` : null, hit: parts ? predictedScores.includes(`${parts[0]}-${parts[1]}`) : null },
    { market: "大小球", pick: overPick, actual: parts ? (actualGoals > 2.5 ? "大 2.5" : "小 2.5") : null },
    { market: "双方进球", pick: bttsPick, actual: parts ? (actualBtts ? "是" : "否") : null },
    { market: match.jcOdds?.handicapLabel || "让球胜平负", pick: handicapPick, actual: handicapActual },
    { market: "半全场", pick: model.pick === "主胜" ? "平胜 / 胜胜" : model.pick === "客胜" ? "平负 / 负负" : "平平 / 胜平", actual: match.result?.halfTime || null, unavailable: parts && !match.result?.halfTime }
  ];
  return rows.map((row) => {
    const hit = row.hit ?? (row.actual ? row.pick.split(" / ").includes(row.actual) : null);
    const status = row.unavailable ? "数据不足" : hit === null ? "待赛果" : hit ? "命中" : "未中";
    const statusClass = row.unavailable ? "pending" : hit === null ? "pending" : hit ? "hit" : "miss";
    return { ...row, status, statusClass };
  });
}

function pageSettlement(match) {
  const parts = pageScoreParts(match.result?.score || match.score);
  if (!parts) {
    return { score: "待赛果", resultText: "待结算", hitText: "待定", hitClass: "pending", statusText: "赛后回填后自动结算" };
  }
  const model = pageMatchModel(match);
  const [homeGoals, awayGoals] = parts;
  const resultIndex = homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
  const pickIndex = model.probabilities.indexOf(Math.max(...model.probabilities));
  const labels = ["主胜", "平局", "客胜"];
  const scoreHit = model.poisson.scores.slice(0, 2).some((item) => item.score === `${homeGoals}-${awayGoals}`);
  const directionHit = pickIndex === resultIndex;
  return {
    score: `${homeGoals}-${awayGoals}`,
    resultText: labels[resultIndex],
    hitText: directionHit ? "方向命中" : "方向未中",
    hitClass: directionHit ? "hit" : "miss",
    statusText: `模型方向 ${labels[pickIndex]} · 比分前二 ${scoreHit ? "命中" : "未中"}`
  };
}

function pageOddsTripletFromJc(match) {
  const odds = match.jcOdds || {};
  const values = [Number(odds.win), Number(odds.draw), Number(odds.lose)];
  return values.every((item) => Number.isFinite(item) && item > 1) ? values : null;
}

function pageOddsImplied(values) {
  if (!values) return null;
  const implied = values.map((value) => 1 / value);
  const total = implied.reduce((sum, value) => sum + value, 0);
  return total ? implied.map((value) => value / total) : null;
}

function pageOuterOddsTriplet(match) {
  const odds = match.oddsApiIo?.odds;
  if (!odds) return null;
  const values = [odds.home || odds.homeWin || odds.win, odds.draw, odds.away || odds.awayWin || odds.lose].map(Number);
  return values.every((item) => Number.isFinite(item) && item > 1) ? values : null;
}

function pageMarketCompare(match, model) {
  const labels = ["主胜", "平局", "客胜"];
  const jcOdds = pageOddsTripletFromJc(match);
  const jcProb = pageOddsImplied(jcOdds);
  const outerOdds = pageOuterOddsTriplet(match);
  const outerProb = pageOddsImplied(outerOdds);
  const rows = labels.map((label, index) => `
    <div class="compare-row">
      <b>${label}</b>
      <span>${pagePercent(model.probabilities[index])}</span>
      <span>${jcOdds ? `${jcOdds[index].toFixed(2)} / ${pagePercent(jcProb[index])}` : "待同步"}</span>
      <span>${outerOdds ? `${outerOdds[index].toFixed(2)} / ${pagePercent(outerProb[index])}` : "待同步"}</span>
    </div>
  `).join("");
  return `
    <div class="analysis-block market-compare-block">
      <span class="label">赔率交叉校验</span>
      <h2>模型概率 vs 竞彩SP vs 外围赔率</h2>
      <div class="compare-table">
        <div class="compare-row compare-head"><b>方向</b><span>模型概率</span><span>竞彩SP / 隐含概率</span><span>外围赔率 / 隐含概率</span></div>
        ${rows}
      </div>
      <p>外围赔率只有赛事匹配时不会参与结论，必须拿到具体赔率后才进入加权校验。</p>
    </div>
  `;
}

function pageRecommendations(match, model) {
  const scorePicks = model.poisson.scores.slice(0, 2);
  const handicap = match.jcOdds?.handicapLabel || "让球待同步";
  const goals = model.poisson.over25 >= 0.5 ? `大 2.5（${pageExactPercent(model.poisson.over25)}）` : `小 2.5（${pageExactPercent(1 - model.poisson.over25)}）`;
  return [
    ["胜平负", model.pick],
    ["让球胜平负", handicap],
    ["比分", scorePicks.map((item) => `${item.score}（${pageExactPercent(item.probability)}）`).join(" / ")],
    ["进球", goals],
    ["半全场", model.pick === "主胜" ? "平胜 / 胜胜" : model.pick === "客胜" ? "平负 / 负负" : "平平 / 胜平"]
  ].map(([name, value]) => `
    <article><span>${name}</span><strong>${value}</strong></article>
  `).join("");
}

function pageThirdPartyComparison(match) {
  const compare = match.thirdPartyCompare || match.footyMetrics;
  if (!compare || (!compare.matchResult && !compare.direction && !(compare.tips || []).length)) return "";
  const result = compare.matchResult;
  const resultRows = result ? [
    ["主胜", result.home?.prob, result.home?.odds],
    ["平局", result.draw?.prob, result.draw?.odds],
    ["客胜", result.away?.prob, result.away?.odds]
  ].map(([label, probability, odds]) => `
    <article><span>${label}</span><strong>${pageProviderPercent(probability)}</strong><small>${Number.isFinite(Number(odds)) ? `参考 ${Number(odds).toFixed(2)}` : "赔率待同步"}</small></article>
  `).join("") : "";
  const tips = (compare.tips || []).slice(0, 4).map((tip) => `
    <section><b>${tip.market || "机构建议"}</b><p>${tip.selection || "待确认"}${Number.isFinite(Number(tip.probability)) ? `，概率 ${pageProviderPercent(tip.probability)}` : ""}</p></section>
  `).join("");
  return `
    <div class="analysis-block third-party-block">
      <span class="label">第三方机构对比</span>
      <h2>${compare.provider || "FootyMetrics"} 公开预测参考</h2>
      <p>这部分作为外部机构结果对照，不覆盖本站三维加权主模型。</p>
      ${resultRows ? `<div class="institution-grid">${resultRows}</div>` : ""}
      <div class="detail-grid">${tips}</div>
    </div>
  `;
}

function renderResultsPage() {
  document.body.insertAdjacentHTML("afterbegin", pageHeader("results"));
  const root = document.querySelector("#pageRoot");
  const archivedMatches = Object.values(window.__MATCH_HISTORY__?.matches || {});
  const resultMatches = (archivedMatches.length ? archivedMatches : pageMatches)
    .sort((a, b) => `${b.utcDate || ""} ${b.time || ""}`.localeCompare(`${a.utcDate || ""} ${a.time || ""}`));
  const completedMatches = resultMatches.filter((match) => pageScoreParts(match.result?.score || match.score));
  const hits = completedMatches.filter((match) => pageSettlement(match).hitClass === "hit");
  const leagues = [...new Set(completedMatches.map((match) => match.league).filter(Boolean))].sort();

  const rows = completedMatches.map((match, index) => {
    const settlement = pageSettlement(match);
    const model = pageMatchModel(match);
    const scoreParts = pageScoreParts(match.result?.score || match.score);
    const scoreHit = scoreParts
      ? model.poisson.scores.slice(0, 2).some((item) => item.score === `${scoreParts[0]}-${scoreParts[1]}`)
      : false;
    return `
      <div class="result-row result-row-rich" role="button" tabindex="0"
        data-result-index="${index}" data-league="${match.league || ""}"
        data-status="${settlement.hitClass}" aria-label="打开 ${match.home} 对 ${match.away} 的赛后复盘">
        <span>${match.jcNumber || index + 1}</span>
        <b>${match.home} vs ${match.away}</b>
        <span>${match.league}</span>
        <span>${match.time || "--:--"}</span>
        <span>${settlement.score} · ${settlement.resultText}</span>
        <small class="settle-${settlement.hitClass}">${settlement.hitText} · ${settlement.statusText}</small>
        ${pageQualityTags(match)}
        <span class="review-hint">查看复盘 →</span>
      </div>
    `;
  }).join("");
  root.innerHTML = `
    <section class="page-hero">
      <span class="label">命中记录</span>
      <h1>每次预测结果明细</h1>
      <p>有真实赛果时自动结算方向与比分命中；没有赛果时保持待结算，不再用静态战绩冒充真实结果。</p>
    </section>
    <section class="result-summary" aria-label="命中概览">
      <article><span>历史收录</span><strong>${resultMatches.length}</strong></article>
      <article><span>已完赛</span><strong>${completedMatches.length}</strong></article>
      <article><span>方向命中</span><strong>${hits.length}</strong></article>
      <article><span>方向准确率</span><strong>${completedMatches.length ? Math.round(hits.length / completedMatches.length * 100) : 0}%</strong></article>
    </section>
    <section class="result-detail-section">
      <div class="result-filters">
        <label><span>搜索球队</span><input id="resultSearch" type="search" placeholder="输入球队名称" /></label>
        <label><span>联赛</span><select id="resultLeague"><option value="">全部联赛</option>${leagues.map((league) => `<option value="${league}">${league}</option>`).join("")}</select></label>
        <label><span>结算状态</span><select id="resultStatus"><option value="">全部结果</option><option value="hit">方向命中</option><option value="miss">方向未中</option></select></label>
        <button id="resultReset" type="button">重置筛选</button>
        <small id="resultCount">显示 ${completedMatches.length} 场</small>
      </div>
      <div class="result-table">${rows || `<article class="empty-state">暂无已完赛并回传真实比分的比赛。</article>`}</div>
    </section>
    <div class="review-modal" id="reviewModal" hidden>
      <div class="review-backdrop" data-close-review></div>
      <section class="review-dialog" role="dialog" aria-modal="true" aria-labelledby="reviewTitle">
        <button class="review-close" type="button" data-close-review aria-label="关闭复盘">×</button>
        <div id="reviewContent"></div>
      </section>
    </div>
  `;

  const search = document.querySelector("#resultSearch");
  const league = document.querySelector("#resultLeague");
  const status = document.querySelector("#resultStatus");
  const count = document.querySelector("#resultCount");
  const modal = document.querySelector("#reviewModal");
  const content = document.querySelector("#reviewContent");
  let previousFocus = null;

  function applyResultFilters() {
    const keyword = search.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll(".result-row-rich").forEach((row) => {
      const index = Number(row.dataset.resultIndex);
      const match = completedMatches[index];
      const matchesSearch = !keyword || `${match.home} ${match.away}`.toLowerCase().includes(keyword);
      const matchesLeague = !league.value || row.dataset.league === league.value;
      const matchesStatus = !status.value || row.dataset.status === status.value;
      row.hidden = !(matchesSearch && matchesLeague && matchesStatus);
      if (!row.hidden) visible += 1;
    });
    count.textContent = `显示 ${visible} 场`;
  }

  function openReview(index, trigger) {
    const match = completedMatches[index];
    const snapshot = window.__PREDICTION_SNAPSHOTS__?.snapshots?.[String(match.id || match.jcNumber || "")];
    const predictionMatch = snapshot?.match || match;
    const model = pageMatchModel(predictionMatch);
    const settlement = pageSettlement(match);
    const parts = pageScoreParts(match.result?.score || match.score);
    const scoreHit = parts ? model.poisson.scores.slice(0, 2).some((item) => item.score === `${parts[0]}-${parts[1]}`) : null;
    const lock = pagePredictionLock(match);
    const markets = pageReviewMarkets(predictionMatch, model, parts);
    const snapshotStatus = snapshot ? "已锁定" : lock.date && new Date() > lock.date ? "历史快照缺失" : "等待锁定时点";
    previousFocus = trigger;
    content.innerHTML = `
      <span class="label">赛后复盘 · ${match.league || "未分类"}</span>
      <h2 id="reviewTitle">${match.home} vs ${match.away}</h2>
      <p class="review-meta">${match.jcNumber ? `竞彩 ${match.jcNumber} · ` : ""}${match.time || "--:--"}</p>
      <div class="review-lock">
        <div><span>预测锁定时间</span><strong>${lock.text}</strong></div>
        <div><span>取值规则</span><strong>${lock.policy}</strong></div>
        <div><span>快照状态</span><strong>${snapshotStatus}</strong></div>
      </div>
      <div class="review-score">
        <section><span>模型预测</span><strong>${model.pick}</strong><small>置信度 ${model.confidence}%</small></section>
        <section><span>赛果回传</span><strong>${settlement.score}</strong><small>${settlement.resultText}</small></section>
        <section><span>方向准确率</span><strong>${parts ? (settlement.hitClass === "hit" ? "100%" : "0%") : "--"}</strong><small>${parts ? settlement.hitText : "等待赛果"}</small></section>
        <section><span>比分命中</span><strong>${scoreHit === null ? "--" : scoreHit ? "命中" : "未中"}</strong><small>预测 ${model.poisson.scores.slice(0, 2).map((item) => item.score).join(" / ")}</small></section>
      </div>
      <div class="review-probabilities">
        <h3>预测概率</h3>
        ${["主胜", "平局", "客胜"].map((label, probabilityIndex) => `<div><span>${label}</span><i><b style="width:${pagePercent(model.probabilities[probabilityIndex])}"></b></i><strong>${pagePercent(model.probabilities[probabilityIndex])}</strong></div>`).join("")}
      </div>
      <div class="review-comparison">
        <h3>全部预测与赛果对比</h3>
        <div class="review-comparison-row review-comparison-head"><span>预测项目</span><span>${snapshot ? "锁定预测" : "当前预测预览"}</span><span>真实赛果</span><span>结果</span></div>
        ${markets.map((row) => `
          <div class="review-comparison-row">
            <span>${row.market}</span><strong>${row.pick}</strong><span>${row.actual || "--"}</span><b class="settle-${row.statusClass}">${row.status}</b>
          </div>
        `).join("")}
      </div>
      <p class="review-note">${parts ? `赛果已于当天回传，正在按锁定快照复盘：${settlement.statusText}。` : snapshot ? "预测快照已经锁定，等待当天赛果回传后逐项复盘。" : snapshotStatus === "历史快照缺失" ? "本场锁定时点早于快照功能启用时间，因此不使用当前数据冒充赛前预测；后续场次会按规则自动留档。" : `将在 ${lock.text} 自动保存预测快照；赛果回传后使用该快照逐项对比，不受后续赔率和模型变化影响。`}</p>
    `;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modal.querySelector(".review-close").focus();
  }

  function closeReview() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    previousFocus?.focus();
  }

  [search, league, status].forEach((control) => control.addEventListener("input", applyResultFilters));
  document.querySelector("#resultReset").addEventListener("click", () => {
    search.value = "";
    league.value = "";
    status.value = "";
    applyResultFilters();
  });
  document.querySelectorAll(".result-row-rich").forEach((row) => {
    row.addEventListener("click", () => openReview(Number(row.dataset.resultIndex), row));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openReview(Number(row.dataset.resultIndex), row);
      }
    });
  });
  modal.querySelectorAll("[data-close-review]").forEach((button) => button.addEventListener("click", closeReview));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeReview();
  });
}

function renderFuturePage() {
  document.body.insertAdjacentHTML("afterbegin", pageHeader("future"));
  const root = document.querySelector("#pageRoot");
  const byDate = pageMatches.reduce((acc, match) => {
    const date = String(match.utcDate || "待定").slice(0, 10);
    acc[date] = acc[date] || [];
    acc[date].push(match);
    return acc;
  }, {});
  const cards = Object.keys(byDate).sort().slice(0, 3).map((date) => `
    <article class="future-card">
      <span>${date}</span>
      <strong>${byDate[date].length} 场比赛</strong>
      <p>${byDate[date].slice(0, 8).map((match) => `${match.home} vs ${match.away}`).join(" / ")}</p>
    </article>
  `).join("");
  root.innerHTML = `
    <section class="page-hero">
      <span class="label">赛事分类</span>
      <h1>未来三天比赛分析</h1>
      <p>按同步数据源汇总未来三天赛事，用于查看每日联赛分布和重点比赛。</p>
    </section>
    <section class="future-section"><div class="future-grid">${cards || `<article class="empty-state">暂无未来三天赛事。</article>`}</div></section>
  `;
}

function renderLivePage() {
  document.body.insertAdjacentHTML("afterbegin", pageHeader("live"));
  const root = document.querySelector("#pageRoot");
  const liveCards = pageMatches.slice(0, 6).map((match) => `
    <article class="live-card">
      <span>${match.jcNumber ? `竞彩 ${match.jcNumber}` : match.league}</span>
      <strong>${match.home} vs ${match.away}</strong>
      <small>${match.time || "--:--"} · ${match.jcOdds ? `SP ${match.jcOdds.win}/${match.jcOdds.draw}/${match.jcOdds.lose}` : "等待指数"}</small>
    </article>
  `).join("");
  root.innerHTML = `
    <section class="page-hero">
      <span class="label">实时直播</span>
      <h1>赛事直播与聊天室</h1>
      <p>上线后这里接入直播源、赛况动画和实时聊天室。</p>
    </section>
    <section class="live-section">
      <div class="live-room">
        <div class="video-window"><div class="video-screen"><span>LIVE</span><strong>赛事直播窗口</strong><small>等待直播源接入</small></div></div>
        <div class="chat-window">
          <div class="chat-head">聊天室</div>
          <div class="chat-lines"><p><b>系统</b> 欢迎进入实时直播间</p><p><b>模型</b> 竞彩场次已同步，等待临场指数变化</p></div>
          <label class="chat-input"><input placeholder="登录后参与聊天" disabled /><button disabled>发送</button></label>
        </div>
      </div>
      <div class="live-grid">${liveCards || `<article class="empty-state">暂无实时赛事。</article>`}</div>
    </section>
  `;
}

function renderMatchPage() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const match = pageMatches.find((item) => String(item.id) === String(id));
  const root = document.querySelector("#matchRoot");
  if (!match) {
    root.innerHTML = '<section class="page-hero"><span class="label">详细解读</span><h1>未找到比赛</h1><p>请返回首页重新选择比赛。</p></section>';
    return;
  }

  const model = pageMatchModel(match);
  const probabilityRows = [
    ["主胜", model.probabilities[0], model.poisson.probabilities[0], model.market[0]],
    ["平局", model.probabilities[1], model.poisson.probabilities[1], model.market[1]],
    ["客胜", model.probabilities[2], model.poisson.probabilities[2], model.market[2]]
  ].map(([name, final, poisson, market]) => `
    <div class="analysis-row"><b>${name}</b><span>${pagePercent(final)}</span><span>泊松 ${pagePercent(poisson)}</span><span>竞彩 ${pagePercent(market)}</span><span>模型校验</span></div>
  `).join("");
  const scoreCards = model.poisson.scores.map((item) => `<article><span>${item.score}</span><strong>${pagePercent(item.probability)}</strong></article>`).join("");
  const quality = match.dataQuality || {};
  const qualityCards = [
    ["真实数据", (quality.real || []).join("、") || "暂无"],
    ["派生数据", [...(quality.derived || []), ...(quality.estimated || [])].join("、") || "暂无"],
    ["待校验", (quality.pending || []).join("、") || "暂无"],
    ["数据更新时间", (window.__JINCAI_DATA__?.enrichedAt || window.__JINCAI_DATA__?.generatedAt || "等待同步")]
  ].map(([title, text]) => `<section><b>${title}</b><p>${text}</p></section>`).join("");

  root.innerHTML = `
    <section class="page-hero">
      <span class="label">详细解读</span>
      <h1>${match.home} vs ${match.away}</h1>
      <p>${match.jcNumber ? `竞彩编号 ${match.jcNumber} · ` : ""}${match.league} · ${match.time || "--:--"} · 数据源 ${match.source || "本地模型"}</p>
    </section>
    <section class="result-detail-section">
      <article class="detail-panel">
        <div class="match-summary-grid">
          <div><span>模型方向</span><strong>${model.pick}</strong></div>
          <div><span>综合信心</span><strong>${model.confidence}%</strong></div>
          <div><span>xG</span><strong>${model.poisson.homeXg.toFixed(2)}-${model.poisson.awayXg.toFixed(2)}</strong></div>
          <div><span>机构分歧</span><strong>${model.marketEdge}%</strong></div>
        </div>
        ${pageQualityTags(match)}

        <div class="analysis-block">
          <span class="label">1X2 概率拆解</span>
          <h2>Poisson + xG + 竞彩SP 融合</h2>
          <div class="analysis-table">${probabilityRows}</div>
        </div>

        ${pageMarketCompare(match, model)}
        ${pageThirdPartyComparison(match)}

        <div class="analysis-block">
          <span class="label">比分场景</span>
          <h2>可能比分与玩法推荐</h2>
          <div class="score-scenarios">${scoreCards}</div>
          <div class="play-recommendations">
            <span class="label">玩法推荐</span>
            <div class="play-grid">${pageRecommendations(match, model)}</div>
          </div>
          <div class="detail-grid">
            <section><b>大小球</b><p>大 2.5 概率 ${pagePercent(model.poisson.over25)}，小 2.5 概率 ${pagePercent(1 - model.poisson.over25)}。</p></section>
            <section><b>双方进球</b><p>BTTS 是 ${pagePercent(model.poisson.btts)}，BTTS 否 ${pagePercent(1 - model.poisson.btts)}。</p></section>
            <section><b>三维判断</b><p>${match.intent?.reason || "战意等待赛前情报校验"}。战意 ${match.intent?.stars || 3} 星。</p></section>
            <section><b>指数信息</b><p>${match.jcOdds ? `竞彩SP ${match.jcOdds.win}/${match.jcOdds.draw}/${match.jcOdds.lose}，${match.jcOdds.handicapLabel || "让球"} SP ${match.jcOdds.handicapWin}/${match.jcOdds.handicapDraw}/${match.jcOdds.handicapLose}。` : "指数等待同步。"}</p></section>
          </div>
        </div>

        <div class="analysis-block">
          <span class="label">数据支撑</span>
          <h2>真实、派生与待校验项</h2>
          <div class="detail-grid">${qualityCards}</div>
        </div>
      </article>
    </section>
  `;
}
