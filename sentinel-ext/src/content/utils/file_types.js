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
    isSupportedFormat,
    guessMime,
  };
})();
