// src/content/file_hook_main.js
(() => {
  // ✅ 중복 로드/중복 래핑 방지
  if (window.__SENTINEL_FILE_HOOK_MAIN_INSTALLED) {
    // 같은 페이지에서 inject가 2번 돌면 wrapper가 중복 설치될 수 있음
    console.log("[sentinel] file_hook_main: already installed, skip");
    return;
  }
  window.__SENTINEL_FILE_HOOK_MAIN_INSTALLED = true;

  console.log("[sentinel] file_hook_main (network wrapper) loaded");

  let seq = 0;

  function waitFileDecision(file, timeoutMs = 15000) {
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

      // ⚠️ isolated world에서 instanceof File이 실패할 수 있어서
      // file_hook.js 쪽은 duck-typing으로 받는게 가장 안전함.
      window.postMessage({ type: "SENTINEL_FILE_HOOK", id, file }, "*");
    });
  }

  function findFirstFileInFormData(fd) {
    try {
      for (const [key, val] of fd.entries()) {
        if (val instanceof File) return { key, file: val };
      }
    } catch {}
    return null;
  }

  function replaceFirstFileInFormData(fd, newFile) {
    const hit = findFirstFileInFormData(fd);
    if (!hit) return fd;

    const out = new FormData();
    for (const [k, v] of fd.entries()) {
      if (k === hit.key && v instanceof File) {
        out.append(k, newFile, newFile.name);
      } else {
        out.append(k, v);
      }
    }
    return out;
  }

  // ✅ Request 객체로 들어온 업로드를 처리 (Gemini에서 자주 나오는 패턴)
  function tryHandleRequestBodyAsFormData(req) {
    try {
      // Body는 한번 읽으면 소모되므로 clone() 사용
      if (!(req instanceof Request)) return null;
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") return null;

      // formData()는 multipart/form-data / urlencoded 등에만 의미가 있음
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
      const body = init && init.body;

      // FormData에 File이 있으면 사전검사
      if (body instanceof FormData) {
        const hit = findFirstFileInFormData(body);
        if (!hit) return _fetch.apply(this, arguments);

        console.log("[sentinel] fetch upload detected:", hit.file?.name, hit.file?.size);

        return waitFileDecision(hit.file).then((decision) => {
          if (decision.allow === false) {
            console.log("[sentinel] fetch upload BLOCKED by policy");
            throw new Error("blocked_by_policy");
          }

          if (decision.file_change && decision.newFile instanceof File) {
            const newBody = replaceFirstFileInFormData(body, decision.newFile);
            const newInit = { ...(init || {}), body: newBody };
            console.log("[sentinel] fetch upload REPLACED:", decision.newFile.name, decision.newFile.size);
            return _fetch.call(this, input, newInit);
          }

          return _fetch.apply(this, arguments);
        });
      }

      // 단일 File 업로드
      if (body instanceof File) {
        console.log("[sentinel] fetch file detected:", body.name, body.size);

        return waitFileDecision(body).then((decision) => {
          if (decision.allow === false) {
            throw new Error("blocked_by_policy");
          }

          if (decision.file_change && decision.newFile instanceof File) {
            const newInit = { ...(init || {}), body: decision.newFile };
            console.log("[sentinel] fetch file REPLACED:", decision.newFile.name, decision.newFile.size);
            return _fetch.call(this, input, newInit);
          }

          return _fetch.apply(this, arguments);
        });
      }

      // ✅ (추가) fetch(new Request(...)) 패턴 대응
      // init.body가 없고 input이 Request면, Request의 body를 formData()로 꺼내서 검사
      if (!body && input instanceof Request) {
        const p = tryHandleRequestBodyAsFormData(input);
        if (p) {
          return p.then((r) => {
            if (!r || !r.ok || !(r.fd instanceof FormData)) return _fetch.apply(this, arguments);

            const hit = findFirstFileInFormData(r.fd);
            if (!hit) return _fetch.apply(this, arguments);

            console.log("[sentinel] fetch(Request) upload detected:", hit.file?.name, hit.file?.size);

            return waitFileDecision(hit.file).then((decision) => {
              if (decision.allow === false) {
                console.log("[sentinel] fetch(Request) upload BLOCKED by policy");
                throw new Error("blocked_by_policy");
              }

              if (decision.file_change && decision.newFile instanceof File) {
                const newFd = replaceFirstFileInFormData(r.fd, decision.newFile);
                // Request를 새로 만들어 body 교체
                const newReq = new Request(input, { body: newFd });
                console.log("[sentinel] fetch(Request) upload REPLACED:", decision.newFile.name, decision.newFile.size);
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

  // ✅ async로 바꾸지 않고 Promise 체인으로 처리 (호환성 ↑)
  XHR.prototype.send = function (body) {
    try {
      // FormData
      if (body instanceof FormData) {
        const hit = findFirstFileInFormData(body);
        if (!hit) return _send.apply(this, arguments);

        console.log("[sentinel] XHR upload detected:", hit.file?.name, hit.file?.size);

        waitFileDecision(hit.file)
          .then((decision) => {
            if (decision.allow === false) {
              console.log("[sentinel] XHR upload BLOCKED by policy");
              try { this.abort(); } catch {}
              return;
            }

            if (decision.file_change && decision.newFile instanceof File) {
              const newBody = replaceFirstFileInFormData(body, decision.newFile);
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

        // send는 원래 void -> 여기서도 즉시 리턴
        return;
      }

      // 단일 File
      if (body instanceof File) {
        console.log("[sentinel] XHR file detected:", body.name, body.size);

        waitFileDecision(body)
          .then((decision) => {
            if (decision.allow === false) {
              try { this.abort(); } catch {}
              return;
            }

            if (decision.file_change && decision.newFile instanceof File) {
              console.log("[sentinel] XHR file REPLACED:", decision.newFile.name, decision.newFile.size);
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
