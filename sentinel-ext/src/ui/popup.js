// src/ui/popup.js
import { getSettings, setSettings } from "../lib/storage.js";
import { ensureIdentity } from "../lib/identity.js";

const $pcName = document.getElementById("pcName");
const $endpoint = document.getElementById("endpoint");
const $enabled = document.getElementById("enabled");
const $openOptions = document.getElementById("openOptions");

async function render() {
  const s = await getSettings();
  const { pcName } = await ensureIdentity();

  $pcName.textContent = pcName;
  $endpoint.textContent = s.endpointUrl;
  $enabled.checked = !!s.enabled;
}

$enabled.addEventListener("change", async () => {
  await setSettings({ enabled: $enabled.checked });
});

$openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

render();
