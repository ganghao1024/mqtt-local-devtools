"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEventBatcher } = require("../event-batcher.js");

test("events are sent as one batch after the interval", () => {
  const callbacks = [];
  const sent = [];
  const batcher = createEventBatcher((events) => sent.push(events), {
    maxBatchSize: 100,
    intervalMs: 50,
    setTimer: (callback) => { callbacks.push(callback); return callbacks.length; },
    clearTimer: () => {}
  });

  for (let index = 0; index < 20; index += 1) batcher.queue({ id: index });
  assert.equal(callbacks.length, 1);
  assert.equal(sent.length, 0);

  callbacks.shift()();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 20);
  assert.equal(batcher.size(), 0);
});

test("a full batch is sent immediately", () => {
  const sent = [];
  const batcher = createEventBatcher((events) => sent.push(events), {
    maxBatchSize: 3,
    setTimer: () => 1,
    clearTimer: () => {}
  });

  batcher.queue({ id: 1 });
  batcher.queue({ id: 2 });
  batcher.queue({ id: 3 });

  assert.deepEqual(sent, [[{ id: 1 }, { id: 2 }, { id: 3 }]]);
});

test("the default batch wait stays within one display frame", () => {
  let scheduledDelay = null;
  const batcher = createEventBatcher(() => {}, {
    setTimer: (_callback, delay) => { scheduledDelay = delay; return 1; },
    clearTimer: () => {}
  });

  batcher.queue({ id: 1 });
  assert.equal(scheduledDelay, 16);
});
