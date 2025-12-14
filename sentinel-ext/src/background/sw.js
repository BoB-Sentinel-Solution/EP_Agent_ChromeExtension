// src/background/sw.js
// ✅ inject.js와 동일한 STORAGE_KEYS/규칙으로 동작하는 Service Worker

const STORAGE_KEYS = {
  enabled: "sentinel_enabled",
  endpointUrl: "sentinel_endpoint_url",
  pcName: "sentinel_pc_name",
  uuid: "sentinel_uuid",
};

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function uuidv4() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}

// settings: enabled 기본 true, endpointUrl 기본값 제공 (inject.js와 동일)
async function getSettings() {
  const got = await storageGet([STORAGE_KEYS.enabled, STORAGE_KEYS.endpointUrl]);
  return {
    enabled: got[STORAGE_KEYS.enabled] !== false, // default true
    endpointUrl: got[STORAGE_KEYS.endpointUrl] || "https://bobsentinel.com/api/logs",
  };
}

// PCName 고정: "CE-" + uuid앞8자리 (inject.js와 동일 저장키/규칙)
async function ensureIdentity() {
  const got = await storageGet([STORAGE_KEYS.pcName, STORAGE_KEYS.uuid]);
  if (got[STORAGE_KEYS.pcName]) return { pcName: got[STORAGE_KEYS.pcName] };

  const u = got[STORAGE_KEYS.uuid] || uuidv4();
  const pcName = "CE-" + String(u).replace(/-/g, "").slice(0, 8);

  await storageSet({
    [STORAGE_KEYS.uuid]: u,
    [STORAGE_KEYS.pcName]: pcName,
  });

  return { pcName };
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

console.log("[sentinel] sw loaded");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[sentinel] onMessage:", msg?.type, "from", sender?.tab?.url);

  (async () => {
    try {
      if (!msg || msg.type !== "SENTINEL_LOG") return;

      const settings = await getSettings();
      if (!settings.enabled) {
        console.log("[sentinel] skipped: disabled");
        sendResponse({ ok: true, skipped: true, reason: "disabled" });
        return;
      }

      // PCName 고정 보장
      await ensureIdentity();

      const endpointUrl = settings.endpointUrl || "https://bobsentinel.com/api/logs";
      console.log("[sentinel] POST ->", endpointUrl);

      const { ok, status, text } = await postJson(endpointUrl, msg.payload);
      console.log("[sentinel] POST result:", { ok, status });

      sendResponse({ ok, status, text });
    } catch (e) {
      console.error("[sentinel] sw error:", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // async
});
