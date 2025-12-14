// src/lib/identity.js
import { getSettings, setSettings } from "./storage.js";

// PCName 규칙: "CE-" + uuid 앞 8자리
function makePcNameFromUuid(uuid) {
  const head8 = String(uuid).replace(/-/g, "").slice(0, 8);
  return `CE-${head8}`;
}

export async function ensureIdentity() {
  const s = await getSettings();

  let deviceId = s.deviceId;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
  }

  let pcName = s.pcName;
  if (!pcName) {
    pcName = makePcNameFromUuid(deviceId);
  }

  // PCName은 한 PC에서 항상 동일하게 유지
  await setSettings({ deviceId, pcName });

  return { deviceId, pcName };
}
