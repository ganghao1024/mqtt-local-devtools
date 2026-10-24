"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "design-tokens.css"), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
function resolve(name, ancestors = []) {
  assert(!ancestors.includes(name), "Token cycle: " + [...ancestors, name].join(" → "));
  assert(Object.hasOwn(tokens, name), "Unknown token: " + name);
  return tokens[name].replace(/var\((--[\w-]+)\)/g, (_, ref) => resolve(ref, [...ancestors, name]));
}
function luminance(color) {
  assert.match(color, /^#[a-f\d]{6}$/i);
  const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(resolve(a)), luminance(resolve(b))].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
test("shared design tokens have valid aliases and all consumers load the source", () => {
  for (const name of Object.keys(tokens)) resolve(name);
  for (const file of ["panel.html", "popup.html", "tests/panel-harness.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /href="(?:\.\.\/)?design-tokens\.css"/);
    for (const match of html.matchAll(/<link[^>]+href="([^"?#]+\.css)(?:\?[^"#]*)?"/g)) assert(fs.existsSync(path.resolve(root, path.dirname(file), match[1])), `${file}: missing ${match[1]}`);
  }
});
test("brand foreground and base match the current icon artwork", () => {
  const icon = fs.readFileSync(path.join(root, "icons/icon.svg"), "utf8");
  const base = /<rect\b[^>]*\bfill="(#[a-f\d]{6})"/i.exec(icon)?.[1];
  const pulse = /<path\b[^>]*\bstroke="(#[a-f\d]{6})"/i.exec(icon)?.[1];
  assert.equal(resolve("--bg"), base?.toLowerCase(), "workbench and icon share the dark base");
  assert.equal(resolve("--brand"), pulse?.toLowerCase(), "interactive accent matches the icon pulse");
});
test("shared text roles meet contrast on their actual supported dark surfaces", () => {
  for (const text of ["--text", "--text-soft", "--muted", "--muted-2"]) for (const background of ["--bg", "--surface", "--surface-subtle", "--surface-hover", "--surface-selected"]) assert(contrast(text, background) >= 4.5, `${text} on ${background}: ${contrast(text, background)}`);
  for (const [text, background] of [["--action-text", "--action"], ["--action-text", "--action-hover"], ["--blue-bright", "--info-bg"], ["--green-bright", "--success-bg"], ["--warning", "--warning-bg"], ["--danger", "--danger-bg"]]) assert(contrast(text, background) >= 4.5, `${text} on ${background}`);
});
test("focus and control boundaries remain distinguishable from their surfaces", () => {
  for (const background of ["--control-bg", "--surface", "--bg"]) assert(contrast("--focus", background) >= 3, `focus on ${background}`);
  assert(contrast("--control-border", "--control-bg") >= 3, "input boundary contrast");
});
