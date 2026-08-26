"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendWithLimit,
  constrainPaneWidths,
  createDebouncer,
  createRenderScheduler,
  createTopicCounterIndex,
  eventMatchesTopic,
  eventMatchesTopicGroup,
  findTextMatches,
  formatRelativeTime,
  groupPacketTopicTree,
  groupPacketTopics,
  observeSourceSession,
  packetEmptyState,
  packetMessageRate,
  pruneSourceTabData,
  reconcileKeyedChildren,
  syncConnectionSelect,
  virtualWindow,
  visiblePacketsByTimeOrder
} = require("../panel-runtime.js");

test("packet empty state distinguishes no captured packets from no filter matches", () => {
  assert.deepEqual(packetEmptyState(0, 0), {
    title: "等待 MQTT 报文",
    description: "刷新实际创建 MQTT 的页面，让插件从连接建立前开始监听。"
  });
  assert.deepEqual(packetEmptyState(5000, 0), {
    title: "没有匹配的报文",
    description: "调整或清除筛选条件后重试。"
  });
  assert.equal(packetEmptyState(5000, 1), null);
});

class FakeOption {
  constructor(text, value) {
    this.text = text;
    this.value = value;
  }
}

function createFakeSelect() {
  return {
    value: "all",
    dataset: {},
    options: [],
    replaceCount: 0,
    replaceChildren(...options) {
      this.options = options;
      this.replaceCount += 1;
      this.value = options[0]?.value || "";
    }
  };
}

test("connection select keeps the same option nodes when connections did not change", () => {
  const select = createFakeSelect();
  const connections = [
    { id: "a", clientId: "client-a" },
    { id: "b", clientId: "client-b" }
  ];

  assert.equal(syncConnectionSelect(select, connections, "b", FakeOption), true);
  select.value = "b";
  const firstOptions = select.options;

  assert.equal(syncConnectionSelect(select, connections, "b", FakeOption), false);
  assert.equal(select.options, firstOptions);
  assert.equal(select.replaceCount, 1);
  assert.equal(select.value, "b");
});

test("high-frequency events are coalesced into one scheduled render", () => {
  const callbacks = [];
  let renderCount = 0;
  const scheduler = createRenderScheduler(
    () => { renderCount += 1; },
    {
      intervalMs: 100,
      now: () => 0,
      setTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      clearTimer: () => {}
    }
  );

  for (let index = 0; index < 100; index += 1) scheduler.schedule();
  assert.equal(callbacks.length, 1);
  assert.equal(renderCount, 0);

  callbacks.shift()();
  assert.equal(renderCount, 1);
});

test("the default panel render wait targets roughly 30 frames per second", () => {
  let scheduledDelay = null;
  let scheduledCallback = null;
  const scheduler = createRenderScheduler(() => {}, {
    now: () => 0,
    setTimer: (callback, delay) => {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return 1;
    },
    clearTimer: () => {}
  });

  scheduler.schedule();
  scheduledCallback();
  scheduler.schedule();
  assert.equal(scheduledDelay, 33);
});

function createFakeContainer() {
  return {
    children: [],
    insertBefore(node, reference) {
      const currentIndex = this.children.indexOf(node);
      if (currentIndex >= 0) this.children.splice(currentIndex, 1);
      const referenceIndex = reference === null ? -1 : this.children.indexOf(reference);
      if (referenceIndex < 0) this.children.push(node);
      else this.children.splice(referenceIndex, 0, node);
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
    }
  };
}

test("packet row reconciliation reuses unchanged rows", () => {
  const container = createFakeContainer();
  const createNode = (item) => ({ dataset: {}, value: item.value });
  const updateNode = (node, item) => { node.value = item.value; };

  assert.deepEqual(
    reconcileKeyedChildren(container, [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
      { id: "c", value: 3 }
    ], (item) => item.id, createNode, updateNode),
    { created: 3, removed: 0, reused: 0 }
  );

  assert.deepEqual(
    reconcileKeyedChildren(container, [
      { id: "b", value: 20 },
      { id: "c", value: 30 },
      { id: "d", value: 40 }
    ], (item) => item.id, createNode, updateNode),
    { created: 1, removed: 1, reused: 2 }
  );
  assert.deepEqual(container.children.map((node) => node.dataset.renderKey), ["b", "c", "d"]);
  assert.deepEqual(container.children.map((node) => node.value), [20, 30, 40]);
});

