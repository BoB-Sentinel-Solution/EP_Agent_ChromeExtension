// src/background/sw.js
console.log("[sentinel] sw loaded");

const STORAGE_KEYS = {
  enabled: "sentinel_enabled",
  endpointUrl: "sentinel_endpoint_url",
  pcName: "sentinel_pc_name",
  uuid: "sentinel_uuid",
};

const DEFAULT_ENDPOINT = "https://bobsentinel.com/api/logs";
const FETCH_TIMEOUT_MS = 10_000;

async function getSettings() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.endpointUrl,
  ]);

  return {
    enabled: data[STORAGE_KEYS.enabled] !== false,
    endpointUrl: data[STORAGE_KEYS.endpointUrl] || DEFAULT_ENDPOINT,
  };
}

function summarizePayload(payload) {
  try {
    const a = payload?.attachment || {};
    return {
      time: payload?.time,
      host: payload?.host,
      PCName: payload?.PCName,
      prompt_len: String(payload?.prompt || "").length,
      attachment: {
        format: a?.format ?? null,
        size: typeof a?.size === "number" ? a.size : null,
        has_data: !!a?.data,
      },
      interface: payload?.interface,
    };
  } catch {
    return { note: "payload_summary_failed" };
  }
}

async function postJson(url, payload) {
  console.log("[sentinel] POST ->", url);
  console.log("[sentinel] payload(summary) ->", summarizePayload(payload));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") {
      console.log("[sentinel] fetch timeout after", FETCH_TIMEOUT_MS, "ms");
      throw new Error("timeout");
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
      sendResponse({ ok, status, data });
    } catch (e) {
      console.log("[sentinel] sw error:", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
