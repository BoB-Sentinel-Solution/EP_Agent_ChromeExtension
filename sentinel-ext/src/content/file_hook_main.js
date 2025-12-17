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
  // ✅ URL 필터: "업로드만 허용"이 아니라 "광고/측정만 제외"
  //  - ChatGPT/OpenAI 업로드 URL이 다양해서 whitelist 방식이면 깨짐
  //  - 파일이 body로 실리면 그게 업로드임 → URL은 차단리스트만 적용
  // -------------------------
  function isIgnoredUrl(url) {
    const u = String(url || "");
    // 광고/측정 계열만 제외
    if (u.includes("googleadservices.com")) return true;
    if (u.includes("doubleclick.net")) return true;
    if (u.includes("googletagmanager.com")) return true;
    if (u.includes("google-analytics.com")) return true;
    return false;
  }

  // -------------------------
  // pending (선택 시점 File 기록)
  // -------------------------
  const PENDING_TTL_MS = 60_000;
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

      window.postMessage(
        { type: "SENTINEL_FILE_HOOK", id, file, meta: meta || {} },
        "*"
      );
    });
  }

  function putPending(file) {
    try {
      if (!(file instanceof File)) return;
      purgePending();

      const k = fileKey(file);
      if (pending.has(k)) return;

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
      return hit ? (hit.promise || null) : null;
    } catch {
      return null;
    }
  }

  function getPendingDecisionForBlob(blob) {
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

        // type이 둘 다 있으면 같을 때만 매칭, 하나라도 비면 size로만 매칭
        const typeOk = (!bType || !fType) ? true : (bType === fType);
        if (!typeOk) continue;

        if (!best || v.ts > best.ts) best = v;
      }

      return best ? (best.promise || null) : null;
    } catch {
      return null;
    }
  }

  // -------------------------
  // ✅ input[type=file] 선택 시점 교체 (best-effort)
  //  - 브라우저 정책상 input.files는 종종 read-only라 실패할 수 있음
  //  - 실패해도 네트워크(fetch/XHR) 교체가 주력으로 계속 동작하도록 설계
  // -------------------------
  const PATCH_GUARD_MS = 1000;

  function shouldSkipInputPatch(inputEl) {
    try {
      const t = now();
      if (inputEl.__SENTINEL_PATCHING) return true;
      const last = Number(inputEl.__SENTINEL_LAST_PATCH_TS || 0);
      if (last && (t - last) < PATCH_GUARD_MS) return true;
      return false;
    } catch {
      return true;
    }
  }

  function setInputFilesBestEffort(inputEl, filesArr) {
    const dt = new DataTransfer();
    for (const f of filesArr) {
      if (f instanceof File) dt.items.add(f);
    }
    // 일부 사이트/브라우저에서 막힐 수 있음(예외 처리 필요)
    inputEl.files = dt.files;
  }

  window.addEventListener(
    "change",
    (e) => {
      try {
        const el = e?.target;
        if (!el) return;
        if (el.tagName !== "INPUT") return;
        if (String(el.type || "").toLowerCase() !== "file") return;
        if (shouldSkipInputPatch(el)) return;

        const files = el.files;
        if (!files || !files.length) return;

        // 원본 change를 캡처에서 멈추고, 교체 후 재발행 시도
        e.stopImmediatePropagation();
        e.stopPropagation();

        el.__SENTINEL_PATCHING = true;

        const originals = Array.from(files);

        for (const f of originals) putPending(f);

        Promise.all(
          originals.map((f) => {
            const meta = { nameHint: String(f.name || "upload.bin"), type: String(f.type || "") };
            const p = getPendingDecisionForFile(f) || waitFileDecision(f, meta);
            return p.then((decision) => ({ file: f, decision }));
          })
        )
          .then((results) => {
            const outFiles = [];

            for (const { file, decision } of results) {
              if (decision && decision.allow === false) {
                console.log("[sentinel] input-file BLOCKED by policy:", file?.name, file?.size);
                continue;
              }

              if (decision && decision.file_change && decision.newFile instanceof File) {
                console.log("[sentinel] input-file REPLACED:", decision.newFile.name, decision.newFile.size);
                outFiles.push(decision.newFile);
              } else {
                outFiles.push(file);
              }
            }

            try {
              if (!outFiles.length) {
                try { el.value = ""; } catch {}
              } else {
                try {
                  setInputFilesBestEffort(el, outFiles);
                } catch (err) {
                  console.log("[sentinel] input.files assign FAILED (ok, fallback to net replace):", err);
                }
              }
            } finally {
              el.__SENTINEL_LAST_PATCH_TS = now();
              el.__SENTINEL_PATCHING = false;
            }

            // 앱에게 다시 change 전달
            const ev2 = new Event("change", { bubbles: true });
            el.dispatchEvent(ev2);
          })
          .catch((err) => {
            console.log("[sentinel] input-file patch error => fail-open:", err);
            el.__SENTINEL_LAST_PATCH_TS = now();
            el.__SENTINEL_PATCHING = false;

            const ev2 = new Event("change", { bubbles: true });
            el.dispatchEvent(ev2);
          });
      } catch {}
    },
    true
  );

  // drag/drop, paste는 pending만 유지
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

  // -------------------------
  // FormData helpers
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
      if (isIgnoredUrl(url)) return _fetch.apply(this, arguments);

      const body = init && init.body;

      // FormData에 File/Blob
      if (body instanceof FormData) {
        const hit = findFirstFileLikeInFormData(body);
        if (!hit) return _fetch.apply(this, arguments);

        const v = hit.value;

        console.log("[sentinel] fetch upload detected:", v?.name || "(blob)", v?.size, "=>", url);

        const pendingP =
          (v instanceof File ? getPendingDecisionForFile(v) : null) ||
          (v instanceof Blob ? getPendingDecisionForBlob(v) : null);

        const meta = { nameHint: String(v?.name || "upload.bin"), type: String(v?.type || "") };
        const decisionP = pendingP || waitFileDecision(v, meta);

        return decisionP.then((decision) => {
          if (decision.allow === false) throw new Error("blocked_by_policy");

          if (decision.file_change && decision.newFile instanceof File) {
            const newBody = replaceFirstFileLikeInFormData(body, decision.newFile);
            const newInit = { ...(init || {}), body: newBody };
            console.log("[sentinel] fetch(upload) REPLACED:", decision.newFile.name, decision.newFile.size);
            return _fetch.call(this, input, newInit);
          }

          return _fetch.apply(this, arguments);
        });
      }

      // 단일 File/Blob
      if (isFileLike(body)) {
        console.log("[sentinel] fetch file/blob detected:", body?.name || "(blob)", body?.size, "=>", url);

        const pendingP =
          (body instanceof File ? getPendingDecisionForFile(body) : null) ||
          (body instanceof Blob ? getPendingDecisionForBlob(body) : null);

        const meta = { nameHint: String(body?.name || "upload.bin"), type: String(body?.type || "") };
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

      // fetch(new Request(...)) 패턴
      if (!body && input instanceof Request) {
        const p = tryHandleRequestBodyAsFormData(input);
        if (p) {
          return p.then((r) => {
            if (!r || !r.ok || !(r.fd instanceof FormData)) return _fetch.apply(this, arguments);

            const hit = findFirstFileLikeInFormData(r.fd);
            if (!hit) return _fetch.apply(this, arguments);

            const v = hit.value;

            console.log("[sentinel] fetch(Request) upload detected:", v?.name || "(blob)", v?.size, "=>", url);

            const pendingP =
              (v instanceof File ? getPendingDecisionForFile(v) : null) ||
              (v instanceof Blob ? getPendingDecisionForBlob(v) : null);

            const meta = { nameHint: String(v?.name || "upload.bin"), type: String(v?.type || "") };
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
      if (isIgnoredUrl(url)) return _send.apply(this, arguments);

      if (body instanceof FormData || isFileLike(body)) {
        console.log("[sentinel] XHR(send/upload) =>", {
          method: this.__sentinel_method,
          url,
          kind: body instanceof FormData ? "FormData" : (body instanceof Blob ? "Blob" : "File"),
          size: body?.size,
          type: body?.type,
        });
      }

      // FormData
      if (body instanceof FormData) {
        const hit = findFirstFileLikeInFormData(body);
        if (!hit) return _send.apply(this, arguments);

        const v = hit.value;

        const pendingP =
          (v instanceof File ? getPendingDecisionForFile(v) : null) ||
          (v instanceof Blob ? getPendingDecisionForBlob(v) : null);

        const meta = { nameHint: String(v?.name || "upload.bin"), type: String(v?.type || "") };
        const decisionP = pendingP || waitFileDecision(v, meta);

        decisionP
          .then((decision) => {
            if (decision.allow === false) {
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
        const pendingP =
          (body instanceof File ? getPendingDecisionForFile(body) : null) ||
          (body instanceof Blob ? getPendingDecisionForBlob(body) : null);

        const meta = { nameHint: String(body?.name || "upload.bin"), type: String(body?.type || "") };
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
