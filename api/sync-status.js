import { readJson, sendJson } from "./_data.js";

export default async function handler(request, response) {
  const footballData = await readJson("data/fixtures.json", { generatedAt: null, matches: [] });
  const sporttery = await readJson("data/jincai-fixtures.json", { generatedAt: null, matches: [] });

  sendJson(response, 200, {
    syncing: false,
    runtime: "vercel-serverless",
    message: "Static deployment reads bundled data. Use GitHub Actions or Supabase for scheduled refreshes.",
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
    }
  });
}
