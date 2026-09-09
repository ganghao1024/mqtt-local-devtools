const test = require('node:test');
const assert = require('node:assert/strict');
const { createPayloadClassifier } = require('../panel-runtime.js');
const event = value => ({ packet: { payloadText: JSON.stringify(value) } });

test('groups nested exact field names without matching batterySn or psdk_sn', () => {
  const classify = createPayloadClassifier('sn');
  assert.deepEqual(classify(event({data: {sn: 'demo-A', batterySn: 'battery', psdk_sn: 'speaker'}})), ['"demo-A"']);
  assert.deepEqual(classify(event({data: [{sn: 'demo-B'}, {sn: 'demo-A'}, {sn: 'demo-A'}]})), ['"demo-A"', '"demo-B"']);
});
test('explicit paths distinguish nested fields and traverse arrays', () => {
  const classify = createPayloadClassifier('data.sn');
  assert.deepEqual(classify(event({sn: 'outer', data: [{sn: 'inner'}]})), ['"inner"']);
  assert.deepEqual(classify(event({wrapper: {data: {sn: 'other'}}})), ['missing']);
});
test('keeps primitive types distinct and handles missing or invalid JSON', () => {
  const classify = createPayloadClassifier('sn');
  assert.deepEqual(classify(event({sn: [false, 0, '0', '', null]})), ['""', '"0"', '0', 'false']);
  assert.deepEqual(classify({packet: {payloadText: '{broken'}}), ['missing']);
  assert.deepEqual(classify(event({sn: null})), ['missing']);
  assert.deepEqual(classify(event({sn: 'missing'})), ['"missing"']);
});