test("visible packets keep the latest window and support both time orders", () => {
  const packets = [1, 2, 3, 4, 5].map((timestamp) => ({ timestamp }));

  assert.deepEqual(
    visiblePacketsByTimeOrder(packets, 3, "desc").map((item) => item.timestamp),
    [5, 4, 3]
  );
  assert.deepEqual(
    visiblePacketsByTimeOrder(packets, 3, "asc").map((item) => item.timestamp),
    [3, 4, 5]
  );
  assert.deepEqual(packets.map((item) => item.timestamp), [1, 2, 3, 4, 5]);
});

test("virtual window renders only viewport rows plus overscan", () => {
  const items = Array.from({ length: 5000 }, (_, id) => ({ id }));
  const first = virtualWindow(items, {
    scrollTop: 0,
    viewportHeight: 460,
    rowHeight: 46,
    overscan: 8
  });
  assert.equal(first.start, 0);
  assert.equal(first.end, 18);
  assert.equal(first.items.length, 18);
  assert.equal(first.bottomHeight, (5000 - 18) * 46);

  const middle = virtualWindow(items, {
    scrollTop: 2300,
    viewportHeight: 460,
    rowHeight: 46,
    overscan: 8
  });
  assert.equal(middle.start, 42);
  assert.equal(middle.end, 68);
  assert.equal(middle.items.length, 26);
  assert.equal(middle.topHeight, 42 * 46);
});

test("search debouncer keeps only the latest value for 150ms", () => {
  const callbacks = new Map();
  const values = [];
  let nextId = 0;
  const debouncer = createDebouncer((value) => values.push(value), 150, {
    setTimer(callback, delay) {
      const id = ++nextId;
      callbacks.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) { callbacks.delete(id); }
  });
  debouncer.schedule("a");
  debouncer.schedule("ab");
  assert.equal(callbacks.size, 1);
  const pending = callbacks.values().next().value;
  assert.equal(pending.delay, 150);
  pending.callback();
  assert.deepEqual(values, ["ab"]);
});

test("a new page session is detected only when the same source tab reloads", () => {
  const sessions = new Map();
  const hook = (tabId, sessionId) => ({
    kind: "hook-ready",
    sessionId,
    sourceTab: { id: tabId }
  });

  assert.deepEqual(observeSourceSession(sessions, hook(10, "session-a")), {
    changed: false,
    previousSessionId: undefined,
    sessionId: "session-a",
    sourceTabId: 10
  });
  assert.equal(observeSourceSession(sessions, hook(10, "session-a")).changed, false);
  assert.equal(observeSourceSession(sessions, hook(11, "session-b")).changed, false);
  assert.deepEqual(observeSourceSession(sessions, hook(10, "session-c")), {
    changed: true,
    previousSessionId: "session-a",
    sessionId: "session-c",
    sourceTabId: 10
  });
});

test("refresh pruning removes only data from the refreshed source tab", () => {
  const events = [
    { id: "old-ready", sourceTab: { id: 10 } },
    { id: "old-packet", connectionId: "old-connection", sourceTab: { id: 10 } },
    { id: "other-packet", connectionId: "other-connection", sourceTab: { id: 11 } }
  ];
  const connections = new Map([
    ["old-connection", { id: "old-connection", sourceTab: { id: 10 } }],
    ["other-connection", { id: "other-connection", sourceTab: { id: 11 } }]
  ]);

  const result = pruneSourceTabData(events, connections, 10);

  assert.deepEqual(result.events.map((event) => event.id), ["other-packet"]);
  assert.deepEqual([...result.connections.keys()], ["other-connection"]);
  assert.deepEqual([...result.removedEventIds], ["old-ready", "old-packet"]);
  assert.deepEqual([...result.removedConnectionIds], ["old-connection"]);
  assert.equal(connections.size, 2);
});

test("detail keyword matching is case-insensitive and treats symbols literally", () => {
  assert.deepEqual(findTextMatches("Alarm alarm ALARM", "alarm"), [
    { end: 5, start: 0 },
    { end: 11, start: 6 },
    { end: 17, start: 12 }
  ]);
  assert.deepEqual(findTextMatches("a+b and a+b", "a+b"), [
    { end: 3, start: 0 },
    { end: 11, start: 8 }
  ]);
  assert.deepEqual(findTextMatches("payload", ""), []);
});

test("relative packet time stays compact from live events through older history", () => {
  const now = 1_800_000_000_000;
  assert.equal(formatRelativeTime(now - 300, now), "刚刚");
  assert.equal(formatRelativeTime(now - 1_900, now), "1 秒前");
  assert.equal(formatRelativeTime(now - 125_000, now), "2 分钟前");
  assert.equal(formatRelativeTime(now - 7_300_000, now), "2 小时前");
});

