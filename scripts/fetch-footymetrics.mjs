import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputPath = path.join(root, "data", "footymetrics-public.json");
const fixturePathsPath = path.join(root, "data", "footymetrics-fixture-paths.json");
const baseUrl = "https://www.footymetrics.com";
const paths = [
  "/predictions",
  "/predictions/1x2",
  "/predictions/btts",
  "/predictions/goals-over-under",
  "/predictions/team-goals",
  "/predictions/double-chance",
  "/predictions/1x2-ht",
  "/predictions/tomorrow",
  "/predictions/yesterday"
];

function decodeRsc(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;
  for (const match of html.matchAll(re)) {
    try {
      chunks.push(JSON.parse(`"${match[1]}"`));
    } catch {
      chunks.push(match[1]);
    }
  }
  return chunks.join("\n");
}

function extractArray(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return [];
  const start = source.indexOf("[", markerIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  return [];
}

function extractServerTotal(source) {
  const match = source.match(/"serverTotal":(\d+)/);
  return match ? Number(match[1]) : null;
}

function cleanDate(value) {
  return String(value || "").replace(/^\$D/, "");
}

async function readJson(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function simplifyRow(row, pathName) {
  return {
    sourcePath: pathName,
    rowId: row.rowId || "",
    fixtureApid: row.fixtureApid || null,
    slug: row.slug || "",
    timestamp: cleanDate(row.timestamp),
    league: row.league ? {
      id: row.league.id,
      name: row.league.name,
      country: row.league.country
    } : null,
    home: row.home?.name || "",
    away: row.away?.name || "",
    locked: Boolean(row.locked),
    finished: Boolean(row.finished),
    score: row.score || null,
    bestTip: row.bestTip ? {
      market: row.bestTip.market,
      selection: row.bestTip.selection,
      label: row.bestTip.label,
      probability: row.bestTip.prob,
      odds: row.bestTip.odds,
      edge: row.bestTip.edge,
      hasEdge: row.bestTip.hasEdge,
      line: row.bestTip.line,
      marketLabel: row.bestTip.marketLabel,
      bookmaker: row.bestTip.bookmaker?.name || "",
      prices: row.bestTip.prices || []
    } : null,
    settlement: row.settlement || null,
    actual: row.actual || null,
    matchResult: row.matchResult || null,
    form: row.form || null,
    modelStats: row.modelStats || null
  };
}

async function fetchPage(pathName) {
  const url = `${baseUrl}${pathName}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Codex public audit",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const html = await response.text();
  const rsc = decodeRsc(html);
  const rows = extractArray(rsc, "\"rows\":").map((row) => simplifyRow(row, pathName));
  return {
    path: pathName,
    url,
    fetchedAt: new Date().toISOString(),
    bytes: html.length,
    rowCount: rows.length,
    serverTotal: extractServerTotal(rsc),
    rows
  };
}

function extractFixtureTips(html, pathName, fixtureConfig) {
  const compact = html.replace(/<!-- -->/g, "");
  const title = decodeHtml(compact.match(/<title>(.*?)<\/title>/)?.[1] || "");
  const description = decodeHtml(compact.match(/<meta name="description" content="(.*?)"/)?.[1] || "");
  const tips = [];
  const re = /<p class="truncate text-\[13px\] font-semibold text-text-primary">([^<]+)<\/p><p class="truncate text-\[11px\] font-medium text-text-secondary">([^<]+)<\/p><\/div><div class="flex flex-shrink-0 items-baseline gap-1\.5"><span[^>]*>([\d.]+)%<\/span><span[^>]*>(\d+)\/(\d+)<\/span>[\s\S]*?(?:<img src="[^"]*bookmakers\/[^"]*" alt="([^"]+)"[\s\S]*?<span class="text-sm font-semibold text-text-primary">([\d.]+)<\/span>)?/g;
  for (const match of compact.matchAll(re)) {
    const label = decodeHtml(match[1]);
    const marketLabel = decodeHtml(match[2]);
    tips.push({
      market: marketLabel.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, ""),
      selection: label,
      label,
      prob: Number(match[3]) / 100,
      odds: Number.isFinite(Number(match[7])) ? Number(match[7]) : null,
      edge: null,
      hasEdge: null,
      marketLabel,
      bookmaker: { name: decodeHtml(match[6] || "") },
      prices: []
    });
  }
  return tips.map((bestTip, index) => ({
    sourcePath: pathName,
    rowId: `${fixtureConfig.localId || pathName}:fixture-tip:${index}`,
    fixtureApid: fixtureConfig.fixtureApid || null,
    slug: pathName.split("/").pop() || "",
    timestamp: "",
    league: title.includes("Major League Soccer") ? {
      id: null,
      name: "Major League Soccer",
      country: "United States"
    } : null,
    home: fixtureConfig.home || "",
    away: fixtureConfig.away || "",
    locked: false,
    finished: false,
    score: null,
    bestTip,
    settlement: null,
    actual: null,
    matchResult: null,
    form: null,
    modelStats: null,
    fixturePage: {
      title,
      description,
      url: `${baseUrl}${pathName}`,
      localId: fixtureConfig.localId || null
    }
  }));
}

async function fetchFixturePage(fixtureConfig) {
  const pathName = fixtureConfig.path;
  const url = `${baseUrl}${pathName}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Codex public audit",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const html = await response.text();
  const rows = extractFixtureTips(html, pathName, fixtureConfig);
  return {
    path: pathName,
    url,
    fetchedAt: new Date().toISOString(),
    bytes: html.length,
    rowCount: rows.length,
    serverTotal: rows.length,
    rows
  };
}

async function main() {
  const pages = [];
  const errors = [];

  for (const pathName of paths) {
    try {
      const page = await fetchPage(pathName);
      pages.push(page);
      console.log(`OK FootyMetrics ${pathName}: ${page.rowCount}/${page.serverTotal ?? "?"}`);
    } catch (error) {
      errors.push({ path: pathName, error: error.message });
      console.error(`FAIL FootyMetrics ${pathName}: ${error.message}`);
    }
  }

  const fixtureConfig = await readJson(fixturePathsPath, { fixtures: [] });
  for (const fixture of fixtureConfig.fixtures || []) {
    try {
      const page = await fetchFixturePage(fixture);
      pages.push(page);
      console.log(`OK FootyMetrics fixture ${fixture.path}: ${page.rowCount}`);
    } catch (error) {
      errors.push({ path: fixture.path, error: error.message });
      console.error(`FAIL FootyMetrics fixture ${fixture.path}: ${error.message}`);
    }
  }

  const byKey = new Map();
  for (const row of pages.flatMap((page) => page.rows)) {
    byKey.set(`${row.sourcePath}:${row.rowId || row.fixtureApid}:${row.bestTip?.label || ""}`, row);
  }

  const output = {
    source: "footymetrics-public",
    generatedAt: new Date().toISOString(),
    pages: pages.map(({ rows, ...page }) => page),
    count: byKey.size,
    errors,
    rows: [...byKey.values()]
  };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${output.count} public FootyMetrics rows to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
