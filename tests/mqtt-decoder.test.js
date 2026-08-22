"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeMany } = require("../mqtt-decoder.js");

function utf8(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([bytes.length >> 8, bytes.length & 0xff]), bytes]);
}

function packet(firstByte, body) {
  assert.ok(body.length < 128, "test helper only supports short packets");
  return Buffer.concat([Buffer.from([firstByte, body.length]), body]);
}

test("decodes MQTT 3.1.1 CONNECT", () => {
  const body = Buffer.concat([
    utf8("MQTT"),
    Buffer.from([4, 0xc2, 0, 60]),
    utf8("local-debug-client"),
    utf8("developer"),
    utf8("secret")
  ]);
  const result = decodeMany(packet(0x10, body));

  assert.equal(result.packets.length, 1);
  assert.deepEqual(
    {
      type: result.packets[0].typeName,
      version: result.packets[0].protocolVersion,
      clientId: result.packets[0].clientId,
      username: result.packets[0].username,
      hasPassword: result.packets[0].hasPassword
    },
    {
      type: "CONNECT",
      version: 4,
      clientId: "local-debug-client",
      username: "developer",
      hasPassword: true
    }
  );
});

test("decodes JSON PUBLISH payload", () => {
  const payload = Buffer.from('{"temperature":23.5}', "utf8");
  const body = Buffer.concat([utf8("sensors/room-1"), payload]);
  const result = decodeMany(packet(0x30, body), 4);
  const publish = result.packets[0];

  assert.equal(publish.typeName, "PUBLISH");
  assert.equal(publish.topic, "sensors/room-1");
  assert.equal(publish.qos, 0);
  assert.equal(publish.payloadText, '{"temperature":23.5}');
  assert.equal(publish.payloadEncoding, "utf-8");
});

test("decodes Chinese PUBLISH payload as UTF-8", () => {
  const payload = Buffer.from('{"status":"充电中"}', "utf8");
  const body = Buffer.concat([utf8("demo/data/device"), payload]);
  const result = decodeMany(packet(0x30, body), 4);
  const publish = result.packets[0];

  assert.equal(publish.payloadEncoding, "utf-8");
  assert.equal(publish.payloadText, '{"status":"充电中"}');
  assert.deepEqual(JSON.parse(publish.payloadText), { status: "充电中" });
});

test("decodes MQTT 5 PUBLISH properties boundary", () => {
  const payload = Buffer.from("online", "utf8");
  const body = Buffer.concat([utf8("device/status"), Buffer.from([0]), payload]);
  const result = decodeMany(packet(0x31, body), 5);
  const publish = result.packets[0];

  assert.equal(publish.topic, "device/status");
  assert.equal(publish.retain, true);
  assert.equal(publish.payloadText, "online");
});

test("decodes SUBSCRIBE topics", () => {
  const body = Buffer.concat([
    Buffer.from([0, 7]),
    utf8("devices/+/status"),
    Buffer.from([1]),
    utf8("alerts/#"),
    Buffer.from([0])
  ]);
  const result = decodeMany(packet(0x82, body), 4);

  assert.equal(result.packets[0].typeName, "SUBSCRIBE");
  assert.deepEqual(result.packets[0].topics, [
    { topic: "devices/+/status", qos: 1, noLocal: false, retainAsPublished: false, retainHandling: 0 },
    { topic: "alerts/#", qos: 0, noLocal: false, retainAsPublished: false, retainHandling: 0 }
  ]);
});

test("decodes multiple MQTT packets in one WebSocket message", () => {
  const bytes = Buffer.concat([
    packet(0xc0, Buffer.alloc(0)),
    packet(0xd0, Buffer.alloc(0)),
    packet(0xe0, Buffer.alloc(0))
  ]);
  const result = decodeMany(bytes, 4);

  assert.deepEqual(result.packets.map((item) => item.typeName), ["PINGREQ", "PINGRESP", "DISCONNECT"]);
});
