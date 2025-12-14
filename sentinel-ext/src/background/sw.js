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
const FETCH_TIMEOUT_MS = 10_000; // ✅ 10초 타임아웃

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal, // ✅ 타임아웃 제어
    });
  } catch (e) {
    clearTimeout(timer);

    // ✅ 타임아웃(Abort)
    if (e && (e.name === "AbortError" || String(e).includes("AbortError"))) {
      console.log("[sentinel] fetch timeout:", FETCH_TIMEOUT_MS, "ms");
      return {
        ok: false,
        status: 0,
        text: "",
        data: null,
        error: "timeout",
      };
    }

    console.log("[sentinel] fetch failed:", e);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  console.log("[sentinel] POST result:", res.status, (text || "").slice(0, 200));
  return { ok: res.ok, status: res.status, text, data, error: null };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg) return;
      if (msg.type !== "SENTINEL_PROCESS") return;

      console.log(
        "[sentinel] onMessage:",
        msg.type,
        "from",
        sender?.url || "unknown"
      );

      const settings = await getSettings();
      if (!settings.enabled) {
        sendResponse({ ok: true, skipped: true, reason: "disabled" });
        return;
      }

      const result = await postJson(settings.endpointUrl, msg.payload);

      // inject.js가 그대로 쓰게 서버 응답 JSON을 data로 전달
      // timeout이면 ok:false,error:"timeout" 으로 돌아감 -> inject.js에서 fail-open 처리됨
      sendResponse({
        ok: result.ok,
        status: result.status,
        data: result.data,
        error: result.error || null,
      });
    } catch (e) {
      console.log("[sentinel] sw error:", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // async response
});
