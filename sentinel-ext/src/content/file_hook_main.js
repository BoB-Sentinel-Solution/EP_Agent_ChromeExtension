// src/content/file_hook_main.js
(() => {
  console.log("[sentinel] file_hook_main (network wrapper) loaded");

  let seq = 0;

  function waitFileDecision(file, timeoutMs = 15000) {
    const id = `${Date.now()}-${++seq}`;

    return new Promise((resolve) => {
      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMsg);
        resolve({ id, allow: true, fail_open: true, reason: "timeout" });
      }, timeoutMs);

      function onMsg(ev) {
        if (ev.source !== window) return;
        const msg = ev.data;
        if (!msg || msg.type !== "SENTINEL_FILE_RESULT" || msg.id !== id) return;

        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve(msg);
      }

      window.addEventListener("message", onMsg, true);
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

  // -------------------------
  // fetch wrapper
  // -------------------------
  const _fetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const body = init && init.body;

      // FormData에 File이 있으면 사전검사
      if (body instanceof FormData) {
        const hit = findFirstFileInFormData(body);
        if (!hit) return _fetch.apply(this, arguments);

        console.log("[sentinel] fetch upload detected:", hit.file?.name, hit.file?.size);

        const decision = await waitFileDecision(hit.file);
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
      }

      // 단일 File/Blob 업로드
      if (body instanceof File) {
        console.log("[sentinel] fetch file detected:", body.name, body.size);

        const decision = await waitFileDecision(body);
        if (decision.allow === false) throw new Error("blocked_by_policy");

        if (decision.file_change && decision.newFile instanceof File) {
          const newInit = { ...(init || {}), body: decision.newFile };
          console.log("[sentinel] fetch file REPLACED:", decision.newFile.name, decision.newFile.size);
          return _fetch.call(this, input, newInit);
        }

        return _fetch.apply(this, arguments);
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

  XHR.prototype.send = async function (body) {
    try {
      if (body instanceof FormData) {
        const hit = findFirstFileInFormData(body);
        if (!hit) return _send.apply(this, arguments);

        console.log("[sentinel] XHR upload detected:", hit.file?.name, hit.file?.size);

        const decision = await waitFileDecision(hit.file);
        if (decision.allow === false) {
          console.log("[sentinel] XHR upload BLOCKED by policy");
          // abort + throw는 UI에 영향. 일단 abort로 끊음.
          try { this.abort(); } catch {}
          throw new Error("blocked_by_policy");
        }

        if (decision.file_change && decision.newFile instanceof File) {
          const newBody = replaceFirstFileInFormData(body, decision.newFile);
          console.log("[sentinel] XHR upload REPLACED:", decision.newFile.name, decision.newFile.size);
          return _send.call(this, newBody);
        }

        return _send.apply(this, arguments);
      }

      if (body instanceof File) {
        console.log("[sentinel] XHR file detected:", body.name, body.size);

        const decision = await waitFileDecision(body);
        if (decision.allow === false) {
          try { this.abort(); } catch {}
          throw new Error("blocked_by_policy");
        }

        if (decision.file_change && decision.newFile instanceof File) {
          console.log("[sentinel] XHR file REPLACED:", decision.newFile.name, decision.newFile.size);
          return _send.call(this, decision.newFile);
        }

        return _send.apply(this, arguments);
      }

      return _send.apply(this, arguments);
    } catch (e) {
      throw e;
    }
  };

  console.log("[sentinel] file_hook_main: XHR wrapper installed");
})();
