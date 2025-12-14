// src/content/inject.js
// ✅ content script는 ESM(import) 불가 → 단일 파일로 구성

function getHost() {
  return location.hostname || "";
}

// --- KST ISO (microseconds 6 digits) ---
function nowKstIsoMicro() {
  const d = new Date();

  // KST로 변환: UTC 기준 ms + 9시간
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);

  const pad2 = (n) => String(n).padStart(2, "0");
  const pad3 = (n) => String(n).padStart(3, "0");

  const yyyy = kst.getFullYear();
  const MM = pad2(kst.getMonth() + 1);
  const dd = pad2(kst.getDate());
  const hh = pad2(kst.getHours());
  const mm = pad2(kst.getMinutes());
  const ss = pad2(kst.getSeconds());
  const ms = pad3(kst.getMilliseconds());

  // microseconds 6자리 요구 → ms(3) + "000"
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}.${ms}000`;
}

// --- settings ---
async function getSettings() {
  const data = await chrome.storage.local.get(["enabled", "endpointUrl"]);
  return {
    enabled: data.enabled !== false,
    endpointUrl: data.endpointUrl || "https://bobsentinel.com/api/logs",
  };
}

// --- identity (PCName 고정) ---
async function ensureIdentity() {
  const key = "PCName";
  const data = await chrome.storage.local.get([key]);
  if (data[key]) return { pcName: data[key] };

  const uuid = crypto.randomUUID();
  const pcName = "CE-" + uuid.slice(0, 8);
  await chrome.storage.local.set({ [key]: pcName });
  return { pcName };
}

// --- schema builder (서버 규격 고정) ---
function buildLogPayload({ host, pcName, prompt }) {
  return {
    time: nowKstIsoMicro(),
    public_ip: pcName,   // ✅ 오탐 방지: IP처럼 보이는 값 금지 → PCName으로 대체
    private_ip: pcName,  // ✅ 동일 규칙
    host: host,
    PCName: pcName,
    prompt: prompt,
    attachment: { format: null, data: null },
    interface: "llm",
  };
}

function normalizePrompt(s) {
  const v = String(s ?? "").trim();
  if (!v) return null;
  return v.length > 20000 ? v.slice(0, 20000) : v;
}

async function sendPrompt(rawPrompt) {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const p = normalizePrompt(rawPrompt);
  if (!p) return;

  const { pcName } = await ensureIdentity();
  const payload = buildLogPayload({
    host: getHost(),
    pcName,
    prompt: p,
  });

  chrome.runtime.sendMessage({ type: "SENTINEL_LOG", payload });
}

// --- ChatGPT collector: Enter(전송) / Send 버튼 클릭 감지 ---
function attachChatGPTCollector(onPrompt) {
  const getTextarea = () =>
    document.querySelector("#prompt-textarea") ||
    document.querySelector("textarea");

  // Enter 전송 감지
  document.addEventListener(
    "keydown",
    (e) => {
      const ta = getTextarea();
      if (!ta) return;
      if (e.target !== ta) return;

      // 조합중/Shift+Enter 제외
      if (e.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        const value = ta.value;
        if (value && value.trim()) onPrompt(value);
      }
    },
    true
  );

  // Send 버튼 클릭 감지
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target?.closest?.('button[data-testid="send-button"]');
      if (!btn) return;

      const ta = getTextarea();
      const value = ta?.value;
      if (value && value.trim()) onPrompt(value);
    },
    true
  );
}

// --- fallback (다른 사이트 대비) ---
function attachGenericCollector(onPrompt) {
  document.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      const isTextArea = t && t.tagName === "TEXTAREA";
      if (!isTextArea) return;
      if (e.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        const value = t.value;
        if (value && value.trim()) onPrompt(value);
      }
    },
    true
  );
}

// --- boot ---
(async () => {
  await ensureIdentity();

  const host = getHost();
  const handler = (p) => sendPrompt(p);

  if (host === "chatgpt.com") attachChatGPTCollector(handler);
  else attachGenericCollector(handler);
})();
