"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("connection and topic sections own independent clipped scroll viewports", () => {
  const css = fs.readFileSync(path.join(root, "panel.css"), "utf8");

  assert.match(css, /\.connection-section\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.topic-section\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.section-heading\s*\{[^}]*flex:\s*0\s+0\s+38px/s);
  assert.match(css, /\.connections-list\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*min-height:\s*0[^}]*overflow:\s*auto/s);
  assert.match(css, /\.topic-groups\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*min-height:\s*0[^}]*overflow:\s*auto/s);
});
