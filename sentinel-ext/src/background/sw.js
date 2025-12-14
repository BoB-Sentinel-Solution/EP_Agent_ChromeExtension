// src/background/sw.js
console.log("[sentinel] sw loaded");

// inject.js와 동일 키
const STORAGE_KEYS = {
  enabled: "sentinel_enabled",
  endpointUrl: "sentinel_endpoint_url",
  pcName: "sentinel_pc_name",
  uuid: "sentinel_uuid",
};

const DEFAULT_ENDPOINT = "https://bobsentinel.com/api/logs";

async function getSettings() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.endpointUrl,
  ]);

  return {
    enabled: data[STORAGE_KEYS.enabled] !== false, // default true
    endpointUrl: data[STORAGE_KEYS.endpointUrl] || DEFAULT_ENDPOINT,
  };
}

async function postJson(url, payload) {
  console.log("[sentinel] POST ->", url);
  console.log("[sentinel] payload ->", payload);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.log("[sentinel] fetch failed:", e);
    throw e;
  }

  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  console.log("[sentinel] POST result:", res.status, (text || "").slice(0, 200));
  return { ok: res.ok, status: res.status, text, data };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg) return;

      if (msg.type !== "SENTINEL_PROCESS") return;

      console.log("[sentinel] onMessage:", msg.type, "from", sender?.url || "unknown");

      const settings = await getSettings();
      if (!settings.enabled) {
        sendResponse({ ok: true, skipped: true, reason: "disabled" });
        return;
      }

      const { ok, status, data } = await postJson(settings.endpointUrl, msg.payload);

      // 핵심: inject.js가 그대로 쓰게 서버 응답 JSON을 data로 전달
      sendResponse({ ok, status, data });
    } catch (e) {
      console.log("[sentinel] sw error:", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // async response
});
