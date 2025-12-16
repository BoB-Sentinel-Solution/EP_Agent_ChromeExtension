// src/content/utils/file_codec.js
//
// 역할
// 1) File -> { format, data(base64), size(bytes) } 변환
// 2) 서버 응답 attachment { format, data, size, file_change } -> File 재생성
//
// 주의
// - "format"은 확장자 기반 (png/jpg/jpeg/webp/pdf/docx/pptx/csv/txt/xlsx)
// - 허용 확장자만 처리하고 나머지는 null/에러 처리 (호출부에서 무시)
// - base64는 "data:" prefix 없는 순수 base64 문자열

import {
  ALLOWED_EXT_SET,
  getFileExt,
  isAllowedExt,
  isAllowedFile,
  fileToBase64,
  base64ToFile,
  ensureExt,
  guessMimeByExt,
} from "./file_types.js";

/** @typedef {{format:string, data:string, size:number}} EncodedAttachment */
/** @typedef {{format?:string, data?:string, size?:number, file_change?:boolean}} ServerAttachment */

const MIME_TO_EXT = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
});

/**
 * jpeg -> jpg 로 정규화, 나머지는 소문자 유지
 */
export function normalizeFormat(format) {
  const f = String(format || "").trim().toLowerCase();
  if (!f) return "";
  if (f === "jpeg") return "jpg";
  return f;
}

/**
 * File에서 format(ext)을 결정
 * - 우선순위: filename ext -> mime -> ""
 */
export function detectFormatFromFile(file) {
  if (!file) return "";
  const byName = normalizeFormat(getFileExt(file.name || ""));
  if (byName) return byName;

  const byMime = normalizeFormat(MIME_TO_EXT[String(file.type || "").toLowerCase()] || "");
  if (byMime) return byMime;

  return "";
}

/**
 * base64 문자열을 Uint8Array로 변환
 * (attachment.size 검증 및 파일 재생성용)
 */
export function base64ToBytes(b64) {
  const s = String(b64 || "");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * File -> { format, data(base64), size(bytes) }
 * - 허용 확장자가 아니면 null 반환 (호출부에서 "무시" 처리하기 쉬움)
 * - 배열로 보내지 않는 정책: "단일 attachment"만 만들 때 사용
 *
 * @param {File} file
 * @returns {Promise<EncodedAttachment|null>}
 */
export async function encodeFileToAttachment(file) {
  if (!file) return null;

  // 확장자/타입 판단
  const format = detectFormatFromFile(file);
  if (!isAllowedExt(format)) return null;

  // 이름 기반 허용 체크(확장자 없던 파일이라면 format 기반으로만 체크)
  if (file.name && getFileExt(file.name) && !isAllowedFile(file)) return null;

  const data = await fileToBase64(file);
  const size = Number(file.size || 0);

  // FileReader 실패/빈 데이터 방어
  if (!data) {
    throw new Error("encodeFileToAttachment: base64 data is empty");
  }

  return { format, data, size };
}

/**
 * 서버 attachment가 "파일 교체"를 요구하는지
 */
export function shouldReplaceFile(serverAttachment) {
  return !!(serverAttachment && serverAttachment.file_change === true);
}

/**
 * 서버 응답 attachment -> File 재생성
 *
 * @param {ServerAttachment} attachment
 * @param {string} [preferredName] - 원본 파일명 유지하고 싶을 때 전달 (확장자는 format으로 강제)
 * @returns {File|null}
 */
export function attachmentToFile(attachment, preferredName) {
  if (!attachment) return null;

  const format = normalizeFormat(attachment.format);
  const data = String(attachment.data || "");
  const declaredSize = attachment.size;

  if (!format || !isAllowedExt(format)) return null;
  if (!data) return null;

  // 파일명 결정
  const baseName =
    preferredName && String(preferredName).trim()
      ? String(preferredName).trim()
      : `sentinel_attachment.${format}`;

  const filename = ensureExt(baseName, format);

  // 생성
  const file = base64ToFile(data, format, filename);

  // (선택) size 검증: 서버가 준 size와 실제 재생성 size가 다르면 경고만
  try {
    if (typeof declaredSize === "number" && declaredSize >= 0) {
      const actual = file.size;
      if (actual !== declaredSize) {
        // 확장프로그램 콘솔에서만 확인 가능하도록 warn
        console.warn(
          "[Sentinel] attachment size mismatch:",
          "declared=",
          declaredSize,
          "actual=",
          actual,
          "format=",
          format
        );
      }
    }
  } catch (_) {
    // ignore
  }

  return file;
}

/**
 * attachment payload가 허용 타입인지 빠르게 체크
 */
export function isSupportedServerAttachment(attachment) {
  if (!attachment) return false;
  const format = normalizeFormat(attachment.format);
  return !!format && ALLOWED_EXT_SET.has(format) && !!attachment.data;
}

/**
 * (디버그/보조) attachment의 mime 추정
 */
export function guessMimeFromAttachment(attachment) {
  if (!attachment) return "application/octet-stream";
  const format = normalizeFormat(attachment.format);
  if (!format) return "application/octet-stream";
  return guessMimeByExt(format);
}
