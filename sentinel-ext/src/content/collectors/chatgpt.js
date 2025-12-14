// src/content/collectors/chatgpt.js

function findTextarea() {
  // ChatGPT UI는 자주 바뀌어서 "일단 가장 가능성 높은 textarea"를 잡는 방식
  const t = document.querySelector("textarea");
  return t || null;
}

function findSendButton() {
  // 버튼 후보: aria-label / data-testid 등 다양
  const candidates = [
    'button[aria-label*="Send"]',
    'button[data-testid*="send"]',
    'button[type="submit"]'
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

export function attachChatGPTCollector(onPrompt) {
  let lastSent = "";

  function captureAndSend(from) {
    const ta = findTextarea();
    if (!ta) return;

    const val = (ta.value || "").trim();
    if (!val) return;

    // 중복 전송 방지(연속 클릭/엔터)
    if (val === lastSent) return;
    lastSent = val;

    onPrompt(val);

    // 입력창은 ChatGPT가 처리하므로 여기서 지우진 않음
  }

  // 1) Enter(Shift+Enter 제외)
  document.addEventListener(
    "keydown",
    (e) => {
      const ta = findTextarea();
      if (!ta) return;
      if (document.activeElement !== ta) return;

      if (e.key === "Enter" && !e.shiftKey) {
        // ChatGPT가 submit 처리하기 직전에 캡처
        captureAndSend("enter");
      }
    },
    true
  );

  // 2) Send 버튼 클릭
  document.addEventListener(
    "click",
    (e) => {
      const btn = findSendButton();
      if (!btn) return;
      if (e.target === btn || (e.target && btn.contains(e.target))) {
        captureAndSend("click");
      }
    },
    true
  );

  // 3) 폼 submit (혹시 있을 때)
  document.addEventListener(
    "submit",
    (e) => {
      captureAndSend("submit");
    },
    true
  );
}
