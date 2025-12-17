// src/content/utils/file_types.js
(() => {
  const ALLOWED = new Set([
    "png", "jpg", "jpeg", "webp",
    "pdf", "docx", "pptx", "csv", "txt", "xlsx",
  ]);

  function extFromName(name) {
    const s = String(name || "").toLowerCase();
    const idx = s.lastIndexOf(".");
    if (idx < 0) return "";
    return s.slice(idx + 1).trim();
  }

  function normalizeFormat(ext) {
    const e = String(ext || "").toLowerCase();
    if (e === "jpeg") return "jpg"; // 내부 표준을 jpg로
    return e;
  }

  function getFormatFromFileName(fileName) {
    const ext = extFromName(fileName);
    const fmt = normalizeFormat(ext);
    return fmt || null;
  }

  // ✅ (추가) MIME 문자열 정규화
  function normalizeMime(mime) {
    const m = String(mime || "").toLowerCase().trim();
    if (!m) return "";
    // 흔한 비표준/별칭 흡수
    if (m === "image/jpg") return "image/jpeg";
    return m;
  }

  // ✅ (추가) MIME -> format 추정 (Gemini blob 업로드 대응)
  function getFormatFromMimeType(mime) {
    const m = normalizeMime(mime);
    if (!m) return null;

    // 이미지
    if (m === "image/png") return "png";
    if (m === "image/jpeg") return "jpg";
    if (m === "image/webp") return "webp";

    // 문서/오피스
    if (m === "application/pdf") return "pdf";

    // docx/pptx/xlsx 표준
    if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
    if (m === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
    if (m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";

    // 텍스트
    if (m === "text/plain") return "txt";
    if (m === "text/csv" || m === "application/csv") return "csv";

    // 경우에 따라 urlencoded/unknown -> 판단 불가
    return null;
  }

  function isSupportedFormat(fmt) {
    if (!fmt) return false;
    return ALLOWED.has(String(fmt).toLowerCase());
  }

  function guessMime(fmt) {
    const f = String(fmt || "").toLowerCase();
    switch (f) {
      case "png": return "image/png";
      case "jpg": return "image/jpeg";
      case "webp": return "image/webp";
      case "pdf": return "application/pdf";
      case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      case "csv": return "text/csv";
      case "txt": return "text/plain";
      default: return "application/octet-stream";
    }
  }

  window.__SENTINEL_FILE_TYPES = {
    ALLOWED,
    getFormatFromFileName,
    // ✅ 추가 export
    getFormatFromMimeType,
    normalizeMime,

    isSupportedFormat,
    guessMime,
  };
})();
