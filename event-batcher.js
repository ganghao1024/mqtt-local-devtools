(function installEventBatcher(globalObject) {
  "use strict";

  function createEventBatcher(send, options = {}) {
    const maxBatchSize = options.maxBatchSize ?? 100;
    const intervalMs = options.intervalMs ?? 16;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const pending = [];
    let timerId = null;

    function flush() {
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
      if (!pending.length) return;
      send(pending.splice(0, pending.length));
    }

    function queue(event) {
      pending.push(event);
      if (pending.length >= maxBatchSize) {
        flush();
        return;
      }
      if (timerId === null) timerId = setTimer(flush, intervalMs);
    }

    return Object.freeze({ queue, flush, size: () => pending.length });
  }

  const api = Object.freeze({ createEventBatcher });
  globalObject.__MQTT_LOCAL_DEVTOOLS_EVENT_BATCHER__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
