// Browser-only adapter for the real panel; no live MQTT broker is contacted.
(() => {
  const listeners = [];
  const disconnectListeners = [];
  window.mqttHarness = {
    emit(events) { listeners.forEach(listener => listener({ type: "MQTT_MONITOR_EVENTS", events })); },
    disconnect() { disconnectListeners.forEach(listener => listener()); }
  };
  window.__MQTT_MONITOR_TEST_API__ = {
    devtools: { inspectedWindow: { tabId: 1 } },
    runtime: {
      getManifest: () => ({ version: "0.8.6" }),
      connect: () => ({ postMessage() {}, onMessage: { addListener: listener => listeners.push(listener) },
        onDisconnect: { addListener: listener => disconnectListeners.push(listener) } }),
      sendMessage(_message, callback) { callback({ events: [] }); }
    }
  };
})();
