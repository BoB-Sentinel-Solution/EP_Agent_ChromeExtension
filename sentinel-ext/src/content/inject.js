// src/content/inject.js
console.log("[sentinel] inject loaded", location.href);

(() => {
  // -------------------------
  // Storage Keys (고정)
  // -------------------------
  const STORAGE_KEYS = {
    enabled: "sentinel_enabled",
    endpointUrl: "sentinel_endpoint_url",
    pcName: "sentinel_pc_name",
    uuid: "sentinel_uuid",
  };

  const DEFAULT_ENDPOINT = "https://bobsentinel.com/api/logs";

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
      hex.slice(0, 8) + "-" +
      hex.slice(8, 12) + "-" +
      hex.slice(12, 16) + "-" +
      hex.slice(16, 20) + "-" +
      hex.slice(20)
    );
  }

  async function ensureIdentity() {
    const got = await storageGet([STORAGE_KEYS.pcName, STORAGE_KEYS.uuid]);
    if (got[STORAGE_KEYS.pcName]) return { pcName: got[STORAGE_KEYS.pcName] };

    const u = got[STORAGE_KEYS.uuid] || uuidv4();
    const pcName = "CE-" + String(u).replace(/-/g, "").slice(0, 8);

    await storageSet({
      [STORAGE_KEYS.uuid]: u,
      [STORAGE_KEYS.pcName]: pcName,
    });

    console.log("[sentinel] identity created:", pcName);
    return { pcName };
  }

  async function getSettings() {
    const got = await storageGet([STORAGE_KEYS.enabled, STORAGE_KEYS.endpointUrl]);
    return {
      enabled: got[STORAGE_KEYS.enabled] !== false, // 기본 ON
      endpointUrl: got[STORAGE_KEYS.endpointUrl] || DEFAULT_ENDPOINT,
    };
  }

  // -------------------------
  // KST time: YYYY-MM-DDTHH:mm:ss.SSSuuu
  // -------------------------
  function nowKstIsoMicro() {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = dtf.formatToParts(new Date());
    const map = {};
    for (const p of parts) map[p.type] = p.value;

    const ms = String(new Date().getMilliseconds()).padStart(3, "0");
    const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    const micro = ms + rand;

    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.${micro}`;
  }

  // -------------------------
  // Payload schema
  // public_ip/private_ip: PCName 그대로
  // -------------------------
  function buildLogPayload({ host, pcName, prompt }) {
    return {
      time: nowKstIsoMicro(),
      public_ip: pcName,
      private_ip: pcName,
      host: host || "",
      PCName: pcName,
      prompt: String(prompt || ""),
      attachment: { format: null, data: null },
      interface: "llm",
    };
  }

  function normalizePrompt(s) {
    const v = String(s ?? "").trim();
    if (!v) return null;
    return v.length > 20000 ? v.slice(0, 20000) : v;
  }

  function getHost() {
    return location.hostname || "";
  }

  async function sendPrompt(prompt) {
    console.log("[sentinel] sendPrompt called:", String(prompt).slice(0, 80));

    const settings = await getSettings();
    if (!settings.enabled) {
      console.log("[sentinel] disabled => skip");
      return;
    }

    const { pcName } = await ensureIdentity();
    const payload = buildLogPayload({ host: getHost(), pcName, prompt });

    chrome.runtime.sendMessage({ type: "SENTINEL_LOG", payload }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) console.log("[sentinel] sendMessage lastError:", err.message);
      console.log("[sentinel] sendMessage resp:", resp);
    });
  }

  // ✅ 콘솔 강제 테스트용 (collector 안 돼도 파이프라인 검증 가능)
  window.__sentinelSend = (p) => sendPrompt(String(p || ""));
  console.log("[sentinel] test: run __sentinelSend('hello') in console");

  // -------------------------
  // ChatGPT collector (더 강하게)
  // -------------------------
  function findInput() {
    return (
      document.querySelector("textarea#prompt-textarea") ||
      document.querySelector("textarea") ||
      document.querySelector("div[contenteditable='true'][role='textbox']") ||
      document.querySelector("div[contenteditable='true']")
    );
  }

  function readValue(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA") return el.value || "";
    return el.textContent || "";
  }

  function isSendButton(btn) {
    if (!btn) return false;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
    const type = (btn.getAttribute("type") || "").toLowerCase();
    const text = (btn.textContent || "").trim().toLowerCase();

    // 영어/한글 케이스 둘 다
    if (label.includes("send") || label.includes("보내")) return true;
    if (testid.includes("send")) return true;
    if (type === "submit") return true;
    if (text === "send" || text.includes("보내")) return true;

    return false;
  }

  function attachChatGPTCollector(onPrompt) {
    console.log("[sentinel] collector attach start");

    // Enter 전송 감지 (document 캡처)
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey) return;
        const el = document.activeElement || findInput();
        const raw = readValue(el);
        const p = normalizePrompt(raw);
        if (p) {
          console.log("[sentinel] keydown enter captured");
          onPrompt(p);
        }
      },
      true
    );

    // Send 버튼 클릭 감지 (document 캡처)
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("button") : null;
        if (!isSendButton(btn)) return;

        const el = findInput();
        const raw = readValue(el);
        const p = normalizePrompt(raw);
        if (p) {
          console.log("[sentinel] send button click captured");
          onPrompt(p);
        }
      },
      true
    );

    // 디버그용: input 존재 확인 로그
    const mo = new MutationObserver(() => {
      const el = findInput();
      if (el && !el.__sentinelLogged) {
        el.__sentinelLogged = true;
        console.log("[sentinel] input found:", el.tagName, el.id || "", el.className || "");
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // 최초 확인
    const first = findInput();
    if (first) console.log("[sentinel] input found initially:", first.tagName, first.id || "");
  }

  // -------------------------
  // boot
  // -------------------------
  (async () => {
    await ensureIdentity();

    const handler = (raw) => {
      const p = normalizePrompt(raw);
      if (p) sendPrompt(p);
    };

    if (getHost() === "chatgpt.com") attachChatGPTCollector(handler);
  })();
})();
