import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

export async function readJson(relativePath, fallback) {
  try {
    const raw = await fs.readFile(path.join(root, relativePath), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function sendJson(response, statusCode, payload, cacheControl = "no-store") {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.end(JSON.stringify(payload));
}

export async function mergedFixtures() {
  const footballData = await readJson("data/fixtures.json", {
    source: "football-data.org",
    generatedAt: null,
    matches: []
  });
  const sporttery = await readJson("data/jincai-fixtures.json", {
    source: "sporttery",
    generatedAt: null,
    matches: []
  });

  const matches = [
    ...(sporttery.matches || []),
    ...(footballData.matches || [])
  ];

  return {
    source: "merged",
    generatedAt: new Date().toISOString(),
    sources: {
      footballData: {
        generatedAt: footballData.generatedAt,
        count: footballData.matches?.length || 0
      },
      sporttery: {
        generatedAt: sporttery.generatedAt,
        count: sporttery.matches?.length || 0,
        error: sporttery.error
      }
    },
    count: matches.length,
    matches
  };
}
