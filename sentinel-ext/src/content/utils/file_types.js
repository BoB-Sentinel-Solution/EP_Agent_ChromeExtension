// src/content/utils/file_types.js
// Allowed file types for Sentinel CE Agent (single-file policy, fixed schema)

export const ALLOWED_EXTS = Object.freeze([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "pdf",
  "docx",
  "pptx",
  "csv",
  "txt",
  "xlsx",
]);

export const ALLOWED_EXT_SET = new Set(ALLOWED_EXTS);

// ext (no dot), lowercase
export function getFileExt(filename = "") {
  const s = String(filename);
  const i = s.lastIndexOf(".");
  if (i < 0 || i === s.length - 1) return "";
  return s.slice(i + 1).toLowerCase();
}

export function isAllowedExt(ext) {
  return ALLOWED_EXT_SET.has(String(ext || "").toLowerCase());
}

export function isAllowedFile(file) {
  if (!file) return false;
  const ext = getFileExt(file.name || "");
  return isAllowedExt(ext);
}

export function guessMimeByExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "pdf") return "application/pdf";
  if (e === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (e === "pptx")
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (e === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === "csv") return "text/csv";
  if (e === "txt") return "text/plain";
  return "application/octet-stream";
}

// File -> base64 payload (no data: prefix)
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    try {
      const r = new FileReader();
      r.onerror = () => reject(new Error("FileReader failed"));
      r.onload = () => {
        const s = String(r.result || "");
        const idx = s.indexOf("base64,");
        resolve(idx >= 0 ? s.slice(idx + 7) : "");
      };
      r.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}

// base64 -> File
export function base64ToFile(b64, ext, filename) {
  const bin = atob(String(b64 || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const mime = guessMimeByExt(ext);
  return new File([bytes], filename, { type: mime });
}

// Ensure filename has the given extension (ext without dot)
export function ensureExt(filename, ext) {
  const e = String(ext || "").toLowerCase();
  let name = String(filename || "file");
  const dot = name.lastIndexOf(".");
  if (dot > 0) name = name.slice(0, dot);
  return e ? `${name}.${e}` : name;
}
