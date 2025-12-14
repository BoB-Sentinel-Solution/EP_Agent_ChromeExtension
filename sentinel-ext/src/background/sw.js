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

function uuidv4() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) + "-" +
    hex.slice(8, 12) + "-" +
    hex.slice(12, 16) + "-" +
    hex.slice(16, 20) + "-" +
    hex.slice(20)
  );
}

// PCName 고정: "CE-" + uuid앞8자리
async function ensureIdentity() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.pcName,
    STORAGE_KEYS.uuid,
  ]);

  if (data[STORAGE_KEYS.pcName]) return { pcName: data[STORAGE_KEYS.pcName] };

  const u = data[STORAGE_KEYS.uuid] || uuidv4();
  const pcName = "CE-" + String(u).replace(/-/g, "").slice(0, 8);

  await chrome.storage.local.set({
    [STORAGE_KEYS.uuid]: u,
    [STORAGE_KEYS.pcName]: pcName,
  });

  console.log("[sentinel] identity created (sw):", pcName);
  return { pcName };
}

async function postJson(url, payload) {
  console.log("[sentinel] POST ->", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text().catch(() => "");
  console.log("[sentinel] POST result:", res.status, text.slice(0, 200));
  return { ok: res.ok, status: res.status, text };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== "SENTINEL_LOG") return;

      console.log("[sentinel] onMessage:", msg.type, "from", sender?.url || "unknown");

      const settings = await getSettings();
      if (!settings.enabled) {
        sendResponse({ ok: true, skipped: true, reason: "disabled" });
        return;
      }

      await ensureIdentity();

      const { ok, status, text } = await postJson(settings.endpointUrl, msg.payload);
      sendResponse({ ok, status, text });
    } catch (e) {
      console.log("[sentinel] sw error:", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // async response
});
