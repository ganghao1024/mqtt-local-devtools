"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("content bridge applies count and total-byte limits while accepting new events", () => {
  const listeners = {};
  let runtimeListener;
  const window = {
    addEventListener(type, listener) { listeners[type] = listener; },
    postMessage() {}
  };
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) { callback?.(); },
      onMessage: { addListener(listener) { runtimeListener = listener; } }
    }
  };
  const context = {
    chrome,
    window,
    __MQTT_LOCAL_DEVTOOLS_EVENT_BATCHER__: {
      createEventBatcher() { return { queue() {} }; }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../ring-buffer.js"), "utf8"),
    context
  );
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../content-bridge.js"), "utf8"),
    context
  );

  for (let index = 1; index <= 5001; index += 1) {
    listeners.message({
      source: window,
      data: {
        marker: "__MQTT_LOCAL_DEVTOOLS_EVENT_V1__",
        event: { id: "event-" + index, kind: "packet", timestamp: index }
      }
    });
  }

  let snapshot;
  runtimeListener(
    { type: "MQTT_MONITOR_GET_SNAPSHOT" },
    null,
    (response) => { snapshot = response; }
  );
  assert.equal(snapshot.events.length, 5000);
  assert.equal(snapshot.events[0].id, "event-2");
  assert.equal(snapshot.events.at(-1).id, "event-5001");

  for (let index = 1; index <= 40; index += 1) {
    listeners.message({
      source: window,
      data: {
        marker: "__MQTT_LOCAL_DEVTOOLS_EVENT_V1__",
        event: {
          id: "large-" + index,
          kind: "packet",
          timestamp: 6000 + index,
          packet: { payloadText: "x".repeat(1_000_000) }
        }
      }
    });
  }
  runtimeListener(
    { type: "MQTT_MONITOR_GET_SNAPSHOT" },
    null,
    (response) => { snapshot = response; }
  );
  assert.ok(snapshot.events.length < 5000);
  assert.ok(snapshot.bufferedBytes <= snapshot.maxBufferedBytes);
  assert.equal(snapshot.events.at(-1).id, "large-40");
});
