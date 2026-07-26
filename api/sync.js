import { sendJson } from "./_data.js";

export default function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "method not allowed" });
    return;
  }

  sendJson(response, 202, {
    ok: true,
    message: "Sync is disabled on the free serverless deployment. Configure GitHub Actions or Supabase for scheduled refreshes."
  });
}
