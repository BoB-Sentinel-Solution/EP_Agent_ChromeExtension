// src/ui/options.js
import { getSettings, setSettings } from "../lib/storage.js";
import { ensureIdentity } from "../lib/identity.js";

const $pcName = document.getElementById("pcName");
const $endpointUrl = document.getElementById("endpointUrl");
const $enabled = document.getElementById("enabled");
const $save = document.getElementById("save");
const $status = document.getElementById("status");

function isValidUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
}

async function load() {
  const s = await getSettings();
  const { pcName } = await ensureIdentity();

  $pcName.textContent = pcName;
  $endpointUrl.value = s.endpointUrl;
  $enabled.checked = !!s.enabled;
}

$save.addEventListener("click", async () => {
  const endpointUrl = $endpointUrl.value.trim();

  if (!isValidUrl(endpointUrl)) {
    $status.textContent = "Invalid URL";
    return;
  }

  await setSettings({
    endpointUrl,
    enabled: $enabled.checked
  });

  $status.textContent = "Saved";
  setTimeout(() => ($status.textContent = ""), 1200);
});

load();
