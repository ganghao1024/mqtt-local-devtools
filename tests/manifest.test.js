"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

test("manifest uses MV3 and every referenced local file exists", () => {
  assert.equal(manifest.manifest_version, 3);

  const referencedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {}),
    manifest.devtools_page,
    ...manifest.content_scripts.flatMap((entry) => entry.js)
  ];

  for (const filename of new Set(referencedFiles)) {
    assert.equal(fs.existsSync(path.join(projectRoot, filename)), true, `${filename} should exist`);
  }
});

test("default host access covers every HTTP and HTTPS page", () => {
  const allWebPages = ["http://*/*", "https://*/*"];
  assert.deepEqual(manifest.host_permissions, allWebPages);
  assert.ok(manifest.content_scripts.every((entry) => {
    return JSON.stringify(entry.matches) === JSON.stringify(allWebPages);
  }));
  assert.equal(manifest.optional_host_permissions, undefined);
});

test("page hook is injected before app scripts in the MAIN world", () => {
  const mainScript = manifest.content_scripts.find((entry) => entry.world === "MAIN");
  const bridgeScript = manifest.content_scripts.find((entry) => entry.world === "ISOLATED");

  assert.deepEqual(mainScript.js, ["mqtt-decoder.js", "page-hook.js"]);
  assert.equal(mainScript.run_at, "document_start");
  assert.deepEqual(bridgeScript.js, ["ring-buffer.js", "event-batcher.js", "content-bridge.js"]);
  assert.equal(bridgeScript.run_at, "document_start");
});

test("extension version stays synchronized across manifest, package and panel", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const panelHtml = fs.readFileSync(path.join(projectRoot, "panel.html"), "utf8");

  assert.equal(packageJson.version, manifest.version);
  assert.match(panelHtml, new RegExp(`v${manifest.version.replaceAll(".", "\\.")}`));
});
