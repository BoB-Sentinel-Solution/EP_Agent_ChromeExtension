// src/content/utils/file_codec.js
(() => {
  const FT = window.SentinelFileTypes;

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

  async function fileToAttachment(file) {
    if (!(file instanceof File)) {
      throw new Error("fileToAttachment: input is not File");
    }

    const format = FT.normalizeExt(FT.extFromFilename(file.name)) || FT.normalizeExt(file.type.split("/")[1] || "");
    if (!FT.isAllowedExt(format)) {
      throw new Error(`fileToAttachment: unsupported format: ${format}`);
    }

    const buf = await file.arrayBuffer();
    return {
      format,
      data: arrayBufferToBase64(buf),
      size: file.size >>> 0,
    };
  }

  function attachmentToFile(attachment, originalName) {
    if (!attachment || !attachment.data || !attachment.format) {
      throw new Error("attachmentToFile: invalid attachment");
    }

    const format = FT.normalizeExt(attachment.format);
    const mime = FT.mimeFromExt(format);
    const name = FT.ensureFilenameWithExt(originalName || "file", format);

    const buf = base64ToArrayBuffer(attachment.data);
    const blob = new Blob([buf], { type: mime });

    // NOTE: size(bytes)는 blob.size로 결정되므로, 서버 size와 다를 경우 서버쪽 검증이 필요함
    return new File([blob], name, { type: mime, lastModified: Date.now() });
  }

  window.SentinelFileCodec = {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    fileToAttachment,
    attachmentToFile,
  };
})();
