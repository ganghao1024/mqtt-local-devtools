"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("packet details use a dedicated native scroll viewport", () => {
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "panel.css"), "utf8");
  const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");

  assert.match(html, /id="detailsScroll" class="details-scroll" tabindex="0"/);
  assert.doesNotMatch(html, /id="scroll(?:Top|Bottom)Button"/);
  assert.match(css, /\.workspace\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.details-scroll\s*\{[^}]*overflow:\s*auto/s);
  assert.doesNotMatch(script, /addEventListener\("wheel"/);
  assert.match(script, /document\.querySelector\("#detailsScroll"\)/);
  assert.doesNotMatch(script, /pointerenter[^\n]*pointerLocked/s);
});
