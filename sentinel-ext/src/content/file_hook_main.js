// src/content/file_hook_main.js
(() => {
  // ✅ 중복 로드/중복 래핑 방지
  if (window.__SENTINEL_FILE_HOOK_MAIN_INSTALLED) {
    console.log("[sentinel] file_hook_main: already installed, skip");
    return;
  }
  window.__SENTINEL_FILE_HOOK_MAIN_INSTALLED = true;

  console.log("[sentinel] file_hook_main (network wrapper) loaded");

  let seq = 0;

  // -------------------------
  // 업로드 URL 필터 (광고/측정 요청으로 오탐 방지)
  //  - 여기만 통과한 요청에만 파일 사전검사/교체 로직 적용
  // -------------------------
  function isLikelyUploadUrl(url) {
    const u = String(url || "");
    // Gemini/Google 업로드에서 흔한 엔드포인트들
    if (u.includes("content-push.googleapis.com/upload")) return true;
    if (u.includes("googleusercontent.com/upload")) return true;
    if (u.includes("/upload/")) return true;

    // 안전장치: 광고/측정 도메인은 무조건 제외
    if (u.includes("googleadservices.com")) return false;
    if (u.includes("doubleclick.net")) return false;
    if (u.includes("googletagmanager.com")) return false;
    if (u.includes("google-analytics.com")) return false;

    return false;
  }

  // -------------------------
  // input[type=file] change fallback (Gemini 대응)
  //  - 사용자가 선택한 File을 미리 기록해두고
  //  - 네트워크 업로드 시점에 같은 파일이면 그 결과를 재사용
  // -------------------------
  const PENDING_TTL_MS = 60_000; // 60초 내 업로드면 같은 파일로 취급
  const pending = new Map(); // key -> { ts, file, promise, meta }

  function now() {
    return Date.now();
  }

  function fileKey(f) {
    const name = String(f?.name || "");
    const size = Number(f?.size || 0);
    const type = String(f?.type || "");
    const lm = Number(f?.lastModified || 0);
    return `${name}|${size}|${type}|${lm}`;
  }

  function purgePending() {
    const t = now();
    for (const [k, v] of pending.entries()) {
      if (!v || (t - v.ts) > PENDING_TTL_MS) pending.delete(k);
    }
  }

  function putPending(file) {
    try {
      if (!(file instanceof File)) return;
      purgePending();

      const k = fileKey(file);
      if (pending.has(k)) return;

      // ✅ meta를 같이 넘겨서 (Blob로 변환되어도) format 판단 힌트 제공
      const meta = {
        nameHint: String(file.name || "upload.bin"),
        type: String(file.type || ""),
      };

      const p = waitFileDecision(file, meta).catch((e) => {
        console.log("[sentinel] pending decision error => fail-open", e);
        return { allow: true, fail_open: true, reason: "pending_error" };
      });

      pending.set(k, { ts: now(), file, promise: p, meta });
      console.log("[sentinel] file change captured => pending set:", file.name, file.size);
    } catch {}
  }

  function getPendingDecisionForFile(file) {
    try {
      if (!(file instanceof File)) return null;
      purgePending();
      const k = fileKey(file);
      const hit = pending.get(k);
      if (!hit) return null;
      return hit.promise || null;
    } catch {
      return null;
    }
  }

  function getPendingDecisionForBlob(blob) {
    // Blob은 name/type이 없을 수 있으니 (Gemini 케이스)
    // ✅ size + 최신순으로 pending 중 가장 가까운 것을 매칭 (type 비교는 약하게)
    try {
      if (!(blob instanceof Blob)) return null;
      purgePending();

      const bSize = Number(blob.size || 0);
      const bType = String(blob.type || "");
      const t = now();

      let best = null;

      for (const v of pending.values()) {
        if (!v || !v.file) continue;
        const age = t - v.ts;
        if (age > PENDING_TTL_MS) continue;

        const fSize = Number(v.file.size || 0);
        const fType = String(v.file.type || "");

        if (fSize !== bSize) continue;

        const typeOk = (!bType || !fType) ? true : (bType === fType);
        if (!typeOk) continue;

        if (!best || v.ts > best.ts) best = v;
      }

      return best ? (best.promise || null) : null;
    } catch {
      return null;
    }
  }

  // capturing 단계에서 file input change 훅
  window.addEventListener(
    "change",
    (e) => {
      try {
        const el = e?.target;
        if (!el) return;
        if (el.tagName !== "INPUT") return;
        if (String(el.type || "").toLowerCase() !== "file") return;

        const files = el.files;
        if (!files || !files.length) return;

        for (const f of files) putPending(f);
      } catch {}
    },
    true
  );

  // ✅ drag&drop 업로드 대비
  window.addEventListener(
    "drop",
    (e) => {
      try {
        const dt = e?.dataTransfer;
        const files = dt?.files;
        if (!files || !files.length) return;
        for (const f of files) putPending(f);
      } catch {}
    },
    true
  );

  // ✅ paste 업로드 대비
  window.addEventListener(
    "paste",
    (e) => {
      try {
        const items = e?.clipboardData?.items;
        if (!items || !items.length) return;
        for (const it of items) {
          if (it?.kind === "file") {
            const f = it.getAsFile?.();
            if (f) putPending(f);
          }
        }
      } catch {}
    },
    true
  );

  function waitFileDecision(file, meta, timeoutMs = 15000) {
    const id = `${Date.now()}-${++seq}`;

    return new Promise((resolve) => {
      let done = false;

      function cleanup() {
        window.removeEventListener("message", onMsg, true);
      }

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        resolve({ id, allow: true, fail_open: true, reason: "timeout" });
      }, timeoutMs);

      function onMsg(ev) {
        if (ev.source !== window) return;
        const msg = ev.data;
        if (!msg || msg.type !== "SENTINEL_FILE_RESULT" || msg.id !== id) return;

        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve(msg);
      }

      window.addEventListener("message", onMsg, true);

      window.postMessage({ type: "SENTINEL_FILE_HOOK", id, file, meta: meta || {} }, "*");
    });
  }

  // -------------------------
  // FormData helpers
  //  - File 뿐 아니라 Blob도 탐지/교체
  // -------------------------
  function isFileLike(v) {
    return v instanceof File || v instanceof Blob;
  }

  function findFirstFileLikeInFormData(fd) {
    try {
      for (const [key, val] of fd.entries()) {
        if (isFileLike(val)) return { key, value: val };
      }
    } catch {}
    return null;
  }

  function replaceFirstFileLikeInFormData(fd, newFile) {
    const hit = findFirstFileLikeInFormData(fd);
    if (!hit) return fd;

    const out = new FormData();
    for (const [k, v] of fd.entries()) {
      if (k === hit.key && isFileLike(v)) {
        out.append(k, newFile, newFile.name);
      } else {
        out.append(k, v);
      }
    }
    return out;
  }

  // ✅ Request 객체로 들어온 업로드를 처리
  function tryHandleRequestBodyAsFormData(req) {
    try {
      if (!(req instanceof Request)) return null;
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") return null;

      return req
        .clone()
        .formData()
        .then((fd) => ({ ok: true, fd }))
        .catch(() => null);
    } catch {
      return null;
    }
  }

  // -------------------------
  // fetch wrapper
  // -------------------------
  const _fetch = window.fetch;

  window.fetch = function (input, init) {
    try {
      const url = (input instanceof Request) ? input.url : String(input || "");
      if (!isLikelyUploadUrl(url)) return _fetch.apply(this, arguments);

      const body = init && init.body;

      console.log("[sentinel] fetch(upload) =>", {
        url,
        bodyKind: body?.constructor?.name,
        size: body?.size,
        type: body?.type,
      });

      // FormData에 File/Blob이 있으면 사전검사
      if (body instanceof FormData) {
        const hit = findFirstFileLikeInFormData(body);
        if (!hit) return _fetch.apply(this, arguments);

        const v = hit.value;

        const pendingP =
          (v instanceof File ? getPendingDecisionForFile(v) : null) ||
          (v instanceof Blob ? getPendingDecisionForBlob(v) : null);

        const meta = {
          nameHint: String(v?.name || "upload.bin"),
          type: String(v?.type || ""),
        };

        const decisionP = pendingP || waitFileDecision(v, meta);

        return decisionP.then((decision) => {
          if (decision.allow === false) {
            console.log("[sentinel] fetch(upload) BLOCKED by policy");
            throw new Error("blocked_by_policy");
          }

          if (decision.file_change && decision.newFile instanceof File) {
            const newBody = replaceFirstFileLikeInFormData(body, decision.newFile);
            const newInit = { ...(init || {}), body: newBody };
            console.log("[sentinel] fetch(upload) REPLACED:", decision.newFile.name, decision.newFile.size);
            return _fetch.call(this, input, newInit);
          }

          return _fetch.apply(this, arguments);
        });
      }

      // 단일 File/Blob 업로드
      if (isFileLike(body)) {
        const pendingP =
          (body instanceof File ? getPendingDecisionForFile(body) : null) ||
          (body instanceof Blob ? getPendingDecisionForBlob(body) : null);

        const meta = {
          nameHint: String(body?.name || "upload.bin"),
          type: String(body?.type || ""),
        };

        const decisionP = pendingP || waitFileDecision(body, meta);

        return decisionP.then((decision) => {
          if (decision.allow === false) throw new Error("blocked_by_policy");

          if (decision.file_change && decision.newFile instanceof File) {
            const newInit = { ...(init || {}), body: decision.newFile };
            console.log("[sentinel] fetch(file/blob) REPLACED:", decision.newFile.name, decision.newFile.size);
            return _fetch.call(this, input, newInit);
          }

          return _fetch.apply(this, arguments);
        });
      }

      // fetch(new Request(...)) 패턴 대응
      if (!body && input instanceof Request) {
        const p = tryHandleRequestBodyAsFormData(input);
        if (p) {
          return p.then((r) => {
            if (!r || !r.ok || !(r.fd instanceof FormData)) return _fetch.apply(this, arguments);

            const hit = findFirstFileLikeInFormData(r.fd);
            if (!hit) return _fetch.apply(this, arguments);

            const v = hit.value;

            const pendingP =
              (v instanceof File ? getPendingDecisionForFile(v) : null) ||
              (v instanceof Blob ? getPendingDecisionForBlob(v) : null);

            const meta = {
              nameHint: String(v?.name || "upload.bin"),
              type: String(v?.type || ""),
            };

            const decisionP = pendingP || waitFileDecision(v, meta);

            return decisionP.then((decision) => {
              if (decision.allow === false) throw new Error("blocked_by_policy");

              if (decision.file_change && decision.newFile instanceof File) {
                const newFd = replaceFirstFileLikeInFormData(r.fd, decision.newFile);
                const newReq = new Request(input, { body: newFd });
                console.log("[sentinel] fetch(Request) REPLACED:", decision.newFile.name, decision.newFile.size);
                return _fetch.call(this, newReq);
              }

              return _fetch.apply(this, arguments);
            });
          });
        }
      }

      return _fetch.apply(this, arguments);
    } catch (e) {
      throw e;
    }
  };

  console.log("[sentinel] file_hook_main: fetch wrapper installed");

  // -------------------------
  // XHR wrapper
  // -------------------------
  const XHR = window.XMLHttpRequest;
  const _open = XHR.prototype.open;
  const _send = XHR.prototype.send;

  XHR.prototype.open = function (method, url) {
    this.__sentinel_method = method;
    this.__sentinel_url = url;
    return _open.apply(this, arguments);
  };

  XHR.prototype.send = function (body) {
    try {
      const url = this.__sentinel_url || "";

      // ✅ 업로드 URL만 처리 (광고/측정/기타 요청은 스킵)
      if (!isLikelyUploadUrl(url)) {
        return _send.apply(this, arguments);
      }

      console.log("[sentinel] XHR(send/upload) =>", {
        method: this.__sentinel_method,
        url,
        kind: body instanceof FormData ? "FormData" : (body instanceof Blob ? "Blob" : typeof body),
        size: body?.size,
        type: body?.type,
      });

      // FormData
      if (body instanceof FormData) {
        const hit = findFirstFileLikeInFormData(body);
        if (!hit) return _send.apply(this, arguments);

        const v = hit.value;
        console.log("[sentinel] XHR upload detected:", v?.name || "(blob)", v?.size);

        const pendingP =
          (v instanceof File ? getPendingDecisionForFile(v) : null) ||
          (v instanceof Blob ? getPendingDecisionForBlob(v) : null);

        const meta = {
          nameHint: String(v?.name || "upload.bin"),
          type: String(v?.type || ""),
        };

        const decisionP = pendingP || waitFileDecision(v, meta);

        decisionP
          .then((decision) => {
            if (decision.allow === false) {
              console.log("[sentinel] XHR upload BLOCKED by policy");
              try { this.abort(); } catch {}
              return;
            }

            if (decision.file_change && decision.newFile instanceof File) {
              const newBody = replaceFirstFileLikeInFormData(body, decision.newFile);
              console.log("[sentinel] XHR upload REPLACED:", decision.newFile.name, decision.newFile.size);
              _send.call(this, newBody);
              return;
            }

            _send.apply(this, arguments);
          })
          .catch((e) => {
            console.log("[sentinel] XHR decision error => fail-open", e);
            try { _send.apply(this, arguments); } catch {}
          });

        return;
      }

      // 단일 File/Blob
      if (isFileLike(body)) {
        console.log("[sentinel] XHR file/blob detected:", body?.name || "(blob)", body?.size);

        const pendingP =
          (body instanceof File ? getPendingDecisionForFile(body) : null) ||
          (body instanceof Blob ? getPendingDecisionForBlob(body) : null);

        const meta = {
          nameHint: String(body?.name || "upload.bin"),
          type: String(body?.type || ""),
        };

        const decisionP = pendingP || waitFileDecision(body, meta);

        decisionP
          .then((decision) => {
            if (decision.allow === false) {
              try { this.abort(); } catch {}
              return;
            }

            if (decision.file_change && decision.newFile instanceof File) {
              console.log("[sentinel] XHR file/blob REPLACED:", decision.newFile.name, decision.newFile.size);
              _send.call(this, decision.newFile);
              return;
            }

            _send.apply(this, arguments);
          })
          .catch((e) => {
            console.log("[sentinel] XHR decision error => fail-open", e);
            try { _send.apply(this, arguments); } catch {}
          });

        return;
      }

      return _send.apply(this, arguments);
    } catch (e) {
      throw e;
    }
  };

  console.log("[sentinel] file_hook_main: XHR wrapper installed");
})();
