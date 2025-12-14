// src/content/collectors/generic.js
(() => {
  const REG = window.__SENTINEL_COLLECTORS;
  if (!REG) return;

  function attach(ctx) {
    const {
      log,
      findInput,
      readValue,
      normalizePrompt,
      shouldBypass,
      onHoldSend,
    } = ctx;

    log("[collector/generic] attach start");

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

        log("[collector/generic] enter => HOLD");

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        await onHoldSend(raw, inputEl);
      },
      true
    );

    document.addEventListener(
      "click",
      async (e) => {
        if (shouldBypass()) return;

        const btn = e.target?.closest?.("button, input[type='submit']");
        if (!btn) return;

        const label = (btn.getAttribute?.("aria-label") || "").toLowerCase();
        const type = (btn.getAttribute?.("type") || "").toLowerCase();
        const testid = (btn.getAttribute?.("data-testid") || "").toLowerCase();

        // send/submit 류 추정
        const looksSend =
          label.includes("send") ||
          label.includes("submit") ||
          testid.includes("send") ||
          type === "submit";

        if (!looksSend) return;

        const inputEl = findInput();
        if (!inputEl) return;

        const raw = normalizePrompt(readValue(inputEl));
        if (!raw) return;

        log("[collector/generic] click => HOLD");

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        await onHoldSend(raw, inputEl);
      },
      true
    );
  }

  REG.register({
    id: "generic",
    hosts: [], // pick에서 기본 fallback으로 사용
    priority: -1,
    attach,
  });
})();
