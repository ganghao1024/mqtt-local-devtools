"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBoundedRingBuffer, serializedByteLength } = require("../ring-buffer.js");

test("ring buffer evicts the oldest item without shifting the backing array", () => {
  const buffer = createBoundedRingBuffer({ maxItems: 3, maxBytes: 1000, sizeOf: () => 1 });
  buffer.append({ id: 1 });
  buffer.append({ id: 2 });
  buffer.append({ id: 3 });
  assert.deepEqual(buffer.append({ id: 4 }), [{ id: 1 }]);
  assert.deepEqual(buffer.toArray().map((item) => item.id), [2, 3, 4]);
  assert.equal(buffer.at(0).id, 2);
  assert.equal(buffer.at(2).id, 4);
});

test("ring buffer applies byte and item limits independently", () => {
  const buffer = createBoundedRingBuffer({ maxItems: 10, maxBytes: 7, sizeOf: (item) => item.bytes });
  buffer.append({ id: 1, bytes: 3 });
  buffer.append({ id: 2, bytes: 3 });
  assert.deepEqual(buffer.append({ id: 3, bytes: 4 }).map((item) => item.id), [1]);
  assert.deepEqual(buffer.toArray().map((item) => item.id), [2, 3]);
  assert.equal(buffer.totalBytes, 7);
});

test("ring buffer can remove matching source data while preserving order", () => {
  const buffer = createBoundedRingBuffer({ maxItems: 5, maxBytes: 100, sizeOf: () => 1 });
  [1, 2, 3, 4].forEach((id) => buffer.append({ id, source: id % 2 }));
  assert.deepEqual(buffer.removeWhere((item) => item.source === 0).map((item) => item.id), [2, 4]);
  assert.deepEqual(buffer.toArray().map((item) => item.id), [1, 3]);
});

test("serialized byte length measures UTF-8 bytes", () => {
  assert.equal(serializedByteLength("中"), 5);
});
