"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function listenerSlot() {
  return {
    listener: null,
    addListener(listener) { this.listener = listener; }
  };
}

function createBackgroundHarness() {
  const runtimeConnect = listenerSlot();
  const runtimeMessage = listenerSlot();
  const tabsUpdated = listenerSlot();
  const tabsRemoved = listenerSlot();
  const tabs = {
    4300: { id: 4300, title: "仪表盘", url: "http://localhost:4300/#/dashboard" },
    5050: { id: 5050, title: "飞控平台", url: "http://localhost:5050/uav-platform/#/fly-ctrl" }
  };
  const snapshots = {
    4300: [{ id: "ready-4300", kind: "hook-ready", timestamp: 1 }],
    5050: [{ id: "packet-5050", kind: "packet", timestamp: 2, connectionId: "mqtt-1", packet: { typeName: "PUBLISH" } }]
  };
  const tabMessages = [];
  let badgeRejectionHandlers = 0;
  const rejectedBadgeOperation = {
    catch(handler) {
      badgeRejectionHandlers += 1;
      assert.equal(typeof handler, "function");
    }
  };
  const context = {
    URL,
    Promise,
    console,
    importScripts() {},
    chrome: {
      runtime: {
        lastError: null,
        onConnect: runtimeConnect,
        onMessage: runtimeMessage
      },
      action: {
        setBadgeText() { return rejectedBadgeOperation; },
        setBadgeBackgroundColor() { return rejectedBadgeOperation; }
      },
      tabs: {
        get(tabId, callback) { callback(tabs[tabId]); },
        query(_query, callback) { callback(Object.values(tabs)); },
        sendMessage(tabId, message, callback) {
          tabMessages.push({ tabId, message });
          callback?.(message.type === "MQTT_MONITOR_GET_SNAPSHOT"
            ? { events: snapshots[tabId] || [] }
            : {});
        },
        onUpdated: tabsUpdated,
        onRemoved: tabsRemoved
      }
    }
  };
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "background-runtime.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "background.js"), "utf8"), context);
  return {
    context,
    runtimeConnect,
    runtimeMessage,
    tabs,
    tabMessages,
    badgeRejectionHandlers: () => badgeRejectionHandlers
  };
}

test("panel switches related page replay buffers only after its initial snapshot is ready", () => {
  const harness = createBackgroundHarness();
  const portMessages = listenerSlot();
  const portDisconnect = listenerSlot();
  const port = {
    name: "mqtt-monitor-panel",
    onMessage: portMessages,
    onDisconnect: portDisconnect,
    postMessage() {}
  };

  harness.runtimeConnect.listener(port);
  portMessages.listener({ type: "PANEL_INIT", tabId: 4300 });
  assert.equal(
    harness.tabMessages.filter(({ message }) => message.type === "MQTT_MONITOR_SET_REPLAY_MODE").length,
    0
  );

  portMessages.listener({ type: "PANEL_READY", tabId: 4300 });

  const connectedModes = harness.tabMessages.filter(
    ({ message }) => message.type === "MQTT_MONITOR_SET_REPLAY_MODE"
  );
  assert.deepEqual(
    connectedModes.map(({ tabId, message }) => [tabId, message.panelConnected]).sort(),
    [[4300, true], [5050, true]]
  );

  harness.tabMessages.length = 0;
  portDisconnect.listener();
  const disconnectedModes = harness.tabMessages.filter(
    ({ message }) => message.type === "MQTT_MONITOR_SET_REPLAY_MODE"
  );
  assert.deepEqual(
    disconnectedModes.map(({ tabId, message }) => [tabId, message.panelConnected]).sort(),
    [[4300, false], [5050, false]]
  );
});

test("live events from port 5050 reach a DevTools panel inspecting port 4300", () => {
  const harness = createBackgroundHarness();
  const posted = [];
  const portMessages = listenerSlot();
  const portDisconnect = listenerSlot();
  const port = {
    name: "mqtt-monitor-panel",
    onMessage: portMessages,
    onDisconnect: portDisconnect,
    postMessage(message) { posted.push(message); }
  };

  harness.runtimeConnect.listener(port);
  portMessages.listener({ type: "PANEL_INIT", tabId: 4300 });
  harness.runtimeMessage.listener(
    { type: "MQTT_MONITOR_EVENTS", events: [{ id: "live", kind: "packet", timestamp: 3 }] },
    { tab: harness.tabs[5050] },
    () => {}
  );

  assert.equal(posted.length, 1);
  assert.equal(posted[0].events[0].sourceTab.id, 5050);
  assert.equal(posted[0].events[0].sourceTab.url, harness.tabs[5050].url);
});

test("local snapshot combines buffered events from ports 4300 and 5050", async () => {
  const harness = createBackgroundHarness();
  const response = await new Promise((resolve) => {
    const keepChannelOpen = harness.runtimeMessage.listener(
      { type: "MQTT_MONITOR_GET_SNAPSHOT", tabId: 4300 },
      {},
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });

  assert.deepEqual(response.events.map((event) => event.sourceTab.id).sort(), [4300, 5050]);
  assert.equal(response.events.find((event) => event.id === "packet-5050").sourceTab.title, "飞控平台");
});

test("closed-tab badge failures are consumed by the background worker", () => {
  const harness = createBackgroundHarness();

  harness.runtimeMessage.listener(
    { type: "MQTT_MONITOR_EVENTS", events: [{ id: "late", kind: "packet", timestamp: 4 }] },
    { tab: harness.tabs[5050] },
    () => {}
  );

  assert.equal(harness.badgeRejectionHandlers(), 2);
});
