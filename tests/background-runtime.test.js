"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  enrichEventWithTab,
  isLocalDevelopmentUrl,
  shouldDeliverEvent
} = require("../background-runtime.js");

test("recognizes local development URLs across ports", () => {
  assert.equal(isLocalDevelopmentUrl("http://localhost:4300/#/dashboard"), true);
  assert.equal(isLocalDevelopmentUrl("http://localhost:5050/uav-platform/"), true);
  assert.equal(isLocalDevelopmentUrl("https://127.0.0.1:8443/mqtt"), true);
  assert.equal(isLocalDevelopmentUrl("https://example.com/"), false);
});

test("local MQTT events are delivered to DevTools panels on other local tabs", () => {
  assert.equal(shouldDeliverEvent({
    sourceTabId: 5050,
    sourceUrl: "http://localhost:5050/uav-platform/",
    panelTabId: 4300,
    panelUrl: "http://localhost:4300/#/dashboard"
  }), true);
});

test("non-local events stay isolated to their own inspected tab", () => {
  assert.equal(shouldDeliverEvent({
    sourceTabId: 2,
    sourceUrl: "https://internal.example.com/app",
    panelTabId: 3,
    panelUrl: "https://internal.example.com/other"
  }), false);
  assert.equal(shouldDeliverEvent({
    sourceTabId: 2,
    sourceUrl: "https://internal.example.com/app",
    panelTabId: 2,
    panelUrl: "https://internal.example.com/app"
  }), true);
});

test("events include their source tab metadata", () => {
  const event = enrichEventWithTab(
    { id: "event-1", kind: "packet", pageUrl: "http://localhost:5050/uav-platform/" },
    { id: 88, title: "飞控平台", url: "http://localhost:5050/uav-platform/" }
  );

  assert.deepEqual(event.sourceTab, {
    id: 88,
    title: "飞控平台",
    url: "http://localhost:5050/uav-platform/"
  });
});
