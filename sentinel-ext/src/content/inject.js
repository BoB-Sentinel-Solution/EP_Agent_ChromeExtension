// src/content/inject.js

(() => {
  // -------------------------
  // Settings / Identity (storage)
  // -------------------------
  const STORAGE_KEYS = {
    enabled: "sentinel_enabled",
    endpointUrl: "sentinel_endpoint_url",
    pcName: "sentinel_pc_name",
    uuid: "sentinel_uuid"
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
      [STORAGE_KEYS.pcName]: pcName
    });

    return { pcName };
  }

  async function getSettings() {
    const got = await storageGet([STORAGE_KEYS.enabled, STORAGE_KEYS.endpointUrl]);
    return {
      enabled: got[STORAGE_KEYS.enabled] !== false, // 기본 ON
      endpointUrl: got[STORAGE_KEYS.endpointUrl] || "https://bobsentinel.com/api/logs"
    };
  }

  // -------------------------
  // KST time: YYYY-MM-DDTHH:mm:ss.SSSuuu (uuu는 랜덤 마이크로)
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
      hour12: false
    });

    const parts = dtf.formatToParts(new Date());
    const map = {};
    for (const p of parts) map[p.type] = p.value;

    const ms = String(new Date().getMilliseconds()).padStart(3, "0");
    const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0"); // 오탐/형식 고정용
    const micro = ms + rand;

    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.${micro}`;
  }

  // -------------------------
  // Payload schema
  // - public_ip/private_ip: PCName 그대로 (요구사항)
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
      interface: "llm"
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
    const settings = await getSettings();
    if (!settings.enabled) return;

    const { pcName } = await ensureIdentity();

    const payload = buildLogPayload({
      host: getHost(),
      pcName,
      prompt
    });

    chrome.runtime.sendMessage({ type: "SENTINEL_LOG", payload }, () => {});
  }

  // -------------------------
  // ChatGPT collector: Enter / Send 버튼 감지
  // -------------------------
  function attachChatGPTCollector(onPrompt) {
    const SELECTORS = [
      "textarea#prompt-textarea",
      "textarea[data-id='root']",
      "textarea",
      "div[contenteditable='true'][role='textbox']"
    ];

    function findInput() {
      for (const sel of SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    function readValue(el) {
      if (!el) return "";
      if (el.tagName === "TEXTAREA") return el.value || "";
      // contenteditable
      return el.textContent || "";
    }

    function clearValue(el) {
      if (!el) return;
      if (el.tagName === "TEXTAREA") {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        el.textContent = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    function hook(el) {
      if (!el || el.__sentinelHooked) return;
      el.__sentinelHooked = true;

      el.addEventListener("keydown", (e) => {
        // Enter(전송) / Shift+Enter(줄바꿈)
        if (e.key === "Enter" && !e.shiftKey) {
          const raw = readValue(el);
          const p = normalizePrompt(raw);
          if (p) onPrompt(p);
        }
      }, true);

      // 버튼 클릭 전송도 대응(버튼은 DOM이 자주 바뀌어서 document 캡처)
      document.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest && e.target.closest("button");
        if (!btn) return;

        // “Send” 류 버튼 추정: aria-label / data-testid 등을 폭넓게 봄
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
        if (label.includes("send") || testid.includes("send")) {
          const raw = readValue(el);
          const p = normalizePrompt(raw);
          if (p) onPrompt(p);
        }
      }, true);
    }

    // 최초 + DOM 변경 대응
    const mo = new MutationObserver(() => {
      const input = findInput();
      hook(input);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    hook(findInput());
  }

  function attachGenericCollector(onPrompt) {
    // fallback: 아무것도 안 함(필요하면 나중에 확장)
    // 지금은 chatgpt.com만 matches라 사실상 미사용
  }

  // -------------------------
  // boot
  // -------------------------
  (async () => {
    await ensureIdentity();
    const host = getHost();
    const handler = (raw) => {
      const p = normalizePrompt(raw);
      if (p) sendPrompt(p);
    };

    if (host === "chatgpt.com") attachChatGPTCollector(handler);
    else attachGenericCollector(handler);
  })();
})();
