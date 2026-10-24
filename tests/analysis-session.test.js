const { test } = require("node:test");
const assert = require("node:assert/strict");
const s = require("../analysis-session.js");
const b = require("../ring-buffer.js");
const config = { devicePath: "device", topicIsObject: false, ignorePaths: [] };
const event = (id, value, extra = {}) => ({ id: String(id), kind: "packet", timestamp: 1000 + Number(id), connectionId: "c", direction: "incoming",
  packet: { typeName: "PUBLISH", topic: "shared", qos: 1, retain: true, dup: false, rawHex: "30 00", payloadText: JSON.stringify(value) }, ...extra });
function records(values) { return values.map((value, index) => ({ event: event(index + 1, value), order: index + 1, connection: { clientId: "client" } })); }

test("analysis cache owns copies of both native event and connection metadata", () => {
  const cache = s.createCache(), original = event(1, { device: "A", value: 1 }), connection = { clientId: "original", sourceTab: { title: "before" } };
  cache.append(original, connection, 12);
  original.packet.payloadText = "changed"; connection.clientId = "changed"; connection.sourceTab.title = "after";
  const saved = cache.get("1");
  assert.equal(saved.order, 12); assert.equal(saved.connection.clientId, "original"); assert.equal(saved.connection.sourceTab.title, "before");
  assert.deepEqual(JSON.parse(saved.event.packet.payloadText), { device: "A", value: 1 });
  assert.notEqual(saved.event, original);
});
test("main cache eviction and clearing cannot delete independent analysis records", () => {
  const main = b.createBoundedRingBuffer({ maxItems: 1 }), independent = s.createCache();
  const first = event(1, { device: "A" }); main.append(first); independent.append(first);
  main.append(event(2, {})); main.clear();
  assert.equal(independent.records().length, 1); assert.equal(independent.get("1").event.id, "1");
  independent.clear(); assert.equal(independent.stats().bytes, 0); assert.equal(independent.records().length, 0);
});
test("independent cache stops at item and byte limits without evicting captured records", () => {
  const cache = s.createCache({ maxItems: 2, maxBytes: 100000 });
  for (let i = 1; i <= 3; i++) cache.append(event(i, {}));
  assert.deepEqual(cache.records().map(r => r.event.id), ["1", "2"]); assert.equal(cache.stats().evicted, 0);
  assert.equal(cache.stats().fullReason, "items"); assert.equal(cache.stats().skipped, 1);
  assert.equal(cache.append(event(3, {})).added, false);
  const bytes = b.serializedByteLength({ event: event(1, {}), connection: {}, order: 1 });
  const byteCache = s.createCache({ maxItems: 10, maxBytes: bytes * 2 - 1 });
  byteCache.append(event(1, {})); byteCache.append(event(2, {}));
  assert.ok(byteCache.stats().bytes <= byteCache.stats().maxBytes); assert.equal(byteCache.stats().count, 1);
  assert.equal(byteCache.stats().fullReason, "bytes");
  const before = byteCache.records();
  assert.equal(byteCache.append(event(3, {})).full, true);
  assert.deepEqual(byteCache.records(), before); assert.equal(byteCache.stats().skipped, 2);
});
test("only manual clear resumes a full cache; oversized records never remove existing evidence", () => {
  const cache = s.createCache({ maxItems: 2, maxBytes: 2000 });
  cache.append(event(1, {}));
  assert.equal(cache.append(event(2, { huge: "x".repeat(3000) })).rejected, true);
  assert.equal(cache.stats().full, false); assert.equal(cache.get("1").event.id, "1");
  cache.append(event(3, {}));
  const before = JSON.stringify(cache.records());
  for (let id = 4; id < 104; id++) cache.append(event(id, {}));
  assert.equal(JSON.stringify(cache.records()), before); assert.equal(cache.stats().skipped, 100);
  cache.clear(); assert.equal(cache.stats().full, false); assert.equal(cache.stats().skipped, 0); assert.equal(cache.stats().bytes, 0);
  assert.equal(cache.append(event(104, {})).added, true); assert.deepEqual(cache.records().map(record => record.event.id), ["104"]);
});
test("latest N uses original capture order rather than timestamps or import order", () => {
  const cache = s.createCache(); cache.append(event(3, {}, { timestamp: 0 }), {}, 30); cache.append(event(1, {}, { timestamp: 100000 }), {}, 10); cache.append(event(2, {}), {}, 20);
  assert.deepEqual(cache.latest(2).map(r => r.event.id), ["2", "3"]);
  assert.equal(cache.latest(10).length, 3);
  for (const n of [0, -1, 1.5, NaN, 1001, "2"]) assert.throws(() => cache.latest(n), /1–1000/);
});
test("manual snapshot imports atomically, deduplicates records and owns copied metadata", () => {
  const cache = s.createCache({ maxItems: 3, maxBytes: 100000 });
  cache.append(event(1, {}), {}, 1);
  const second = { event: event(2, { value: 2 }), connection: { clientId: "original" }, order: 2 };
  assert.equal(cache.appendBatch([{ event: event(1, {}), order: 1 }, second, second]).ok, true);
  second.event.packet.payloadText = "changed"; second.connection.clientId = "changed";
  assert.equal(cache.get("2").connection.clientId, "original"); assert.equal(JSON.parse(cache.get("2").event.packet.payloadText).value, 2);
  const before = JSON.stringify(cache.records()), stats = cache.stats();
  assert.equal(cache.appendBatch([{ event: event(3, {}), order: 3 }, { event: event(4, {}), order: 4 }]).ok, false);
  assert.equal(JSON.stringify(cache.records()), before); assert.deepEqual(cache.stats(), stats);
  assert.equal(cache.appendBatch([{ event: event(3, {}), order: 3 }]).ok, true);
  assert.equal(cache.stats().full, true);
  assert.equal(cache.appendBatch([{ event: event(1, {}), order: 1 }]).ok, true);
  assert.equal(cache.appendBatch([{ event: event(4, {}), order: 4 }]).ok, false);
});
test("manual snapshot capacity failure leaves bytes, order and evidence unchanged", () => {
  const cache = s.createCache({ maxItems: 10, maxBytes: 1200 }); cache.append(event(1, {}), {}, 1);
  const before = JSON.stringify(cache.records()), stats = cache.stats();
  assert.equal(cache.appendBatch([{ event: event(2, {}), order: 2 }, { event: event(3, { huge: "x".repeat(1500) }), order: 3 }]).ok, false);
  assert.equal(JSON.stringify(cache.records()), before); assert.deepEqual(cache.stats(), stats);
  assert.equal(cache.appendBatch(Array(1001).fill({ event: event(2, {}) })).ok, false);
});
test("Topic scope shares sidebar grouping, filters before latest N and excludes multi-topic controls", () => {
  const cache = s.createCache();
  for (const [id, topic] of [[1, "site/device/state/osd"], [2, "other/device/state/osd"], [3, "site/device/state/info"], [4, "site/device/state2/osd"], [5, "other/device/state/osd"]]) {
    const input = event(id, { device: "A" }); input.packet.topic = topic; cache.append(input);
  }
  const subscribe = event(6, {}); subscribe.packet = { typeName: "SUBSCRIBE", topics: [{ topic: "site/device/state/#" }, { topic: "other/device/state/#" }] }; cache.append(subscribe);
  assert.equal(s.topicGroup(subscribe), null);
  assert.deepEqual(cache.latest(2, "site/device/state").map(record => record.event.id), ["1", "3"]);
  assert.equal(cache.latest(10, "site/device/state").length, 2);
  assert.equal(cache.latest(10, "").length, 0);
  assert.deepEqual(cache.topicGroups().find(group => group.name === "site/device/state"), { name: "site/device/state", count: 2 });
  assert.equal(cache.topicGroups().length, 3);
  cache.remove("1"); assert.equal(cache.topicGroups().find(group => group.name === "site/device/state").count, 1);
  const literalAll = event(7, {}); literalAll.packet.topic = "all"; cache.append(literalAll);
  assert.deepEqual(cache.latest(10, "all").map(record => record.event.id), ["7"]);
  cache.clear(); assert.deepEqual(cache.topicGroups(), []);
});
test("scoped analysis and every export reject other groups and stale scope reports", () => {
  const input = records([{ device: "A", value: 0 }, { device: "A", value: 1 }]);
  const scoped = { ...config, topicGroup: "shared" }, report = s.analyze(input, scoped);
  assert.equal(report.topicGroup, "shared");
  const other = records([{ device: "A", value: 2 }])[0]; other.event.packet.topic = "another";
  assert.throws(() => s.createSequenceAnalysis([...input, other], scoped), /Topic 分组/);
  assert.throws(() => s.createSequenceAnalysis(input, { ...scoped, topicGroup: "" }), /Topic 分组/);
  for (const mode of ["changes", "raw", "combined"]) {
    assert.throws(() => s.buildExport(mode, [...input, other], report, scoped, "test"), /Topic 分组/);
    const value = s.buildExport(mode, input, report, scoped, "test");
    assert.equal(value.config.topicGroup, "shared");
  }
  assert.throws(() => s.buildExport("combined", input, { ...report, topicGroup: "another" }, scoped, "test"), /失效/);
});
test("sequence analysis isolates devices and compares adjacent records in each object", () => {
  const report = s.analyze(records([{ device: "A", value: 0 }, { device: "B", value: 50 }, { device: "A", value: 1 }, { device: "A", value: 0 }]), config);
  assert.equal(report.counts.objects, 2); assert.equal(report.counts.comparedPairs, 2);
  assert.deepEqual(report.changes.map(c => [c.beforeId, c.afterId]), [["1", "3"], ["3", "4"]]);
  const field = report.fields[0]; assert.equal(field.path, "/value"); assert.equal(field.count, 2);
  assert.ok(field.patterns.includes("数值上下波动")); assert.ok(field.patterns.includes("曾回到初始值"));
  assert.deepEqual(field.flow.map(v => v.value), [0, 1, 0]);
});
test("patterns describe numeric trends, additions, removals and exact type changes", () => {
  const report = s.analyze(records([{ device: "A", count: 0, gone: null, type: false }, { device: "A", count: 1, add: "", type: 0 }, { device: "A", count: 2, add: null, type: "0" }]), config);
  assert.ok(report.fields.find(f => f.path === "/count").patterns.includes("数值持续增加"));
  assert.ok(report.fields.find(f => f.path === "/type").patterns.includes("发生类型变化"));
  assert.deepEqual(report.changes.find(c => c.path === "/gone").before, { exists: true, type: "null", value: null });
  assert.deepEqual(report.changes.find(c => c.path === "/gone").after, { exists: false, type: "missing" });
  assert.equal(report.changes.find(c => c.path === "/add").after.value, "");
});
test("non JSON, truncation and unknown identity break continuity instead of bridging gaps", () => {
  const input = records([{ device: "A", value: 0 }, {}, { device: "A", value: 2 }, { device: "A", value: 3 }]);
  input[1].event.packet.payloadText = "not JSON";
  const report = s.analyze(input, config);
  assert.equal(report.counts.comparedPairs, 1); assert.equal(report.pairs[0].beforeId, "3"); assert.match(report.skipped[0].reason, /非 JSON/);
  assert.equal(s.analyze(records([{ device: "A" }, { device: "A" }]), {}).counts.comparedPairs, 0);
  input[1].event.packet.payloadText = '{"device":"A"}'; input[1].event.packet.payloadTruncated = true;
  assert.equal(s.analyze(input, config).counts.comparedPairs, 1);
});
test("ignore paths and array index rules apply throughout batch analysis", () => {
  const input = records([{ device: "A", time: 1, data: [{ x: 0 }] }, { device: "A", time: 2, data: [{ x: false }] }]);
  const report = s.analyze(input, { ...config, ignorePaths: ["time"] });
  assert.equal(report.changes.length, 1); assert.equal(report.changes[0].path, "/data/0/x"); assert.equal(report.arrayRule, "index");
  const unchanged = s.analyze(input, { ...config, ignorePaths: ["time", "data"] }); assert.equal(unchanged.counts.unchangedPairs, 1);
});
test("cooperative jobs report progress, bound retained output and flag incomplete reports", () => {
  const input = records(Array.from({ length: 50 }, (_, i) => ({ device: "A", value: i })));
  const job = s.createSequenceAnalysis(input, config, { maxChanges: 5 });
  assert.deepEqual(Object.fromEntries(Object.entries(job.step(1)).filter(([key]) => key !== "result")), { done: false, processed: 1, total: 50 });
  let state; do { state = job.step(7); } while (!state.done);
  assert.equal(state.result.changes.length, 5); assert.equal(state.result.limited, true); assert.equal(state.result.counts.comparedPairs, 49);
  assert.ok(state.result.limitations.length);
});
test("long report values are explicitly abbreviated without changing native payloads", () => {
  const input = records([{ device: "A", value: "x".repeat(1000) }, { device: "A", value: "y".repeat(1000) }]);
  const before = JSON.stringify(input), report = s.analyze(input, config);
  assert.equal(report.changes[0].before.truncated, true); assert.ok(report.changes[0].before.originalCharacters > 1000);
  assert.equal(JSON.stringify(input), before); assert.equal(JSON.parse(input[0].event.packet.payloadText).value.length, 1000);
});
test("changes, native data and combined exports have distinct contents and matching references", () => {
  const input = records([{ device: "A", value: 0 }, { device: "A", value: 1 }]), report = s.analyze(input, config);
  const changes = s.buildExport("changes", input, report, config, "0.8.6"), raw = s.buildExport("raw", input, null, config, "0.8.6"), combined = s.buildExport("combined", input, report, config, "0.8.6");
  assert.equal(changes.messages, undefined); assert.equal(raw.report, undefined); assert.deepEqual(combined.report, changes.report); assert.deepEqual(combined.messages, raw.messages);
  assert.equal(raw.messages[0].event.packet.rawHex, "30 00"); assert.equal(raw.messages[0].event.packet.retain, true); assert.equal(raw.messages[0].event.packet.payloadText, input[0].event.packet.payloadText);
  for (const value of [changes, raw, combined]) assert.deepEqual(JSON.parse(JSON.stringify(value)).selection.map(item => item.id), ["1", "2"]);
  assert.throws(() => s.buildExport("combined", input.slice(1), report, config, "x"), /失效/);
  assert.throws(() => s.buildExport("invalid", input, report, config, "x"), /无效/);
});
