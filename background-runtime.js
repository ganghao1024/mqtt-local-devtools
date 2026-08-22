(function installBackgroundRuntime(globalObject) {
  "use strict";

  const LOCAL_URL_PATTERNS = Object.freeze([
    "http://localhost/*",
    "https://localhost/*",
    "http://127.0.0.1/*",
    "https://127.0.0.1/*"
  ]);

  function isLocalDevelopmentUrl(value) {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    } catch {
      return false;
    }
  }

  function shouldDeliverEvent({ sourceTabId, sourceUrl, panelTabId, panelUrl }) {
    if (sourceTabId === panelTabId) return true;
    return isLocalDevelopmentUrl(sourceUrl) && isLocalDevelopmentUrl(panelUrl);
  }

  function enrichEventWithTab(event, tab) {
    return {
      ...event,
      sourceTab: {
        id: tab.id,
        title: tab.title || "",
        url: tab.url || event.pageUrl || ""
      }
    };
  }

  const api = Object.freeze({
    LOCAL_URL_PATTERNS,
    enrichEventWithTab,
    isLocalDevelopmentUrl,
    shouldDeliverEvent
  });
  globalObject.__MQTT_LOCAL_DEVTOOLS_BACKGROUND_RUNTIME__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
