// src/content/file_hook.js
console.log("[sentinel] file_hook (isolated) loaded");

(() => {
  const STORAGE_KEYS = {
    enabled: "sentinel_enabled",
    endpointUrl: "sentinel_endpoint_url",
    pcName: "sentinel_pc_name",
    uuid: "sentinel_uuid",
  };

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  function uuidv4() {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
    return (
      hex.slice(0, 8) + "-" +
      hex.slice(8, 12) + "-" +
      hex.slice(12, 16) + "-" +
      hex.slice(16, 20) + "-" +
      hex.slice(20)
    );
  }

  async function ensureIdentity() {
    const got = await storageGet([STORAGE_KEYS.pcName, STORAGE_KEYS.uuid]);
    if (got[STORAGE_KEYS.pcName]) return { pcName: got[STORAGE_KEYS.pcName] };

    const u = got[STORAGE_KEYS.uuid] || uuidv4();
    const pcName = "CE-" + String(u).replace(/-/g, "").slice(0, 8);

    await storageSet({
      [STORAGE_KEYS.uuid]: u,
      [STORAGE_KEYS.pcName]: pcName,
    });

    console.log("[sentinel] identity created (file_hook):", pcName);
    return { pcName };
  }

  function nowKstIsoMicro() {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = dtf.formatToParts(new Date());
    const map = {};
    for (const p of parts) map[p.type] = p.value;

    const ms = String(new Date().getMilliseconds()).padStart(3, "0");
    const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    const micro = ms + rand;

    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.${micro}`;
  }

  function buildPayload({ pcName, host, attachment }) {
    return {
      time: nowKstIsoMicro(),
      public_ip: pcName,
      private_ip: pcName,
      host: host || "",
      PCName: pcName,
      prompt: "", // 파일 사전검사라 prompt는 비움(스키마 유지)
      attachment: attachment || { format: null, data: null, size: 0 },
      interface: "llm",
    };
  }

  // -------------------------
  // 1) MAIN world 스크립트 주입 (중복 방지)
  // -------------------------
  (function injectMainHook() {
    try {
      if (window.__SENTINEL_FILE_HOOK_MAIN_INJECTED) {
        // 중복 주입 방지
        return;
      }
      window.__SENTINEL_FILE_HOOK_MAIN_INJECTED = true;

      const src = chrome.runtime.getURL("src/content/file_hook_main.js");
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      (document.head || document.documentElement).appendChild(s);

      s.onload = () => {
        s.remove();
        console.log("[sentinel] main hook injected:", src);
      };
      s.onerror = () => {
        console.log("[sentinel] main hook inject FAILED:", src);
        s.remove();
      };
    } catch (e) {
      console.log("[sentinel] main hook inject error:", e);
    }
  })();

  // 유틸 접근은 “처리 시점”에 가져오기 (undefined 방지)
  function getUtils() {
    const FT = window.__SENTINEL_FILE_TYPES;
    const FC = window.__SENTINEL_FILE_CODEC;
    return { FT, FC };
  }

  // ✅ File/Blob duck-typing (Gemini blob 업로드 대응)
  function isBlobLike(x) {
    return !!(
      x &&
      typeof x.size === "number" &&
      typeof x.type === "string" &&
      (typeof x.arrayBuffer === "function" || typeof x.stream === "function")
    );
  }

  function getNameHint(x) {
    // File이면 name 존재. Blob이면 보통 name 없음.
    try {
      if (x && typeof x.name === "string" && x.name) return x.name;
    } catch {}
    return "";
  }

  window.addEventListener(
    "message",
    async (ev) => {
      if (ev.source !== window) return;
      const msg = ev.data;
      if (!msg || msg.type !== "SENTINEL_FILE_HOOK") return;

      const id = msg.id;
      const file = msg.file; // (실제로는 File 또는 Blob)

      try {
        // utils 준비 안됐으면 fail-open
        const { FT, FC } = getUtils();
        if (!FT || !FC) {
          console.log("[sentinel] file_hook: utils missing (FT/FC). fail-open");
          window.postMessage(
            { type: "SENTINEL_FILE_RESULT", id, allow: true, fail_open: true, reason: "utils_missing" },
            "*"
          );
          return;
        }

        // ✅ File/Blob 이 아니면 패스
        if (!isBlobLike(file)) {
          window.postMessage(
            { type: "SENTINEL_FILE_RESULT", id, skipped: true, reason: "no_blob" },
            "*"
          );
          return;
        }

        const fileName = getNameHint(file) || "upload.bin";

        // ✅ 1) 이름 기반 확장자 추정
        let fmt = null;
        try {
          fmt = FT.getFormatFromFileName ? FT.getFormatFromFileName(fileName) : null;
        } catch {
          fmt = null;
        }

        // ✅ 2) 이름이 없거나 확장자 판단이 어려우면 MIME(type) 기반 추정
        if (!fmt) {
          try {
            fmt = FT.getFormatFromMimeType ? FT.getFormatFromMimeType(file.type) : null;
          } catch {
            fmt = null;
          }
        }

        if (!FT.isSupportedFormat || !FT.isSupportedFormat(fmt)) {
          // 요구사항: 지원 확장자만 서버로 전송, 나머지는 무시(통과)
          window.postMessage(
            { type: "SENTINEL_FILE_RESULT", id, skipped: true, reason: "unsupported_format", format: fmt || null },
            "*"
          );
          return;
        }

        // -------------------------
        // File/Blob -> attachment(base64)
        // -------------------------
        let attachment = null;

        // 1) blob 전용 함수가 있으면 우선 사용
        if (typeof FC.blobToAttachment === "function") {
          attachment = await FC.blobToAttachment(file, fmt, fileName);
        } else if (typeof FC.fileToAttachment === "function") {
          // 2) File 전용 함수면 Blob을 File로 감싸서 처리
          //    (Gemini blob 업로드를 여기서 커버)
          let asFile = file;
          try {
            if (!(file instanceof File)) {
              asFile = new File([file], fileName, { type: file.type || "application/octet-stream" });
            }
          } catch (e) {
            // File 생성이 막히면 codec 쪽에서 blob을 받아야 함
            console.log("[sentinel] blob->File wrap failed:", e);
            asFile = null;
          }

          if (asFile) {
            attachment = await FC.fileToAttachment(asFile, fmt, fileName);
          }
        }

        if (!attachment || !attachment.data || !attachment.format) {
          window.postMessage(
            { type: "SENTINEL_FILE_RESULT", id, skipped: true, reason: "codec_failed" },
            "*"
          );
          return;
        }

        const { pcName } = await ensureIdentity();
        const payload = buildPayload({
          pcName,
          host: location.hostname || "",
          attachment,
        });

        console.log("[sentinel] file precheck => send to SW", {
          format: attachment.format,
          size: attachment.size,
          name: fileName,
          mime: String(file.type || ""),
        });

        const resp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "SENTINEL_PROCESS", payload }, (r) => resolve(r || null));
        });

        // fail-open
        if (!resp || resp.ok !== true || !resp.data) {
          console.log("[sentinel] file precheck server fail => fail-open", resp);
          window.postMessage(
            { type: "SENTINEL_FILE_RESULT", id, allow: true, fail_open: true },
            "*"
          );
          return;
        }

        const data = resp.data;

        // 차단
        if (data.allow === false) {
          window.postMessage(
            { type: "SENTINEL_FILE_RESULT", id, allow: false, data },
            "*"
          );
          return;
        }

        // 허용 + 파일 교체
        const att = data.attachment;
        if (att && att.file_change === true && att.data && att.format) {
          const newFile = FC.attachmentToFile(att, fileName);
          window.postMessage(
            { type: "SENTINEL_FILE_RESULT", id, allow: true, file_change: true, newFile, data },
            "*"
          );
          return;
        }

        // 허용(변경 없음)
        window.postMessage(
          { type: "SENTINEL_FILE_RESULT", id, allow: true, file_change: false, data },
          "*"
        );
      } catch (e) {
        console.log("[sentinel] file_hook error:", e);
        // fail-open
        window.postMessage(
          {
            type: "SENTINEL_FILE_RESULT",
            id,
            allow: true,
            fail_open: true,
            error: String(e?.message || e),
          },
          "*"
        );
      }
    },
    true
  );
})();
