// src/lib/storage.js
const DEFAULTS = {
  endpointUrl: "https://bobsentinel.com/api/logs",
  enabled: true,
  deviceId: null,
  pcName: null
};

export async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...data };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

export async function getValue(key) {
  const obj = await chrome.storage.local.get({ [key]: DEFAULTS[key] });
  return obj[key];
}

export async function setValue(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
