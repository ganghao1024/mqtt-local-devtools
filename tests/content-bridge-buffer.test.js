"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("content bridge uses standby and live replay limits while accepting new events", () => {
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

  for (let index = 1; index <= 1001; index += 1) {
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
  assert.equal(snapshot.events.length, 1000);
  assert.equal(snapshot.events[0].id, "event-2");
  assert.equal(snapshot.events.at(-1).id, "event-1001");
  assert.equal(snapshot.maxBufferedEvents, 1000);
  assert.equal(snapshot.maxBufferedBytes, 8 * 1024 * 1024);
  assert.equal(snapshot.replayMode, "standby");

  let modeResponse;
  runtimeListener(
    { type: "MQTT_MONITOR_SET_REPLAY_MODE", panelConnected: true },
    null,
    (response) => { modeResponse = response; }
  );
  assert.equal(modeResponse.replayMode, "live");
  assert.equal(modeResponse.maxBufferedEvents, 200);
  assert.equal(modeResponse.maxBufferedBytes, 2 * 1024 * 1024);

  runtimeListener(
    { type: "MQTT_MONITOR_GET_SNAPSHOT" },
    null,
    (response) => { snapshot = response; }
  );
  assert.equal(snapshot.events.length, 200);
  assert.equal(snapshot.events[0].id, "event-802");
  assert.equal(snapshot.events.at(-1).id, "event-1001");

  runtimeListener(
    { type: "MQTT_MONITOR_SET_REPLAY_MODE", panelConnected: false },
    null,
    () => {}
  );
  for (let index = 1; index <= 12; index += 1) {
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
  assert.ok(snapshot.events.length < 1000);
  assert.ok(snapshot.bufferedBytes <= snapshot.maxBufferedBytes);
  assert.equal(snapshot.maxBufferedBytes, 8 * 1024 * 1024);
  assert.equal(snapshot.replayMode, "standby");
  assert.equal(snapshot.events.at(-1).id, "large-12");
});
