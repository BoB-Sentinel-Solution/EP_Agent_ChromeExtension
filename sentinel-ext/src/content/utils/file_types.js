// src/content/utils/file_types.js
(() => {
  const ALLOWED = {
    // images
    png:  "image/png",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    // docs
    pdf:  "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv:  "text/csv",
    txt:  "text/plain",
  };

  function normalizeExt(ext) {
    return String(ext || "")
      .trim()
      .toLowerCase()
      .replace(/^\./, "");
  }

  function extFromFilename(name) {
    const s = String(name || "");
    const m = s.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? normalizeExt(m[1]) : "";
  }

  function isAllowedExt(ext) {
    const e = normalizeExt(ext);
    return !!ALLOWED[e];
  }

  function mimeFromExt(ext) {
    const e = normalizeExt(ext);
    return ALLOWED[e] || "application/octet-stream";
  }

  function ensureFilenameWithExt(filename, ext) {
    const e = normalizeExt(ext);
    const base = String(filename || "file").replace(/\.[a-z0-9]+$/i, "");
    if (!e) return base;
    return `${base}.${e}`;
  }

  // expose
  window.SentinelFileTypes = {
    ALLOWED,
    normalizeExt,
    extFromFilename,
    isAllowedExt,
    mimeFromExt,
    ensureFilenameWithExt,
  };
})();
