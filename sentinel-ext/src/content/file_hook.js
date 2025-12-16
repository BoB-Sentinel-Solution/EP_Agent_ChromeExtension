// src/content/file_hook.js
// Sentinel CE Agent — File hook (single-file only, allowed extensions only)
// Hook point: <input type="file"> change (capture phase)

(() => {
  "use strict";

  // ✅ Only these extensions are processed; everything else is ignored.
  const ALLOWED = new Set([
    "png", "jpg", "jpeg", "webp",
    "pdf", "docx", "pptx", "csv", "txt", "xlsx",
  ]);

  function getExt(name = "") {
    const i = name.lastIndexOf(".");
    if (i < 0) return "";
    return name.slice(i + 1).toLowerCase();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("FileReader failed"));
      r.onload = () => {
        const s = String(r.result || "");
        // data:*/*;base64,XXXX
        const idx = s.indexOf("base64,");
        resolve(idx >= 0 ? s.slice(idx + 7) : "");
      };
      r.readAsDataURL(file);
    });
  }

  function guessMimeByExt(ext) {
    const e = (ext || "").toLowerCase();
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

  function base64ToFile(b64, format, filename) {
    // atob -> Uint8Array
    const bin = atob(b64 || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const mime = guessMimeByExt(format);
    return new File([bytes], filename, { type: mime });
  }

  async function replaceInputFile(input, newFile) {
    const dt = new DataTransfer();
    dt.items.add(newFile);
    input.files = dt.files;

    // loop guard (change/input will fire again)
    input.dataset.sentinelBypass = "1";

    // Many sites listen to both
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // release guard next tick
    setTimeout(() => {
      delete input.dataset.sentinelBypass;
    }, 0);
  }

  function safeUUID() {
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
    } catch (_) {}
    // fallback (not perfect, but ok for request_id uniqueness in practice)
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  document.addEventListener(
    "change",
    (e) => {
      // fire-and-forget with internal try/catch
      (async () => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement)) return;
        if (t.type !== "file") return;

        // ignore internally-triggered re-dispatch
        if (t.dataset.sentinelBypass === "1") return;

        const files = t.files;
        if (!files || files.length === 0) return;

        // ✅ Policy: no arrays — if multiple selected, do nothing (pass-through)
        if (files.length > 1) return;

        const file = files[0];
        const ext = getExt(file.name);

        // ignore non-allowed extensions
        if (!ALLOWED.has(ext)) return;

        // encode
        const b64 = await fileToBase64(file);

        // build fixed schema (minimal fields here; sw.js can enrich as needed)
        const payload = {
          request_id: safeUUID(),
          host: location.host,
          attachment: {
            format: ext,
            data: b64,
            size: file.size, // bytes
          },
        };

        // send to background -> server
        const res = await chrome.runtime.sendMessage({
          type: "SENTINEL_FILE_REDACT",
          payload,
        });

        if (!res || res.ok !== true) return;

        const att = res.data?.attachment;
        if (!att || att.file_change !== true) return;

        // Server returns: { format, data, size, file_change:true }
        const newExt = String(att.format || ext).toLowerCase();

        // optional: keep original filename but align extension if server changed it
        let newName = file.name;
        if (getExt(newName) !== newExt) {
          const dot = newName.lastIndexOf(".");
          newName = (dot > 0 ? newName.slice(0, dot) : newName) + "." + newExt;
        }

        // construct File from base64 and replace input
        const newFile = base64ToFile(String(att.data || ""), newExt, newName);
        await replaceInputFile(t, newFile);
      })().catch(() => {
        // swallow errors to avoid breaking page behavior
      });
    },
    true // capture: reduce chance of missing early listeners
  );
})();
