// src/lib/schema.js
import { nowKstIsoMicro } from "./time_kst.js";

/**
 * 서버로 보내는 JSON 규격(고정):
 * {
 *  time, public_ip, private_ip, host, PCName, prompt,
 *  attachment: { format, data },
 *  interface: "llm"
 * }
 */
export function buildLogPayload({ host, pcName, prompt }) {
  // “확장에서 못 채우는 필드들” placeholder:
  // - public_ip/private_ip 는 PCName과 동일 문자열 사용(오탐 방지 + 규격 유지)
  const placeholderIp = pcName;

  return {
    time: nowKstIsoMicro(),
    public_ip: placeholderIp,
    private_ip: placeholderIp,
    host: host,
    PCName: pcName,
    prompt: prompt,
    attachment: {
      format: null,
      data: null
    },
    interface: "llm"
  };
}
