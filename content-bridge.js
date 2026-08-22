(function installContentBridge() {
  "use strict";

  const MARKER = "__MQTT_LOCAL_DEVTOOLS_EVENT_V1__";
  const BRIDGE_MARKER = "__MQTT_LOCAL_DEVTOOLS_BRIDGE_V1__";
  const MAX_BUFFERED_EVENTS = 5000;
  const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
  const ringBufferApi = globalThis.__MQTT_LOCAL_DEVTOOLS_RING_BUFFER__;
  const events = ringBufferApi.createBoundedRingBuffer({
    maxItems: MAX_BUFFERED_EVENTS,
    maxBytes: MAX_BUFFERED_BYTES
  });
  const eventBatcher = globalThis.__MQTT_LOCAL_DEVTOOLS_EVENT_BATCHER__;

  function isValidEvent(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      typeof value.kind === "string" &&
      typeof value.timestamp === "number"
    );
  }

  const batcher = eventBatcher.createEventBatcher((batch) => {
    try {
      chrome.runtime.sendMessage({ type: "MQTT_MONITOR_EVENTS", events: batch }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Extension reloads can invalidate an already injected content script.
    }
  }, { maxBatchSize: 100 });

  window.addEventListener("message", (messageEvent) => {
    if (messageEvent.source !== window || messageEvent.data?.marker !== MARKER) return;
    const event = messageEvent.data.event;
    if (!isValidEvent(event)) return;

    events.append(event);

    batcher.queue(event);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "MQTT_MONITOR_GET_SNAPSHOT") {
      sendResponse({
        events: events.toArray(),
        bufferedBytes: events.totalBytes,
        maxBufferedBytes: MAX_BUFFERED_BYTES
      });
      return false;
    }
    if (message?.type === "MQTT_MONITOR_PING") {
      sendResponse({ installed: true, bufferedEvents: events.length });
      return false;
    }
    return false;
  });

  window.postMessage({ marker: BRIDGE_MARKER, command: "bridge-ready" }, "*");
})();
