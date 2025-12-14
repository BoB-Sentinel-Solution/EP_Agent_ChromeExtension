// src/lib/time_kst.js

function pad2(n) {
  return String(n).padStart(2, "0");
}
function pad3(n) {
  return String(n).padStart(3, "0");
}

/**
 * KST(+09:00) 기준 "YYYY-MM-DDTHH:MM:SS.ffffff" 형태
 * - microseconds(6자리)는 ms(3자리)+ "000" 으로 채움
 */
export function nowKstIsoMicro() {
  const now = new Date();

  // UTC ms
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  // KST = UTC + 9h
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);

  const Y = kst.getFullYear();
  const M = pad2(kst.getMonth() + 1);
  const D = pad2(kst.getDate());
  const h = pad2(kst.getHours());
  const m = pad2(kst.getMinutes());
  const s = pad2(kst.getSeconds());
  const ms = pad3(kst.getMilliseconds());
  const micros = `${ms}000`;

  return `${Y}-${M}-${D}T${h}:${m}:${s}.${micros}`;
}
