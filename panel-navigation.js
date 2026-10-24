(function installModuleNavigation() {
  "use strict";
  const modules = ["mqtt", "http", "analysis"];
  const storageKey = "mqtt-local-devtools-active-module";
  function activate(value, options = {}) {
    const module = modules.includes(value) ? value : "mqtt";
    document.body.dataset.activeModule = module;
    for (const name of modules) {
      const button = document.getElementById(name + "ModuleButton");
      button?.classList.toggle("selected", name === module);
      button?.setAttribute("aria-selected", String(name === module));
      document.getElementById(name + "Workspace")?.classList.toggle("hidden", name !== module);
      document.getElementById(name + "FooterStatus")?.classList.toggle("hidden", name !== module);
    }
    document.getElementById("mqttHeaderActions")?.classList.toggle("hidden", module !== "mqtt");
    document.getElementById("packetCount")?.classList.toggle("hidden", module !== "mqtt");
    document.querySelector(".shortcuts")?.classList.toggle("hidden", module !== "mqtt");
    if (module === "mqtt") globalThis.__MQTT_PANEL_ANALYSIS_SOURCE__?.refreshRows();
    if (options.persist !== false) {
      try { localStorage.setItem(storageKey, module); } catch { /* Navigation still works for this session. */ }
    }
    document.dispatchEvent(new CustomEvent("mqtt-modulechange", { detail: { module, focus: options.focus !== false } }));
  }
  for (const name of modules) document.getElementById(name + "ModuleButton")?.addEventListener("click", () => activate(name));
  globalThis.__MQTT_PANEL_MODULES__ = Object.freeze({ activate });
  let initial = "mqtt";
  try { initial = localStorage.getItem(storageKey) || initial; } catch { /* Use default. */ }
  activate(initial, { persist: false, focus: false });
})();
