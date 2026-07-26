import { sendJson } from "./_data.js";

export default function handler(request, response) {
  sendJson(response, 200, {
    ok: true,
    runtime: "vercel-serverless",
    generatedAt: new Date().toISOString()
  });
}
