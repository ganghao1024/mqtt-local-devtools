(function installRingBuffer(globalObject) {
  "use strict";

  const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

  function serializedByteLength(value) {
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value ?? "");
    }
    if (encoder) return encoder.encode(text).byteLength;
    if (typeof Buffer !== "undefined") return Buffer.byteLength(text, "utf8");
    return unescape(encodeURIComponent(text)).length;
  }

  function createBoundedRingBuffer(options = {}) {
    const maxItems = Math.max(1, Math.floor(Number(options.maxItems) || 1));
    const maxBytes = Math.max(1, Math.floor(Number(options.maxBytes) || Number.MAX_SAFE_INTEGER));
    const sizeOf = options.sizeOf || serializedByteLength;
    const slots = new Array(maxItems);
    const sizes = new Array(maxItems).fill(0);
    let head = 0;
    let length = 0;
    let totalBytes = 0;

    function at(index) {
      if (index < 0 || index >= length) return undefined;
      return slots[(head + index) % maxItems];
    }

    function shift() {
      if (!length) return undefined;
      const index = head;
      const value = slots[index];
      totalBytes -= sizes[index];
      slots[index] = undefined;
      sizes[index] = 0;
      head = (head + 1) % maxItems;
      length -= 1;
      if (!length) head = 0;
      return value;
    }

    function append(value, knownByteSize) {
      const byteSize = Math.max(0, Math.floor(Number(knownByteSize ?? sizeOf(value)) || 0));
      const removed = [];
      while (length && (length >= maxItems || totalBytes + byteSize > maxBytes)) {
        removed.push(shift());
      }

      // A single diagnostic event may exceed the byte budget. Keep the newest
      // event so the monitor remains useful, while still evicting all older data.
      const tail = (head + length) % maxItems;
      slots[tail] = value;
      sizes[tail] = byteSize;
      length += 1;
      totalBytes += byteSize;
      return removed;
    }

    function clear() {
      while (length) shift();
    }

    function toArray() {
      return Array.from({ length }, (_, index) => at(index));
    }

    function removeWhere(predicate) {
      const kept = [];
      const removed = [];
      for (let index = 0; index < length; index += 1) {
        const value = at(index);
        if (predicate(value, index)) removed.push(value);
        else kept.push({ value, size: sizes[(head + index) % maxItems] });
      }
      clear();
      for (const item of kept) append(item.value, item.size);
      return removed;
    }

    return Object.freeze({
      append,
      at,
      clear,
      removeWhere,
      shift,
      toArray,
      get length() { return length; },
      get totalBytes() { return totalBytes; },
      get maxItems() { return maxItems; },
      get maxBytes() { return maxBytes; }
    });
  }

  const api = Object.freeze({ createBoundedRingBuffer, serializedByteLength });
  globalObject.__MQTT_LOCAL_DEVTOOLS_RING_BUFFER__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
