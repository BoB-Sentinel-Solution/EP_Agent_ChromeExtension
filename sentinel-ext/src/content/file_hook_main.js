// src/content/file_hook_main.js
(() => {
  const SENTINEL_FLAG = "__sentinel";
  const REQ_TYPE = "SENTINEL_REDACT_FILE";
  const RES_TYPE = "SENTINEL_REDACT_FILE_RESULT";

  const ALLOWED_EXT = new Set([
    "png","jpg","jpeg","webp",
    "pdf","docx","pptx","csv","txt","xlsx",
  ]);

  const MIME = {
    png:  "image/png",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    pdf:  "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv:  "text/csv",
    txt:  "text/plain",
  };

  function normalizeExt(ext) {
    return String(ext || "").trim().toLowerCase().replace(/^\./, "");
  }

  function extFromFilename(name) {
    const s = String(name || "");
    const m = s.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? normalizeExt(m[1]) : "";
  }

  function mimeFromExt(ext) {
    return MIME[normalizeExt(ext)] || "application/octet-stream";
  }

  function ensureFilenameWithExt(filename, ext) {
    const e = normalizeExt(ext);
    const base = String(filename || "file").replace(/\.[a-z0-9]+$/i, "");
    return e ? `${base}.${e}` : base;
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(String(b64 || ""));
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function shouldSkipUrl(url) {
    // Sentinel 서버로 보내는 요청은 후킹 제외(루프 방지)
    try {
      const u = new URL(url, location.href);
      return u.hostname.endsWith("bobsentinel.com") || u.hostname.endsWith("bobsentinel.site");
    } catch {
      return false;
    }
  }

  async function extractFirstAllowedFileFromFormData(fd) {
    let found = null;

    for (const [key, value] of fd.entries()) {
      if (value instanceof File) {
        const ext = extFromFilename(value.name);
        if (ALLOWED_EXT.has(ext)) {
          if (found) {
            // 배열로 안 보내는 정책이라 "추가 파일"은 일단 경고만(필요하면 여기서 차단 정책으로 바꿀 수 있음)
            console.warn("[sentinel] multiple allowed files detected; only the first one will be processed.");
            continue;
          }
          found = { field: key, file: value, ext };
        }
      }
    }

    return found;
  }

  function rebuildFormDataWithReplacedFile(fd, targetField, newFile) {
    const newFd = new FormData();
    for (const [key, value] of fd.entries()) {
      if (key === targetField && value instanceof File) {
        newFd.append(key, newFile, newFile.name);
      } else {
        newFd.append(key, value);
      }
    }
    return newFd;
  }

  function waitForDecision(requestId, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null); // fail-open
      }, timeoutMs);

      function onMessage(ev) {
        const msg = ev && ev.data;
        if (!msg || msg[SENTINEL_FLAG] !== true) return;
        if (msg.type !== RES_TYPE) return;
        if (msg.request_id !== requestId) return;

        cleanup();
        resolve(msg);
      }

      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
      }

      window.addEventListener("message", onMessage);
    });
  }

  const origFetch = window.fetch.bind(window);

  window.fetch = async function(input, init) {
    try {
      const url = (typeof input === "string") ? input : (input && input.url) ? input.url : "";
      if (url && shouldSkipUrl(url)) {
        return origFetch(input, init);
      }

      const body = init && init.body;
      if (!(body instanceof FormData)) {
        return origFetch(input, init);
      }

      const found = await extractFirstAllowedFileFromFormData(body);
      if (!found) {
        return origFetch(input, init);
      }

      const requestId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();

      // File -> base64 attachment
      const buf = await found.file.arrayBuffer();
      const attachment = {
        format: found.ext,
        data: arrayBufferToBase64(buf),
        size: found.file.size >>> 0,
      };

      // ask ISOLATED world to call SW -> server
      window.postMessage({
        [SENTINEL_FLAG]: true,
        type: REQ_TYPE,
        request_id: requestId,
        host: location.host,
        upload_url: url,
        method: (init && init.method) ? String(init.method).toUpperCase() : "POST",
        file_field: found.field,
        file_name: found.file.name,
        file_type: found.file.type || mimeFromExt(found.ext),
        attachment,
      }, "*");

      const decision = await waitForDecision(requestId, 10_000);
      if (!decision || decision.ok !== true) {
        // fail-open: 원본 그대로 전송
        return origFetch(input, init);
      }

      if (decision.block === true) {
        // 업로드 차단: 페이지에는 실패로 보이게
        return new Response("", { status: 403, statusText: "Blocked by Sentinel" });
      }

      if (decision.replace === true && decision.attachment && decision.attachment.data && decision.attachment.format) {
        const fmt = normalizeExt(decision.attachment.format);
        const newName = ensureFilenameWithExt(found.file.name, fmt);
        const mime = mimeFromExt(fmt);

        const outBuf = base64ToArrayBuffer(decision.attachment.data);
        const outBlob = new Blob([outBuf], { type: mime });
        const outFile = new File([outBlob], newName, { type: mime, lastModified: Date.now() });

        const newFd = rebuildFormDataWithReplacedFile(body, found.field, outFile);
        const newInit = Object.assign({}, init, { body: newFd });

        return origFetch(input, newInit);
      }

      // replace 아님: 원본 그대로 전송
      return origFetch(input, init);
    } catch (e) {
      // fail-open (깨짐 방지)
      return origFetch(input, init);
    }
  };

  console.log("[sentinel] file_hook_main (fetch wrapper) installed");
})();
