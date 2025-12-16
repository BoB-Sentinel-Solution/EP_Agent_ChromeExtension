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
const FETCH_TIMEOUT_MS = 10_000;

/**
 * background에서도 2중 안전장치로 허용 확장자 체크
 * (content에서 이미 걸러도, background에서 한 번 더)
 *
 * ✅ 사용자가 다룰 확장자들만 서버로 전송
 */
const ALLOWED_FORMATS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "csv",
  "txt",
]);

function normalizeFormat(fmt) {
  const f = String(fmt || "").trim().toLowerCase();
  if (!f) return "";
  return f === "jpeg" ? "jpg" : f;
}

function isAllowedAttachment(att) {
  if (!att) return true; // attachment 없으면 통과(프롬프트만 보내는 케이스)
  const fmt = normalizeFormat(att.format);
  if (!fmt) return false;
  return ALLOWED_FORMATS.has(fmt);
}

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

/**
 * base64 payload를 그대로 console.log 하면 service worker가 터질 수 있어서
 * 로그는 "메타"만 남김.
 */
function makeSafeLogPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const safe = { ...payload };

  if (safe.attachment && typeof safe.attachment === "object") {
    const a = safe.attachment;
    safe.attachment = {
      format: a.format,
      size: a.size,
      file_change: a.file_change,
      data_len: typeof a.data === "string" ? a.data.length : 0,
    };
  }

  return safe;
}

async function postJson(url, payload) {
  // ✅ base64 전체를 찍지 않도록 안전 로그로 출력
  console.log("[sentinel] POST ->", url);
  console.log("[sentinel] payload(meta) ->", makeSafeLogPayload(payload));

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

      // ✅ 기존 타입 유지 + 새 타입 추가
      const type = msg.type;
      if (type !== "SENTINEL_PROCESS" && type !== "SENTINEL_REDACT_FILE") return;

      console.log(
        "[sentinel] onMessage:",
        type,
        "from",
        sender?.url || "unknown"
      );

      const settings = await getSettings();
      if (!settings.enabled) {
        sendResponse({ ok: true, skipped: true, reason: "disabled" });
        return;
      }

      const payload = msg.payload;

      // ✅ background 2중 안전장치: 허용 확장자 체크
      const att = payload?.attachment;
      if (att && !isAllowedAttachment(att)) {
        sendResponse({
          ok: true,
          skipped: true,
          reason: "unsupported_attachment_format",
          format: att?.format,
        });
        return;
      }

      const { ok, status, data } = await postJson(settings.endpointUrl, payload);

      // ✅ 서버 응답 그대로 content로 전달
      // content가 attachment.file_change === true면 교체 수행
      sendResponse({ ok, status, data });
    } catch (e) {
      console.log("[sentinel] sw error:", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // async response
});
