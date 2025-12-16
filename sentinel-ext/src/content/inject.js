// src/content/inject.js
console.log("[sentinel] inject loaded", location.href);

(() => {
  // -------------------------
  // ✅ MAIN world fetch-hook 주입 (최소 추가)
  // -------------------------
  function injectMainHookOnce() {
    try {
      if (window.__SENTINEL_MAIN_HOOK_INJECTED__) return;
      window.__SENTINEL_MAIN_HOOK_INJECTED__ = true;

      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("src/content/file_hook_main.js"); // ✅ web_accessible_resources에 등록된 경로
      s.async = false;
      s.dataset.sentinel = "1";
      (document.documentElement || document.head).appendChild(s);

      console.log("[sentinel] main hook injected:", s.src);
    } catch (e) {
      console.log("[sentinel] main hook inject failed:", e);
    }
  }
  injectMainHookOnce();

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
      // ✅ 최소 수정: size 포함 (file_hook가 채우거나, 없으면 null 유지)
      attachment: { format: null, data: null, size: null },
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
  // Generic DOM helpers
  // -------------------------
  const SELECTORS = [
    "textarea#prompt-textarea",
    "textarea",
    "div[contenteditable='true'][role='textbox']",
  ];

  function isUsableInput(el) {
    if (!el) return false;
    if (el.disabled) return false;

    const rect = el.getBoundingClientRect?.();
    if (rect && (rect.width < 10 || rect.height < 10)) return false;

    const style = window.getComputedStyle?.(el);
    if (style && (style.display === "none" || style.visibility === "hidden"))
      return false;

    return true;
  }

  function findInput() {
    const ae = document.activeElement;
    if (
      ae &&
      (ae.tagName === "TEXTAREA" || ae.isContentEditable) &&
      isUsableInput(ae)
    ) {
      return ae;
    }

    for (const sel of SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isUsableInput(el)) return el;
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
      document.querySelector("button[type='submit']") ||
      null
    );
  }

  function programmaticSend() {
    const btn = findSendButton();
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }

    const el = findInput();
    if (!el) return false;

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
  let bypassOnce = false;
  let inFlight = false;
  let lastAlertAt = 0;

  function safeAlert(msg) {
    const now = Date.now();
    if (now - lastAlertAt < 800) return;
    lastAlertAt = now;
    window.alert(msg);
  }

  async function processAndSend(rawPrompt, inputEl) {
    const settings = await getSettings();

    console.log(
      "[sentinel] enabled =",
      settings.enabled,
      "| endpoint =",
      settings.endpointUrl
    );

    if (!settings.enabled) {
      console.log("[sentinel] passthrough (disabled) => send original");
      bypassOnce = true;
      setValue(inputEl, rawPrompt);
      setTimeout(() => {
        programmaticSend();
        bypassOnce = false;
      }, 0);
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
        chrome.runtime.sendMessage(
          { type: "SENTINEL_PROCESS", payload },
          (r) => resolve(r || null)
        );
      });

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

      if (data.allow === false) {
        safeAlert("관리자 정책에 의해 차단되었습니다.");
        return { mode: "blocked", data };
      }

      const modified = String(data.modified_prompt ?? rawPrompt);

      if (data.has_sensitive && data.alert) {
        safeAlert(data.alert);
      }

      bypassOnce = true;
      setValue(inputEl, modified);

      setTimeout(() => {
        programmaticSend();
        bypassOnce = false;
      }, 0);

      return { mode: "masked", data };
    } finally {
      inFlight = false;
    }
  }

  // -------------------------
  // Manual test
  // -------------------------
  window.__sentinelSend = async (text) => {
    const inputEl = findInput();
    if (!inputEl) {
      console.log("[sentinel] __sentinelSend: input not found");
      return;
    }
    const raw = normalizePrompt(text);
    if (!raw) return;
    console.log("[sentinel] __sentinelSend invoked:", raw);
    await processAndSend(raw, inputEl);
  };

  // -------------------------
  // boot
  // -------------------------
  (async () => {
    await ensureIdentity();

    const host = getHost();

    const REG = window.__SENTINEL_COLLECTORS;
    if (!REG || typeof REG.pick !== "function") {
      console.log("[sentinel] collector registry missing. (check manifest load order)");
      return;
    }

    const picked = REG.pick(host);
    if (!picked || typeof picked.attach !== "function") {
      console.log("[sentinel] no collector found for host:", host);
      return;
    }

    console.log("[sentinel] picked collector:", picked.id || "(no id)");

    picked.attach({
      log: (...args) => console.log("[sentinel]", ...args),

      findInput,
      readValue,
      setValue,

      normalizePrompt,

      shouldBypass: () => bypassOnce,
      isComposingEvent: (e) => !!e?.isComposing,

      onHoldSend: processAndSend,
    });
  })();
})();
