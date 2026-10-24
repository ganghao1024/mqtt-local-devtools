const { test } = require("node:test");
const assert = require("node:assert/strict");
const session = require("../analysis-session.js");
const make = (values, topic = "demo/site/device/A") => values.map((value, i) => ({ order: i + 1, connection: {}, event: { id: "m" + i, kind: "packet", connectionId: "c", direction: "incoming", timestamp: i, packet: { typeName: "PUBLISH", topic, payloadText: JSON.stringify(value) } } }));
const config = { topic: "demo/site/device/A", topicGroup: "demo/site/device", devicePath: "device", fields: ["status", "data.battery"] };
function matrix(records, settings = config) { const job = session.createMatrixAnalysis(records, settings); let state; do { state = job.step(2); } while (!state.done); return state.result; }

test("matrix retains every message including unchanged rows, and supports multiple nested fields", () => {
  const input = make([{ device: "A", status: "idle", data: { battery: 80 } }, { device: "A", status: "idle", data: { battery: 80 } }, { device: "A", status: "run", data: { battery: 79 } }]);
  const result = matrix(input);
  assert.deepEqual(result.columns, config.fields); assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[1].cells.map(cell => cell.changed), [false, false]);
  assert.deepEqual(result.rows[2].cells.map(cell => cell.changed), [true, true]);
  assert.equal(result.rows[2].beforeId, "m1");
});
test("blank fields use union across all messages, retain arrays, exact escaped paths and missing types", () => {
  const input = make([{ device: "A", nested: { a: null }, list: [0], "a/b": false }, { device: "A", nested: { a: "" }, list: [false], late: 0 }]);
  const result = matrix(input, { ...config, fields: [] });
  assert.ok(result.columns.includes("/late")); assert.ok(result.columns.includes("/list/0")); assert.ok(result.columns.includes("/a~1b"));
  const late = result.columns.indexOf("/late"), nested = result.columns.indexOf("/nested/a");
  assert.equal(result.rows[0].cells[late].exists, false); assert.equal(result.rows[1].cells[late].value, 0);
  assert.equal(result.rows[0].cells[nested].value, null); assert.equal(result.rows[1].cells[nested].value, "");
  assert.equal(result.rows[1].cells[result.columns.indexOf("/a~1b")].kind, "删除");
});
test("matrix refuses sibling Topic, and latest N never includes it", () => {
  const cache = session.createCache(), a = make([{ device: "A" }, { device: "A", status: "run" }]), b = make([{ device: "B" }], "demo/site/device/B")[0]; b.event.id = "b";
  cache.append(a[0].event); cache.append(b.event); cache.append(a[1].event);
  assert.deepEqual(cache.latest(10, config.topicGroup, config.topic).map(row => row.event.id), ["m0", "m1"]);
  assert.equal(cache.topics().length, 2);
  assert.throws(() => matrix([...a, b]), /完整 Topic/);
  assert.throws(() => session.buildExport("raw", [...a, b], null, config, "test"), /完整 Topic/);
});
test("matrix keeps malformed payload rows and breaks continuity, without guessing device identity", () => {
  const input = make([{ device: "A", status: 0 }, {}, { device: "A", status: 2 }]); input[1].event.packet.payloadText = "not JSON";
  const before = JSON.stringify(input), result = matrix(input);
  assert.equal(result.rows.length, 3); assert.equal(result.rows[1].valid, false); assert.match(result.rows[1].reason, /非 JSON/);
  assert.equal(result.rows[2].beforeId, null); assert.equal(result.rows[2].cells[0].changed, false);
  const unconfigured = matrix(make([{ status: 0 }, { status: 1 }]), { ...config, devicePath: "" });
  assert.equal(unconfigured.rows[1].cells[0].value, 1); assert.equal(unconfigured.rows[1].cells[0].changed, false);
  assert.equal(JSON.stringify(input), before);
});
test("matrix compares same device only, bounds columns and marks all-field truncation", () => {
  const input = make([{ device: "A", status: 0 }, { device: "B", status: 50 }, { device: "A", status: 1 }]), result = matrix(input);
  assert.equal(result.rows[1].beforeId, null); assert.equal(result.rows[2].beforeId, "m0");
  assert.throws(() => matrix(input, { ...config, fields: Array.from({ length: 101 }, (_, i) => "field" + i) }), /字段过多/);
  const wide = matrix(make([Object.fromEntries(Array.from({ length: 150 }, (_, i) => ["field" + i, i]))]), { ...config, fields: [] });
  assert.equal(wide.columns.length, 100); assert.equal(wide.limited, true); assert.match(wide.limitReason, /上限/);
  const ignored = matrix(make([{ device: "A", data: { battery: 1 } }]), { ...config, fields: [], ignorePaths: ["data"] });
  assert.deepEqual(ignored.columns, ["/device"]);
  const explicitIgnored = matrix(make([{ device: "A", data: { battery: 1 } }, { device: "A", data: { battery: 2 } }]), { ...config, fields: ["data", "data.battery"], ignorePaths: ["data.battery"] });
  assert.deepEqual(explicitIgnored.rows[1].cells.map(cell => cell.changed), [false, false]);
  assert.equal(explicitIgnored.rows[1].cells[1].value, 2);
});
test("focused change reports include chosen paths only and structured values ignore key order", () => {
  const input = make([{ device: "A", status: 0, unrelated: 0, obj: { a: 1, b: 2 } }, { device: "A", status: 1, unrelated: 1, obj: { b: 2, a: 1 } }]);
  const report = session.analyze(input, config);
  assert.deepEqual(report.changes.map(change => change.path), ["/status"]);
  const result = matrix(input, { ...config, fields: ["obj"] });
  assert.equal(result.rows[1].cells[0].changed, false);
});
test("complete Topic device mode ignores payload IDs and isolates source, connection and direction", () => {
  const input = make(Array.from({ length: 6 }, (_, i) => ({ device: "payload-" + i, status: i })));
  input[2].event.connectionId = "other-connection";
  input[3].event.sourceTab = { id: 2 };
  input[4].event.direction = "outgoing";
  const settings = { ...config, devicePath: "", topicIsObject: true, identityRule: "complete-topic", fields: ["status"] };
  const table = matrix(input, settings), report = session.analyze(input, settings);
  assert.deepEqual(table.rows.map(row => row.beforeId), [null, "m0", null, null, null, "m1"]);
  assert.deepEqual(report.pairs.map(pair => [pair.beforeId, pair.afterId]), [["m0", "m1"], ["m1", "m5"]]);
  assert.equal(report.counts.objects, 4);
  assert.equal(table.rows[1].cells[0].changed, true);
  assert.equal(table.rows[5].cells[0].changed, true);
});
