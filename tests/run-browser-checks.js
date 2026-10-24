const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const session = "-s=mqtt-analysis-check";
const server = spawn(process.execPath, [path.join(__dirname, "serve-panel.js")], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let started = false;
function cli(args) {
  // All command arguments below are fixed repository filenames, not user input.
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `playwright-cli ${session} ${args.join(" ")}`], { cwd: root, encoding: "utf8", windowsHide: true })
    : spawnSync("playwright-cli", [session, ...args], { cwd: root, encoding: "utf8" });
  const output = (result.stdout || "") + (result.stderr || "");
  if (result.error || result.status !== 0 || output.includes("### Error")) throw new Error(output || String(result.error));
  return output;
}
server.once("error", error => { console.error(error); process.exitCode = 1; });
server.stderr.on("data", data => process.stderr.write(data));
server.stdout.on("data", () => {
  if (started) return;
  started = true;
  try {
    cli(["open"]);
    for (const file of ["analysis-stage1", "analysis-batch", "analysis-topic-scope", "analysis-matrix", "analysis-freeze", "analysis-regression"]) {
      const output = cli(["run-code", `--filename=tests/${file}.browser.js`]);
      if (!output.includes('"passed"')) throw new Error(output);
      console.log(`${file}: ${output.split("### Result")[1]?.split("### Ran")[0].trim()}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { try { cli(["close"]); } catch {} server.kill(); }
});
server.once("exit", code => { if (!started) { console.error("测试服务器未启动（请检查 8174 端口）"); process.exitCode = code || 1; } });
