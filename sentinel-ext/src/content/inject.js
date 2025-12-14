// src/content/inject.js
console.log("[sentinel] inject loaded", location.href);

(() => {
  // -------------------------
  // Storage keys (SW와 반드시 동일)
  // -------------------------
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

  async function ensureIdentity() {
    const got = await storageGet([STORAGE_KEYS.pcName, STORAGE_KEYS.uuid]);
    if (got[STORAGE_KEYS.pcName]) return { pcName: got[STORAGE_KEYS.pcName] };

    const u = got[STORAGE_KEYS.uuid] || uuidv4();
    const pcName = "CE-" + String(u).replace(/-/g, "").slice(0, 8);

    await storageSet({
      [STORAGE_KEYS.uuid]: u,
      [STORAGE_KEYS.pcName]: pcName,
    });

    console.log("[sentinel] identity created (inject):", pcName);
    return { pcName };
  }

  async function getSettings() {
    const got = await storageGet([STORAGE_KEYS.enabled, STORAGE_KEYS.endpointUrl]);
    return {
      enabled: got[STORAGE_KEYS.enabled] !== false, // default ON
      endpointUrl: got[STORAGE_KEYS.endpointUrl] || "https://bobsentinel.com/api/logs",
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

  function buildLogPayload({ host, pcName, prompt }) {
    return {
      time: nowKstIsoMicro(),
      public_ip: pcName, // 요구사항: PCName 그대로
      private_ip: pcName, // 요구사항: PCName 그대로
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

  // -------------------------
  // ChatGPT DOM helpers
  // -------------------------
  const SELECTORS = [
    "textarea#prompt-textarea",
    "textarea",
    "div[contenteditable='true'][role='textbox']",
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
    return el.textContent || "";
  }

  function setValue(el, text) {
    if (!el) return;
    if (el.tagName === "TEXTAREA") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function findSendButton() {
    return (
      document.querySelector("button[data-testid='send-button']") ||
      document.querySelector("button[aria-label*='Send']") ||
      document.querySelector("button[aria-label*='send']") ||
      null
    );
  }

  function programmaticSend() {
    const btn = findSendButton();
    if (btn && !btn.disabled) {
      console.log("[sentinel] programmaticSend: click send button");
      btn.click();
      return true;
    }

    const el = findInput();
    if (!el) return false;

    console.log("[sentinel] programmaticSend: dispatch Enter (fallback)");
    const evt = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(evt);
    return true;
  }

  // -------------------------
  // Hold & Replace flow
  // -------------------------
  let bypassOnce = false; // 우리가 programmaticSend 할 때 무한루프 방지
  let inFlight = false; // 중복 전송 방지
  let lastBlockedAt = 0;

  async function processAndSend(rawPrompt, inputEl) {
    const settings = await getSettings();

    // 확장 OFF면 원래 전송 (홀딩 X)
    if (!settings.enabled) {
      console.log("[sentinel] disabled => passthrough");
      return { mode: "passthrough" };
    }

    if (inFlight) {
      console.log("[sentinel] inFlight => skip");
      return { mode: "skip" };
    }
    inFlight = true;

    try {
      const { pcName } = await ensureIdentity();
      const payload = buildLogPayload({
        host: getHost(),
        pcName,
        prompt: rawPrompt,
      });

      console.log("[sentinel] HOLD => send to SW", payload);

      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "SENTINEL_PROCESS", payload }, (r) =>
          resolve(r || null)
        );
      });

      // fail-open: 서버/네트워크 실패면 원문 그대로 전송
      if (!resp || resp.ok !== true || !resp.data) {
        console.log("[sentinel] server fail => fail-open", resp);
        bypassOnce = true;
        setValue(inputEl, rawPrompt);
        setTimeout(() => {
          programmaticSend();
          bypassOnce = false;
        }, 0);
        return { mode: "fail-open" };
      }

      const data = resp.data;
      console.log("[sentinel] server resp:", data);

      // ✅ allow=false면 차단 (전송 안 함) + 고정 알림 문구
      if (data.allow === false) {
        const now = Date.now();
        if (now - lastBlockedAt > 800) {
          window.alert("관리자 정책에 의해 차단되었습니다.");
        }
        lastBlockedAt = now;

        // 권장: 입력창은 그대로 유지 (rawPrompt 그대로)
        setValue(inputEl, rawPrompt);

        console.log("[sentinel] BLOCKED (allow=false)");
        return { mode: "blocked", data };
      }

      // allow=true
      const modified = String(data.modified_prompt ?? rawPrompt);

      // ✅ 사용자 인지용 알림: alert 문자열을 그대로 표시
      // (원하면 has_sensitive 조건 빼고 항상 alert 있으면 띄울 수도 있음)
      if (data.alert) {
        window.alert(String(data.alert));
      }

      // 입력값을 modified_prompt로 교체 후 실제 전송
      bypassOnce = true;
      setValue(inputEl, modified);

      setTimeout(() => {
        programmaticSend();
        bypassOnce = false;
      }, 0);

      console.log("[sentinel] SENT (allow=true), modified applied");
      return { mode: "masked", data };
    } finally {
      inFlight = false;
    }
  }

  // -------------------------
  // Collector: Enter / Send click을 가로채서 홀딩
  // -------------------------
  function attachChatGPTCollector() {
    console.log("[sentinel] collector attach start");

    function hook(el) {
      if (!el || el.__sentinelHooked) return;
      el.__sentinelHooked = true;

      // Enter 전송 가로채기
      el.addEventListener(
        "keydown",
        async (e) => {
          if (bypassOnce) return;
          if (e.isComposing) return;

          if (e.key === "Enter" && !e.shiftKey) {
            const raw = normalizePrompt(readValue(el));
            if (!raw) return;

            console.log("[sentinel] keydown enter captured => HOLD");

            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === "function") {
              e.stopImmediatePropagation();
            }

            await processAndSend(raw, el);
          }
        },
        true
      );

      // Send 버튼 클릭 가로채기
      document.addEventListener(
        "click",
        async (e) => {
          if (bypassOnce) return;

          const btn = e.target?.closest?.("button");
          if (!btn) return;

          const label = (btn.getAttribute("aria-label") || "").toLowerCase();
          const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
          const looksSend = label.includes("send") || testid.includes("send");
          if (!looksSend) return;

          const raw = normalizePrompt(readValue(el));
          if (!raw) return;

          console.log("[sentinel] send button click captured => HOLD");

          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }

          await processAndSend(raw, el);
        },
        true
      );
    }

    const mo = new MutationObserver(() => {
      const input = findInput();
      if (input) {
        console.log(
          "[sentinel] input found:",
          input.tagName,
          input.id || input.className || ""
        );
      }
      hook(input);
    });

    mo.observe(document.documentElement, { childList: true, subtree: true });

    const input = findInput();
    if (input) console.log("[sentinel] input found initially:", input.tagName);
    hook(input);
  }

  // -------------------------
  // boot
  // -------------------------
  (async () => {
    await ensureIdentity();
    if (getHost() === "chatgpt.com") {
      attachChatGPTCollector();
    }
  })();
})();
