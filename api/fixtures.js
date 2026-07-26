import { mergedFixtures, sendJson } from "./_data.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, message: "method not allowed" });
    return;
  }

  sendJson(response, 200, await mergedFixtures());
}
