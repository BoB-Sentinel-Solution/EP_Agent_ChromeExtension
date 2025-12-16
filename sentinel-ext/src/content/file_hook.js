// src/content/file_hook.js
(() => {
  const SENTINEL_FLAG = "__sentinel";
  const REQ_TYPE = "SENTINEL_REDACT_FILE";
  const RES_TYPE = "SENTINEL_REDACT_FILE_RESULT";

  // inject.js와 동일 키 유지
  const STORAGE_KEYS = {
    enabled: "sentinel_enabled",
    endpointUrl: "sentinel_endpoint_url",
    pcName: "sentinel_pc_name",
    uuid: "sentinel_uuid",
  };

  const DEFAULT_ENDPOINT = "https://bobsentinel.com/api/logs";

  async function getSettings() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.enabled,
      STORAGE_KEYS.endpointUrl,
      STORAGE_KEYS.pcName,
      STORAGE_KEYS.uuid,
    ]);

    return {
      enabled: data[STORAGE_KEYS.enabled] !== false,
      endpointUrl: data[STORAGE_KEYS.endpointUrl] || DEFAULT_ENDPOINT,
      pcName: data[STORAGE_KEYS.pcName] || "",
      uuid: data[STORAGE_KEYS.uuid] || "",
    };
  }

  function shouldBlockByServerResponse(serverJson) {
    if (!serverJson) return false;
    if (serverJson.allow === false) return true;
    if (serverJson.file_blocked === true) return true;
    if (serverJson.action && String(serverJson.action).toLowerCase().includes("block")) return true;
    return false;
  }

  function extractReplaceAttachment(serverJson) {
    const att = serverJson && serverJson.attachment;
    if (!att) return null;
    if (att.file_change !== true) return null;
    if (!att.data || !att.format) return null;
    return att;
  }

  async function callServerForFileRedact(payload) {
    // SW로 위임 (CORS/토큰/timeout 한곳 관리)
    const res = await chrome.runtime.sendMessage({
      type: "SENTINEL_REDACT_FILE",
      payload,
    });

    // res: { ok, status, data }
    return res;
  }

  window.addEventListener("message", (ev) => {
    const msg = ev && ev.data;
    if (!msg || msg[SENTINEL_FLAG] !== true) return;
    if (msg.type !== REQ_TYPE) return;

    (async () => {
      const requestId = msg.request_id;

      try {
        const settings = await getSettings();
        if (!settings.enabled) {
          window.postMessage({
            [SENTINEL_FLAG]: true,
            type: RES_TYPE,
            request_id: requestId,
            ok: true,
            block: false,
            replace: false,
          }, "*");
          return;
        }

        // 서버 스키마 "최소한" 맞추기 (기존대로 object 1개)
        const payload = {
          request_id: requestId,
          time: new Date().toISOString(),
          host: msg.host || location.host,
          pc_name: settings.pcName,
          uuid: settings.uuid,

          // 파일 업로드 훅은 프롬프트를 모를 수 있음: 서버가 허용하면 됨
          prompt: "",

          attachment: {
            format: msg.attachment.format,
            data: msg.attachment.data,
            size: msg.attachment.size,
          },
        };

        const { ok, data } = await callServerForFileRedact(payload);

        if (!ok) {
          // fail-open
          window.postMessage({
            [SENTINEL_FLAG]: true,
            type: RES_TYPE,
            request_id: requestId,
            ok: false,
          }, "*");
          return;
        }

        if (shouldBlockByServerResponse(data)) {
          window.postMessage({
            [SENTINEL_FLAG]: true,
            type: RES_TYPE,
            request_id: requestId,
            ok: true,
            block: true,
            replace: false,
          }, "*");
          return;
        }

        const replaceAtt = extractReplaceAttachment(data);
        if (replaceAtt) {
          window.postMessage({
            [SENTINEL_FLAG]: true,
            type: RES_TYPE,
            request_id: requestId,
            ok: true,
            block: false,
            replace: true,
            attachment: {
              format: replaceAtt.format,
              data: replaceAtt.data,
              size: replaceAtt.size,
              file_change: true,
            },
          }, "*");
          return;
        }

        // 교체 없음
        window.postMessage({
          [SENTINEL_FLAG]: true,
          type: RES_TYPE,
          request_id: requestId,
          ok: true,
          block: false,
          replace: false,
        }, "*");
      } catch (e) {
        // fail-open
        window.postMessage({
          [SENTINEL_FLAG]: true,
          type: RES_TYPE,
          request_id: requestId,
          ok: false,
          error: String(e && e.message ? e.message : e),
        }, "*");
      }
    })();
  });

  console.log("[sentinel] file_hook (isolated) loaded");
})();
