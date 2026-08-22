"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("time order can be selected and persisted", () => {
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(html, /id="timeOrderFilter"[^>]*aria-label="时间排序"/);
  assert.match(html, /option value="desc"[^>]*>最新在前<\/option>/);
  assert.match(html, /option value="asc"[^>]*>最早在前<\/option>/);
  assert.match(script, /localStorage\.getItem\(TIME_ORDER_STORAGE_KEY\)/);
  assert.match(script, /localStorage\.setItem\(TIME_ORDER_STORAGE_KEY,/);
});

test("packet details expose keyword search and match navigation", () => {
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(html, /id="detailsSearchInput"[^>]*placeholder="搜索 Payload 关键字"/);
  assert.match(html, /id="detailsSearchCount"/);
  assert.match(script, /detailsSearchInput\.addEventListener\("input"/);
  assert.match(script, /detailsSearchInput\.addEventListener\("keydown"/);
});

test("product layout exposes live status, topic groups and structured details", () => {
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(html, /id="headerStats"/);
  assert.match(html, /id="topicGroupsList"/);
  assert.match(html, /id="metadataCard"/);
  assert.match(html, /id="payloadCard"/);
  assert.match(html, /id="rawDetailsCard"/);
  assert.match(script, /currentPacketRate\(\)/);
  assert.match(script, /state\.topicIndex\.groups\(/);
});

test("three panes expose accessible draggable separators with persisted widths", () => {
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "panel.css"), "utf8");
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(html, /id="leftPaneResizer"[^>]*role="separator"[^>]*tabindex="0"/s);
  assert.match(html, /id="rightPaneResizer"[^>]*role="separator"[^>]*tabindex="0"/s);
  assert.match(css, /\.workspace\s*\{[^}]*--left-pane-width[^}]*--right-pane-width/s);
  assert.match(css, /\.pane-resizer\s*\{[^}]*cursor:\s*col-resize/s);
  assert.match(script, /addEventListener\("pointerdown"/);
  assert.match(script, /addEventListener\("keydown"/);
  assert.match(script, /localStorage\.setItem\(PANE_WIDTH_STORAGE_KEY/);
});

test("topic groups expose expandable child topic filters", () => {
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(script, /className = "topic-expand-button"/);
  assert.match(script, /setAttribute\("aria-expanded"/);
  assert.match(script, /className = "topic-child"/);
  assert.match(script, /state\.selectedTopic = topic\.name/);
});

test("MQTT packet types include Chinese descriptions in filters and rows", () => {
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(html, /option value="CONNECT">CONNECT\(连接\)<\/option>/);
  assert.match(html, /option value="PUBLISH">PUBLISH\(发布消息\)<\/option>/);
  assert.match(html, /option value="SUBSCRIBE">SUBSCRIBE\(订阅主题\)<\/option>/);
  assert.match(script, /const MQTT_TYPE_DESCRIPTIONS = Object\.freeze/);
  assert.match(script, /typeCell\.textContent = packetTypeLabel\(packet\.typeName\)/);
});

test("packet status distinguishes retained cache from cumulative receives", () => {
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(script, /receivedPacketCount/);
  assert.match(script, /const packetStats = "缓存 "/);
  assert.match(script, /state\.events\.append\(event, byteSize\)/);
  assert.match(script, /MAX_STORED_BYTES = 32 \* 1024 \* 1024/);
});

test("high-volume rendering is throttled, searchable and virtualized", () => {
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "panel.css"), "utf8");

  assert.match(script, /UI_RENDER_INTERVAL_MS = 125/);
  assert.match(script, /SEARCH_DEBOUNCE_MS = 150/);
  assert.match(script, /searchTextByEventId/);
  assert.match(script, /virtualWindow\(state\.filteredPacketView/);
  assert.match(css, /tbody tr\.virtual-spacer/);
});
