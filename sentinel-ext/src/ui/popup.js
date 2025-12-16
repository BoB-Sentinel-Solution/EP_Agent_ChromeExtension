// src/ui/popup.js
import { getSettings } from "../lib/storage.js";
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

  // ✅ 팝업은 표시 전용 (변경은 Options에서)
  $enabled.disabled = true;
}

$openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

render();
