// src/lib/storage.js

// sw.js / inject.js 와 동일 키로 맞춤
const STORAGE_KEYS = {
  enabled: "sentinel_enabled",
  endpointUrl: "sentinel_endpoint_url",
  pcName: "sentinel_pc_name",
  uuid: "sentinel_uuid",
};

const DEFAULT_ENDPOINT = "https://bobsentinel.com/api/logs";

export async function getSettings() {
  // legacy(UI가 예전에 쓰던 키)도 같이 읽어서 자동 마이그레이션
  const got = await chrome.storage.local.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.endpointUrl,
    STORAGE_KEYS.uuid,
    STORAGE_KEYS.pcName,

    // legacy keys
    "enabled",
    "endpointUrl",
    "deviceId",
    "pcName",
  ]);

  const enabled =
    got[STORAGE_KEYS.enabled] !== undefined
      ? got[STORAGE_KEYS.enabled]
      : (got.enabled !== undefined ? got.enabled : true);

  const endpointUrl =
    got[STORAGE_KEYS.endpointUrl] ||
    got.endpointUrl ||
    DEFAULT_ENDPOINT;

  const uuid =
    got[STORAGE_KEYS.uuid] ||
    got.deviceId ||
    null;

  const pcName =
    got[STORAGE_KEYS.pcName] ||
    got.pcName ||
    null;

  // sentinel 키가 비어있고 legacy 값이 있으면 한 번 저장(마이그레이션)
  const needMigrate =
    !got[STORAGE_KEYS.endpointUrl] &&
    (got.endpointUrl || got.enabled !== undefined || got.deviceId || got.pcName);

  if (needMigrate) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.enabled]: enabled,
      [STORAGE_KEYS.endpointUrl]: endpointUrl,
      ...(uuid ? { [STORAGE_KEYS.uuid]: uuid } : {}),
      ...(pcName ? { [STORAGE_KEYS.pcName]: pcName } : {}),
    });
  }

  // UI에서는 기존 인터페이스 유지
  return { endpointUrl, enabled, uuid, pcName };
}

export async function setSettings(patch) {
  // ✅ 최소 수정: sentinel_* 저장 + legacy 키도 같이 저장해서 UI/팝업/기존 코드와 호환 유지
  const out = {};

  if (patch.enabled !== undefined) {
    const v = !!patch.enabled;
    out[STORAGE_KEYS.enabled] = v;
    out.enabled = v; // legacy
  }

  if (patch.endpointUrl !== undefined) {
    const v = String(patch.endpointUrl);
    out[STORAGE_KEYS.endpointUrl] = v;
    out.endpointUrl = v; // legacy
  }

  // UI에서 uuid/pcName을 patch로 넘길 수도 있으니 둘 다 동기화
  if (patch.uuid !== undefined) {
    out[STORAGE_KEYS.uuid] = patch.uuid;
    out.deviceId = patch.uuid; // legacy
  }

  if (patch.pcName !== undefined) {
    out[STORAGE_KEYS.pcName] = patch.pcName;
    out.pcName = patch.pcName; // legacy
  }

  await chrome.storage.local.set(out);
}

export async function getValue(key) {
  // 필요하면 확장: 현재는 UI에서 거의 안 씀
  const s = await getSettings();
  return s[key];
}

export async function setValue(key, value) {
  return setSettings({ [key]: value });
}