test("message rate counts only packets inside the requested live window", () => {
  const now = 10_000;
  const events = [
    { kind: "packet", timestamp: 9_100 },
    { kind: "packet", timestamp: 9_500 },
    { kind: "packet", timestamp: 9_999 },
    { kind: "packet", timestamp: 8_000 },
    { kind: "connection", timestamp: 9_800 }
  ];
  assert.equal(packetMessageRate(events, now), 3);
  assert.equal(packetMessageRate(events, now, 2_000), 2);
});

test("topic groups aggregate a stable three-level prefix and filter by connection", () => {
  const events = [
    { kind: "packet", connectionId: "a", packet: { topic: "demo/data/device/5200/status" } },
    { kind: "packet", connectionId: "a", packet: { topic: "demo/data/device/1581/status" } },
    { kind: "packet", connectionId: "b", packet: { topic: "demo/data/nest/5200" } },
    { kind: "packet", connectionId: "a", packet: { topics: [{ topic: "demo/cmd/+" }] } }
  ];

  assert.deepEqual(groupPacketTopics(events), [
    { name: "demo/data/device", count: 2 },
    { name: "demo/cmd/+", count: 1 },
    { name: "demo/data/nest", count: 1 }
  ]);
  assert.deepEqual(groupPacketTopics(events, { connectionId: "a", search: "DEVICE" }), [
    { name: "demo/data/device", count: 2 }
  ]);
  assert.equal(eventMatchesTopicGroup(events[0], "demo/data/device"), true);
  assert.equal(eventMatchesTopicGroup(events[2], "demo/data/device"), false);
  assert.equal(eventMatchesTopic(events[0], "demo/data/device/5200/status"), true);
  assert.equal(eventMatchesTopic(events[1], "demo/data/device/5200/status"), false);
  assert.deepEqual(groupPacketTopicTree(events, { connectionId: "a" }), [
    {
      name: "demo/data/device",
      count: 2,
      topics: [
        { name: "demo/data/device/1581/status", count: 1 },
        { name: "demo/data/device/5200/status", count: 1 }
      ]
    },
    {
      name: "demo/cmd/+",
      count: 1,
      topics: [{ name: "demo/cmd/+", count: 1 }]
    }
  ]);
  assert.deepEqual(groupPacketTopicTree(events, { search: "5200/status" }), [
    {
      name: "demo/data/device",
      count: 2,
      topics: [{ name: "demo/data/device/5200/status", count: 1 }]
    }
  ]);
  assert.deepEqual(
    groupPacketTopicTree(events, { connectionId: "a", stableOrder: true }).map((group) => group.name),
    ["demo/cmd/+", "demo/data/device"]
  );
});

test("topic counter index updates counts incrementally on add and eviction", () => {
  const index = createTopicCounterIndex();
  const first = { kind: "packet", connectionId: "a", packet: { topic: "demo/data/device/1" } };
  const second = { kind: "packet", connectionId: "a", packet: { topic: "demo/data/device/2" } };
  const other = { kind: "packet", connectionId: "b", packet: { topic: "demo/data/nest/1" } };
  index.add(first);
  index.add(second);
  index.add(other);
  assert.deepEqual(index.groups({ connectionId: "a", stableOrder: true }), [{
    name: "demo/data/device",
    count: 2,
    topics: [
      { name: "demo/data/device/1", count: 1 },
      { name: "demo/data/device/2", count: 1 }
    ]
  }]);
  index.remove(first);
  assert.equal(index.groups({ connectionId: "a" })[0].count, 1);
  index.clear();
  assert.deepEqual(index.groups(), []);
});

test("pane widths keep all three columns usable while dragging", () => {
  assert.deepEqual(constrainPaneWidths(1280, 50, 900), {
    left: 180,
    center: 366,
    right: 720
  });
  assert.deepEqual(constrainPaneWidths(1000, 600, 360, { activePane: "left" }), {
    left: 266,
    center: 360,
    right: 360
  });
  assert.deepEqual(constrainPaneWidths(1000, 240, 700, { activePane: "right" }), {
    left: 240,
    center: 360,
    right: 386
  });
});

test("bounded event storage deletes oldest entries before pushing new data", () => {
  const events = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const removed = appendWithLimit(events, { id: "4" }, 3);

  assert.deepEqual(removed, [{ id: "1" }]);
  assert.deepEqual(events, [{ id: "2" }, { id: "3" }, { id: "4" }]);
});
