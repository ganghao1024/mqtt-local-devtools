const { test } = require("node:test");
const assert = require("node:assert/strict");
const a = require("../analysis-runtime.js");
const event = (id, value, extra = {}) => ({ id, kind: "packet", connectionId: "c", timestamp: Number(id) * 1000,
  direction: "incoming", packet: { typeName: "PUBLISH", topic: "shared", payloadText: JSON.stringify(value) }, ...extra });

test("automatic comparison isolates typed device identifiers, connections and directions", () => {
  const events = [event("1", { device: "A" }), event("2", { device: "B" }), event("3", { device: "A" })];
  assert.equal(a.previous(events, "3", { devicePath: "device" }).event.id, "1");
  assert.equal(a.previous(events, "3", {}).event, undefined);
  assert.equal(a.previous(events, "3", { topicIsObject: true }).event.id, "2");
  for (const change of [{ connectionId: "other" }, { direction: "outgoing" }]) {
    assert.equal(a.previous([events[0], event("3", { device: "A" }, change)], "3", { devicePath: "device" }).event, undefined);
  }
  assert.equal(a.previous([event("1", { device: 0 }), event("2", { device: "0" })], "2", { devicePath: "device" }).event, undefined);
});
test("diff distinguishes missing, null, empty, zero, false, nested additions, deletions and types", () => {
  const left = { nested: { removed: null, changed: 0 }, array: [false, ""], keep: false, nil: null };
  const right = { nested: { added: false, changed: "0" }, array: [0, null, ""], keep: false, nil: "" };
  const changes = a.diff(left, right).changes;
  assert.deepEqual(changes.map(c => c.path), ["/nested/removed", "/nested/changed", "/nested/added", "/array/0", "/array/1", "/array/2", "/nil"]);
  assert.deepEqual(changes[0].before, { exists: true, value: null });
  assert.deepEqual(changes[0].after, { exists: false });
  assert.equal(changes[2].kind, "新增");
  assert.equal(a.diff(left, right, ["nested", "/array", "nil"]).changes.length, 0);
  assert.equal(a.diff({ a: {} }, { a: [] }).changes[0].path, "/a");
  assert.deepEqual(a.diff({}, { data: { time: 1, value: false } }, ["data.time"]).changes.map(c => c.path), ["/data/value"]);
});
test("exact paths, malformed payloads, truncation and evicted history have explicit outcomes", () => {
  assert.deepEqual(a.field({ "a.b": { "/": 0 } }, "/a.b/~1"), { exists: true, value: 0 });
  assert.equal(a.identity(event("1", {}), { devicePath: "missing" }).reliable, false);
  assert.equal(a.payload({ packet: { payloadText: "text" } }).ok, false);
  assert.equal(a.payload({ packet: { payloadText: "null" } }).value, null);
  assert.equal(a.payload({ packet: { payloadText: "{}", payloadTruncated: true } }).ok, false);
  assert.match(a.previous([], "gone", {}).reason, /淘汰/);
  assert.equal(a.diff({ a: 1, b: 2 }, { a: 2, b: 3 }, [], { maxChanges: 1 }).limited, true);
});
