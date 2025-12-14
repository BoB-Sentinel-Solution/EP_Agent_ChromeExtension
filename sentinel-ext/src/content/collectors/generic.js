// src/content/collectors/generic.js

export function attachGenericCollector(onPrompt) {
  let lastSent = "";

  function activeInputValue() {
    const el = document.activeElement;
    if (!el) return null;

    // textarea or text input
    if (el.tagName === "TEXTAREA") return el.value;
    if (el.tagName === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "text" || t === "search") return el.value;
    }
    return null;
  }

  function maybeSend(reason) {
    const raw = activeInputValue();
    const val = String(raw ?? "").trim();
    if (!val) return;
    if (val === lastSent) return;
    lastSent = val;
    onPrompt(val);
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        maybeSend("enter");
      }
    },
    true
  );
}
