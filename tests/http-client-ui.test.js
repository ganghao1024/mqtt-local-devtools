"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const panelHtml = fs.readFileSync(path.join(projectRoot, "panel.html"), "utf8");
const panelCss = fs.readFileSync(path.join(projectRoot, "panel.css"), "utf8");
const panelScript = fs.readFileSync(path.join(projectRoot, "http-client.js"), "utf8");

test("HTTP module exposes cURL import, editable request parts and response panels", () => {
  for (const id of [
    "httpModuleButton",
    "curlInput",
    "httpMethod",
    "httpUrl",
    "paramsRows",
    "headersRows",
    "httpBody",
    "sendHttpButton",
    "responseBody",
    "responseHeaders"
  ]) {
    assert.match(panelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(panelHtml, /http-client-runtime\.js/);
  assert.match(panelHtml, /http-client\.js/);
});

test("HTTP module keeps request and response content in clipped scroll regions", () => {
  assert.match(panelCss, /\.http-workspace\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(panelCss, /\.request-editor\s*\{[^}]*overflow:\s*auto/s);
  assert.match(panelCss, /\.response-panel\s*\{[^}]*overflow:\s*auto/s);
});

test("HTTP panes expose accessible vertical resizers with persisted keyboard and pointer controls", () => {
  for (const id of ["httpTopResizer", "httpBottomResizer"]) {
    assert.match(panelHtml, new RegExp(`id="${id}"[\\s\\S]*?role="separator"[\\s\\S]*?tabindex="0"`));
  }
  assert.match(panelHtml, /aria-orientation="horizontal"/);
  assert.match(panelCss, /\.http-pane-resizer\s*\{[^}]*cursor:\s*row-resize/s);
  assert.match(panelScript, /installHttpPaneResizer\(elements\.httpTopResizer, "top"\)/);
  assert.match(panelScript, /installHttpPaneResizer\(elements\.httpBottomResizer, "bottom"\)/);
  assert.match(panelScript, /handle\.addEventListener\("pointerdown"/);
  assert.match(panelScript, /event\.key !== "ArrowUp" && event\.key !== "ArrowDown"/);
  assert.match(panelScript, /handle\.addEventListener\("dblclick", resetHttpPaneHeights\)/);
  assert.match(panelScript, /localStorage\.setItem\(HTTP_PANE_STORAGE_KEY/);
});

test("pasting cURL parses without sending and explicit submit performs fetch", () => {
  const pasteListener = panelScript.indexOf('curlInput.addEventListener("paste"');
  const parseCall = panelScript.indexOf("parseCurlInput();", pasteListener);
  const submitListener = panelScript.indexOf('httpRequestForm.addEventListener("submit"');
  const sendCall = panelScript.indexOf("sendRequest();", submitListener);
  assert.ok(pasteListener >= 0 && parseCall > pasteListener);
  assert.ok(submitListener > parseCall && sendCall > submitListener);
  assert.doesNotMatch(panelScript.slice(pasteListener, submitListener), /sendRequest\(/);
});
