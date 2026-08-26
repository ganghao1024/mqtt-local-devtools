(function installContentBridge() {
  "use strict";

  const MARKER = "__MQTT_LOCAL_DEVTOOLS_EVENT_V1__";
  const BRIDGE_MARKER = "__MQTT_LOCAL_DEVTOOLS_BRIDGE_V1__";
  const REPLAY_LIMITS = Object.freeze({
    standby: Object.freeze({ maxItems: 1000, maxBytes: 8 * 1024 * 1024 }),
    live: Object.freeze({ maxItems: 200, maxBytes: 2 * 1024 * 1024 })
  });
  const ringBufferApi = globalThis.__MQTT_LOCAL_DEVTOOLS_RING_BUFFER__;
  let replayMode = "standby";
  let events = ringBufferApi.createBoundedRingBuffer(REPLAY_LIMITS[replayMode]);
  const eventBatcher = globalThis.__MQTT_LOCAL_DEVTOOLS_EVENT_BATCHER__;

  function replayStatus() {
    return {
      replayMode,
      bufferedEvents: events.length,
      bufferedBytes: events.totalBytes,
      maxBufferedEvents: events.maxItems,
      maxBufferedBytes: events.maxBytes
    };
  }

  function setReplayMode(panelConnected) {
    const nextMode = panelConnected ? "live" : "standby";
    if (nextMode === replayMode) return replayStatus();

    const previousEvents = events.toArray();
    const resized = ringBufferApi.createBoundedRingBuffer(REPLAY_LIMITS[nextMode]);
    for (const event of previousEvents) resized.append(event);
    events = resized;
    replayMode = nextMode;
    return replayStatus();
  }

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
        ...replayStatus()
      });
      return false;
    }
    if (message?.type === "MQTT_MONITOR_SET_REPLAY_MODE") {
      sendResponse(setReplayMode(message.panelConnected === true));
      return false;
    }
    if (message?.type === "MQTT_MONITOR_PING") {
      sendResponse({ installed: true, ...replayStatus() });
      return false;
    }
    return false;
  });

  window.postMessage({ marker: BRIDGE_MARKER, command: "bridge-ready" }, "*");
  try {
    chrome.runtime.sendMessage({ type: "MQTT_MONITOR_BRIDGE_READY" }, (response) => {
      void chrome.runtime.lastError;
      if (typeof response?.panelConnected === "boolean") {
        setReplayMode(response.panelConnected);
      }
    });
  } catch {
    // Extension reloads can invalidate an already injected content script.
  }
})();
