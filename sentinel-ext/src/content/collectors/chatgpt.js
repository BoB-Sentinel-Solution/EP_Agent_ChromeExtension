// src/content/collectors/chatgpt.js
(() => {
  const REG = window.__SENTINEL_COLLECTORS;
  if (!REG) {
    console.warn("[sentinel] collectors registry not loaded");
    return;
  }

  function attach(ctx) {
    const {
      log,
      findInput,
      readValue,
      normalizePrompt,
      shouldBypass,
      onHoldSend, // async (rawPrompt, inputEl) => void
    } = ctx;

    log("[collector/chatgpt] attach start");

    // Enter 가로채기
    document.addEventListener(
      "keydown",
      async (e) => {
        if (shouldBypass()) return;
        if (e.key !== "Enter" || e.shiftKey) return;
        if (e.isComposing) return;

        const inputEl = findInput();
        if (!inputEl) return;

        const raw = normalizePrompt(readValue(inputEl));
        if (!raw) return;

        log("[collector/chatgpt] enter => HOLD");

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        await onHoldSend(raw, inputEl);
      },
      true
    );

    // Send 버튼 클릭 가로채기
    document.addEventListener(
      "click",
      async (e) => {
        if (shouldBypass()) return;

        const btn = e.target?.closest?.("button");
        if (!btn) return;

        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        const testid = (btn.getAttribute("data-testid") || "").toLowerCase();

        const looksSend = label.includes("send") || testid.includes("send");
        if (!looksSend) return;

        const inputEl = findInput();
        if (!inputEl) return;

        const raw = normalizePrompt(readValue(inputEl));
        if (!raw) return;

        log("[collector/chatgpt] click send => HOLD");

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        await onHoldSend(raw, inputEl);
      },
      true
    );
  }

  REG.register({
    id: "chatgpt",
    hosts: ["chatgpt.com"],
    priority: 100,
    attach,
  });
})();
