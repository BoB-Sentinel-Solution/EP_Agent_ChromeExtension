// src/content/utils/file_codec.js
(() => {
  const FT = window.__SENTINEL_FILE_TYPES;

  function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error || new Error("FileReader error"));
      r.onload = () => resolve(String(r.result || ""));
      r.readAsDataURL(blob);
    });
  }

  // ✅ File 또는 Blob 모두 허용
  async function fileToAttachment(input) {
    // Blob도 허용 (File은 Blob의 하위 타입)
    if (!(input instanceof Blob)) {
      throw new Error("fileToAttachment: input is not File/Blob");
    }

    // -------------------------
    // format 추정
    //  1) File이면 name 기반 우선
    //  2) Blob이면 mime 기반
    // -------------------------
    let format = null;

    const isFile = (typeof File !== "undefined") && (input instanceof File);
    const name = isFile ? String(input.name || "") : "";

    if (isFile && name) {
      format = FT.getFormatFromFileName(name);
    }

    // name 기반으로 못 구했으면 mime 기반
    if (!format) {
      const mime = FT.normalizeMime ? FT.normalizeMime(input.type) : String(input.type || "");
      format = FT.getFormatFromMimeType ? FT.getFormatFromMimeType(mime) : null;
    }

    if (!FT.isSupportedFormat(format)) {
      return null;
    }

    const dataUrl = await readAsDataURL(input);
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";

    // size: Blob도 size 속성 있음
    return {
      format,
      data: base64,
      size: (input.size >>> 0),
    };
  }

  function base64ToUint8(base64) {
    const bin = atob(String(base64 || ""));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function attachmentToFile(attachment, nameHint) {
    if (!attachment || !attachment.data || !attachment.format) {
      throw new Error("attachmentToFile: invalid attachment");
    }

    const format = String(attachment.format).toLowerCase();
    const mime = FT.guessMime(format);

    // nameHint가 "a.png"면 확장자 유지/교체
    let filename = String(nameHint || `sentinel.${format}`);
    if (!filename.includes(".")) filename = `${filename}.${format}`;

    // 확장자가 다른 경우 format 기준으로 맞춰줌
    const dot = filename.lastIndexOf(".");
    if (dot > 0) {
      filename = filename.slice(0, dot) + "." + format;
    }

    const u8 = base64ToUint8(attachment.data);
    const blob = new Blob([u8], { type: mime });

    return new File([blob], filename, { type: mime, lastModified: Date.now() });
  }

  window.__SENTINEL_FILE_CODEC = {
    fileToAttachment,
    attachmentToFile,
  };
})();
