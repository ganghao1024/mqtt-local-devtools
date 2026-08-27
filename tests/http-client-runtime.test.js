"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRequestUrl,
  formatResponseBody,
  parseCurl,
  prepareHeaders,
  tokenizeCurl
} = require("../http-client-runtime.js");

test("tokenizes Chrome copy-as-cURL bash syntax without executing it", () => {
  assert.deepEqual(tokenizeCurl(`curl 'http://localhost:4300/api/list' \\
    -H 'Content-Type: application/json' \\
    --data-raw '{"name":"设备 A"}'`), [
    "curl",
    "http://localhost:4300/api/list",
    "-H",
    "Content-Type: application/json",
    "--data-raw",
    '{"name":"设备 A"}'
  ]);
});

test("parses method URL params headers and JSON body from cURL", () => {
  const parsed = parseCurl(`curl 'http://localhost:4300/api/list?page=1&page=2' \\
    -H 'Authorization: Bearer test-token' \\
    -H 'Content-Type: application/json' \\
    --data-raw '{"enabled":true}'`);

  assert.equal(parsed.method, "POST");
  assert.equal(parsed.url, "http://localhost:4300/api/list");
  assert.deepEqual(parsed.params, [
    { enabled: true, name: "page", value: "1" },
    { enabled: true, name: "page", value: "2" }
  ]);
  assert.deepEqual(parsed.headers[0], {
    enabled: true,
    name: "Authorization",
    value: "Bearer test-token"
  });
  assert.equal(parsed.body, '{"enabled":true}');
  assert.equal(parsed.bodyType, "json");
});

test("supports cmd-style compact method and header flags", () => {
  const parsed = parseCurl('curl.exe "https://example.com/items?q=x" -XPOST -H"X-Test: yes" -d "a=1"');
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.headers[0].name, "X-Test");
  assert.equal(parsed.body, "a=1");
});

test("builds an encoded request URL from editable parameter rows", () => {
  assert.equal(
    buildRequestUrl("https://example.com/items", [
      { enabled: true, name: "keyword", value: "无人机 A" },
      { enabled: false, name: "skip", value: "1" },
      { enabled: true, name: "empty", value: "" }
    ]),
    "https://example.com/items?keyword=%E6%97%A0%E4%BA%BA%E6%9C%BA+A&empty="
  );
});

test("skips browser-forbidden headers while preserving normal headers", () => {
  const result = prepareHeaders([
    { enabled: true, name: "Authorization", value: "Bearer value" },
    { enabled: true, name: "Cookie", value: "session=secret" },
    { enabled: true, name: "Sec-Fetch-Site", value: "same-origin" },
    { enabled: false, name: "X-Disabled", value: "no" }
  ]);
  assert.deepEqual(result.headers, [{ name: "Authorization", value: "Bearer value" }]);
  assert.deepEqual(result.skipped.map((item) => item.name), ["Cookie", "Sec-Fetch-Site"]);
});

test("pretty-prints JSON responses and keeps plain text unchanged", () => {
  assert.deepEqual(formatResponseBody('{"ok":true}', "application/json"), {
    text: '{\n  "ok": true\n}',
    format: "json"
  });
  assert.deepEqual(formatResponseBody("plain response", "text/plain"), {
    text: "plain response",
    format: "text"
  });
});
