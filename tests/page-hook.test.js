"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TextDecoder, TextEncoder } = require("node:util");

const projectRoot = path.resolve(__dirname, "..");

test("WebSocket hook preserves send and emits decoded MQTT packets", async () => {
  const postedMessages = [];
  const windowListeners = new Map();
  const context = {
    Blob,
    Event,
    EventTarget,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "test-session" },
    location: { href: "http://localhost:5173/" },
    console
  };
  context.window = context;
  context.globalThis = context;
  context.addEventListener = (type, listener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  };
  context.postMessage = (data) => {
    postedMessages.push(data);
    for (const listener of windowListeners.get("message") || []) {
      listener({ source: context, data });
    }
  };
  vm.createContext(context);

  vm.runInContext(`
    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url, protocols) {
        super();
        this.url = String(url);
        this.protocol = Array.isArray(protocols) ? (protocols[0] || "") : (protocols || "");
        this.readyState = FakeWebSocket.OPEN;
        this.sent = [];
      }
      send(data) { this.sent.push(data); }
    }
    window.WebSocket = FakeWebSocket;
  `, context);

  for (const filename of ["mqtt-decoder.js", "page-hook.js"]) {
    vm.runInContext(fs.readFileSync(path.join(projectRoot, filename), "utf8"), context, { filename });
  }

  vm.runInContext(`
    window.testSocket = new WebSocket("ws://localhost:8083/mqtt", ["mqtt"]);
    window.testSocket.send(new Uint8Array([
      0x10, 0x1e,
      0x00, 0x04, 0x4d, 0x51, 0x54, 0x54,
      0x04, 0x02, 0x00, 0x3c,
      0x00, 0x12,
      0x6c, 0x6f, 0x63, 0x61, 0x6c, 0x2d, 0x64, 0x65, 0x62, 0x75,
      0x67, 0x2d, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74
    ]));
  `, context);

  await new Promise((resolve) => setTimeout(resolve, 10));
  const events = postedMessages.map((item) => item.event).filter(Boolean);
  const connectEvent = events.find((item) => item.kind === "packet" && item.packet?.typeName === "CONNECT");

  assert.ok(connectEvent, "CONNECT packet should be emitted");
  assert.equal(connectEvent.direction, "outgoing");
  assert.equal(connectEvent.packet.clientId, "local-debug-client");
  assert.equal(vm.runInContext("window.testSocket.sent.length", context), 1);
});
