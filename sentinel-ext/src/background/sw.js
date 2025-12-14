// src/background/sw.js
import { getSettings } from "../lib/storage.js";
import { ensureIdentity } from "../lib/identity.js";

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // CORS 이슈가 있을 수 있으니 credentials 생략
    body: JSON.stringify(payload)
  });

  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== "SENTINEL_LOG") return;

      const settings = await getSettings();
      if (!settings.enabled) {
        sendResponse({ ok: true, skipped: true, reason: "disabled" });
        return;
      }

      // PCName 고정 보장
      await ensureIdentity();

      const endpointUrl = settings.endpointUrl || "https://bobsentinel.com/api/logs";
      const { ok, status, text } = await postJson(endpointUrl, msg.payload);

      sendResponse({ ok, status, text });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  // async 응답
  return true;
});
