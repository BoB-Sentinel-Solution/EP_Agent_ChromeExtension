// src/background/sw.js
// ✅ inject.js와 동일한 저장 규칙/스키마에 맞춘 Service Worker

// settings: enabled 기본 true, endpointUrl 기본값 제공
async function getSettings() {
  const data = await chrome.storage.local.get(["enabled", "endpointUrl"]);
  return {
    enabled: data.enabled !== false, // default true
    endpointUrl: data.endpointUrl || "https://bobsentinel.com/api/logs",
  };
}

// PCName 고정: "CE-" + uuid앞8자리 (inject.js와 동일 키 사용)
async function ensureIdentity() {
  const key = "PCName";
  const data = await chrome.storage.local.get([key]);
  if (data[key]) return { pcName: data[key] };

  const uuid = crypto.randomUUID();
  const pcName = "CE-" + uuid.slice(0, 8);
  await chrome.storage.local.set({ [key]: pcName });
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== "SENTINEL_LOG") return;

      const settings = await getSettings();
      if (!settings.enabled) {
        sendResponse({ ok: true, skipped: true, reason: "disabled" });
        return;
      }

      // PCName 고정 보장 (inject.js와 같은 키로 저장)
      await ensureIdentity();

      const { ok, status, text } = await postJson(settings.endpointUrl, msg.payload);
      sendResponse({ ok, status, text });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  // async 응답
  return true;
});
