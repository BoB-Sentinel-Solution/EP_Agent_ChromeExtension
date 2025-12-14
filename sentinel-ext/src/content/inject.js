// src/content/inject.js
// ✅ Content Script는 module import를 못 쓰므로, 필요한 로직을 한 파일로 합쳐서 사용한다.

function getHost() {
  return location.hostname || "";
}

/** KST 기준 ISO-like: YYYY-MM-DDTHH:mm:ss.ffffff (Z 없음) */
function formatKSTNow() {
  const kstMs = Date.now() + 9 * 60 * 60 * 1000; // UTC+9
  const d = new Date(kstMs);

  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");

  // JS는 ms까지만 있으니 microseconds는 ms + '000'
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  const micro = ms + "000";

  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}.${micro}`;
}

/** settings: enabled 기본 true */
async function getSettings() {
  const data = await chrome.storage.local.get(["enabled"]);
  return {
    enabled: data.enabled !== false, // default true
  };
}

/** PCName 고정: "CE-" + uuid앞8자리 */
async function ensureIdentity() {
  const key = "PCName";
  const data = await chrome.storage.local.get([key]);
  if (data[key]) return { pcName: data[key] };

  const uuid = crypto.randomUUID(); // MV3 환경 OK
  const pcName = "CE-" + uuid.slice(0, 8);
  await chrome.storage.local.set({ [key]: pcName });
  return { pcName };
}

/**
 * 서버 고정 JSON 스키마 생성
 * public_ip/private_ip은 확장에서 못 채우므로 PCName으로 대체(오탐 방지)
 */
function buildLogPayload({ host, pcName, prompt }) {
  return {
    time: formatKSTNow(),
    public_ip: pcName,
    private_ip: pcName,
    host: host || "",
    PCName: pcName,
    prompt: prompt || "",
    attachment: { format: null, data: null },
    interface: "llm",
  };
}

function normalizePrompt(s) {
  const v = String(s ?? "").trim();
  if (!v) return null;
  // 너무 긴 건 제한(필요하면 조정)
  return v.length > 20000 ? v.slice(0, 20000) : v;
}

async function sendPrompt(prompt) {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const { pcName } = await ensureIdentity();

  const payload = buildLogPayload({
    host: getHost(),
    pcName,
    prompt,
  });

  chrome.runtime.sendMessage({ type: "SENTINEL_LOG", payload }, () => {
    // 응답은 지금은 조용히 무시
  });
}

/** ChatGPT용: Enter 전송 감지해서 textarea 값 전송 */
function attachChatGPTCollector(handler) {
  const pickTextarea = () =>
    document.querySelector("#prompt-textarea") ||
    document.querySelector("textarea");

  let lastSent = "";

  document.addEventListener(
    "keydown",
    (e) => {
      // Enter 전송(Shift+Enter는 줄바꿈)
      if (e.key !== "Enter" || e.shiftKey) return;

      const ta = pickTextarea();
      if (!ta) return;

      const text = (ta.value || "").trim();
      if (!text) return;

      // 연속 Enter 중복 방지
      if (text === lastSent) return;
      lastSent = text;

      handler(text);
    },
    true
  );
}

/** Generic: textarea에서 Enter 전송 감지 */
function attachGenericCollector(handler) {
  let lastSent = "";

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;

      const ta = document.querySelector("textarea");
      if (!ta) return;

      const text = (ta.value || "").trim();
      if (!text) return;

      if (text === lastSent) return;
      lastSent = text;

      handler(text);
    },
    true
  );
}

(async () => {
  // identity 초기화(PCName 고정 저장)
  await ensureIdentity();

  const host = getHost();
  const handler = (raw) => {
    const p = normalizePrompt(raw);
    if (p) sendPrompt(p);
  };

  // host별 collector
  if (host === "chatgpt.com") {
    attachChatGPTCollector(handler);
  } else {
    attachGenericCollector(handler);
  }

  console.log("[Sentinel] inject loaded on", host);
})();
