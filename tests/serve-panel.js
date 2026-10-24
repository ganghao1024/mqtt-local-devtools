// node tests/serve-panel.js; browser harness: http://127.0.0.1:8174/tests/analysis-panel.html
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  if (pathname === "/echo") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, method: req.method }));
    return;
  }
  if (pathname === "/tests/analysis-panel.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fs.readFileSync(path.join(root, "panel.html"), "utf8")
      .replace('<head>', '<head><base href="/">')
      .replace('<script src="ring-buffer.js">', '<script src="tests/analysis-harness.js"></script><script src="ring-buffer.js">')
      .replace('</body>', new URL(req.url, 'http://localhost').searchParams.get('experiment') === 'matrix' ? '<script src="tests/analysis-matrix-demo.js"></script></body>' : '</body>'));
    return;
  }
  const file = path.resolve(root, "." + decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(8174, "127.0.0.1", () => console.log("Panel harness: http://127.0.0.1:8174/tests/analysis-panel.html"));
