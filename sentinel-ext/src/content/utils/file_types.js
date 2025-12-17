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

  // ✅ mime normalize / mime -> format
  function normalizeMime(mime) {
    return String(mime || "").toLowerCase().split(";")[0].trim();
  }

  function getFormatFromMimeType(mime) {
    const m = normalizeMime(mime);
    switch (m) {
      case "image/png": return "png";
      case "image/jpeg": return "jpg";
      case "image/webp": return "webp";
      case "application/pdf": return "pdf";

      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "pptx";
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx";

      case "text/csv": return "csv";
      case "text/plain": return "txt";
      default: return null;
    }
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
    normalizeMime,
    getFormatFromMimeType,
    guessMime,
  };
})();
