(function installHttpClientRuntime(globalObject) {
  "use strict";

  const FORBIDDEN_HEADER_NAMES = new Set([
    "accept-charset",
    "accept-encoding",
    "access-control-request-headers",
    "access-control-request-method",
    "connection",
    "content-length",
    "cookie",
    "cookie2",
    "date",
    "expect",
    "host",
    "keep-alive",
    "origin",
    "referer",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "user-agent",
    "via"
  ]);

  function normalizeCurlCommand(command) {
    return String(command || "")
      .replace(/\\\r?\n\s*/g, " ")
      .replace(/\^\r?\n\s*/g, " ")
      .trim();
  }

  function tokenizeCurl(command) {
    const source = normalizeCurlCommand(command);
    const tokens = [];
    let token = "";
    let quote = null;
    let escaping = false;
    let tokenStarted = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (escaping) {
        token += character;
        tokenStarted = true;
        escaping = false;
        continue;
      }
      if (quote === "'") {
        if (character === "'") quote = null;
        else token += character;
        tokenStarted = true;
        continue;
      }
      if (quote === '"') {
        if (character === '"') {
          quote = null;
        } else if (character === "\\" && /["\\$`]/.test(source[index + 1] || "")) {
          escaping = true;
        } else {
          token += character;
        }
        tokenStarted = true;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        tokenStarted = true;
        continue;
      }
      if (character === "\\" || character === "^") {
        escaping = true;
        tokenStarted = true;
        continue;
      }
      if (/\s/.test(character)) {
        if (tokenStarted) {
          tokens.push(token);
          token = "";
          tokenStarted = false;
        }
        continue;
      }
      token += character;
      tokenStarted = true;
    }

    if (escaping) token += "\\";
    if (quote) throw new Error("cURL 中存在未闭合的引号。");
    if (tokenStarted) tokens.push(token);
    return tokens;
  }

  function headerRow(value) {
    const separator = value.indexOf(":");
    if (separator < 0) return { enabled: true, name: value.trim(), value: "" };
    return {
      enabled: true,
      name: value.slice(0, separator).trim(),
      value: value.slice(separator + 1).trim()
    };
  }

  function splitUrlAndParams(value) {
    try {
      const parsed = new URL(value);
      const params = Array.from(parsed.searchParams, ([name, paramValue]) => ({
        enabled: true,
        name,
        value: paramValue
      }));
      parsed.search = "";
      return { url: parsed.toString(), params };
    } catch {
      return { url: value, params: [] };
    }
  }

  function parseCurl(command) {
    const tokens = tokenizeCurl(command);
    while (tokens[0] === "$" || tokens[0] === ">") tokens.shift();
    if (!/^curl(?:\.exe)?$/i.test(tokens.shift() || "")) {
      throw new Error("内容必须以 curl 或 curl.exe 开头。");
    }

    let explicitMethod = "";
    let url = "";
    let body = "";
    let useGet = false;
    let headOnly = false;
    const dataParts = [];
    const headers = [];
    const warnings = [];
    const ignoredOptionsWithValue = new Set([
      "--connect-timeout", "--max-time", "--output", "-o", "--proxy", "-x",
      "--resolve", "--retry", "--retry-delay", "--user-agent", "-A"
    ]);

    function takeValue(index, inlineValue, option) {
      if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
      if (index + 1 >= tokens.length) throw new Error(`${option} 缺少参数值。`);
      return { value: tokens[index + 1], nextIndex: index + 1 };
    }

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const equalsIndex = token.indexOf("=");
      const option = equalsIndex > 0 ? token.slice(0, equalsIndex) : token;
      const inlineValue = equalsIndex > 0 ? token.slice(equalsIndex + 1) : undefined;

      if (option === "--request" || option === "-X" || (/^-X.+/.test(option) && option !== "-X")) {
        if (option.startsWith("-X") && option.length > 2) {
          explicitMethod = option.slice(2);
        } else {
          const result = takeValue(index, inlineValue, option);
          explicitMethod = result.value;
          index = result.nextIndex;
        }
        continue;
      }
      if (option === "--header" || option === "-H" || (/^-H.+/.test(option) && option !== "-H")) {
        const result = option.startsWith("-H") && option.length > 2
          ? { value: option.slice(2), nextIndex: index }
          : takeValue(index, inlineValue, option);
        headers.push(headerRow(result.value));
        index = result.nextIndex;
        continue;
      }
      if (["--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode", "-d"].includes(option)) {
        const result = takeValue(index, inlineValue, option);
        dataParts.push(result.value);
        index = result.nextIndex;
        continue;
      }
      if (option === "--url") {
        const result = takeValue(index, inlineValue, option);
        url = result.value;
        index = result.nextIndex;
        continue;
      }
      if (option === "--cookie" || option === "-b") {
        const result = takeValue(index, inlineValue, option);
        headers.push({ enabled: true, name: "Cookie", value: result.value });
        index = result.nextIndex;
        continue;
      }
      if (option === "--get" || option === "-G") {
        useGet = true;
        continue;
      }
      if (option === "--head" || option === "-I") {
        headOnly = true;
        continue;
      }
      if (option === "--form" || option === "-F") {
        const result = takeValue(index, inlineValue, option);
        warnings.push(`暂不支持 multipart 表单参数：${result.value}`);
        index = result.nextIndex;
        continue;
      }
      if (ignoredOptionsWithValue.has(option)) {
        const result = takeValue(index, inlineValue, option);
        warnings.push(`已忽略 cURL 选项：${option} ${result.value}`);
        index = result.nextIndex;
        continue;
      }
      if (token.startsWith("-")) {
        if (!["--compressed", "--insecure", "-k", "--location", "-L", "--silent", "-s"].includes(token)) {
          warnings.push(`已忽略 cURL 选项：${token}`);
        }
        continue;
      }
      if (!url) url = token;
    }

    if (!url) throw new Error("cURL 中没有找到请求 URL。");
    const split = splitUrlAndParams(url);
    let params = split.params;
    if (dataParts.length) {
      body = dataParts.join("&");
      if (useGet) {
        const extra = new URLSearchParams(body);
        params = params.concat(Array.from(extra, ([name, value]) => ({ enabled: true, name, value })));
        body = "";
      }
    }

    let method = explicitMethod.trim().toUpperCase();
    if (!method) method = headOnly ? "HEAD" : body ? "POST" : "GET";
    const contentType = headers.find((item) => item.name.toLowerCase() === "content-type")?.value || "";
    const bodyType = !body ? "none" : /json/i.test(contentType) ? "json" : "text";
    return {
      method,
      url: split.url,
      params,
      headers,
      body,
      bodyType,
      warnings
    };
  }

  function buildRequestUrl(value, params) {
    const parsed = new URL(String(value || "").trim());
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("只支持 http:// 或 https:// 请求。");
    for (const param of params || []) {
      if (param?.enabled === false || !String(param?.name || "").trim()) continue;
      parsed.searchParams.append(String(param.name), String(param.value ?? ""));
    }
    return parsed.toString();
  }

  function isForbiddenHeader(name) {
    const normalized = String(name || "").trim().toLowerCase();
    return FORBIDDEN_HEADER_NAMES.has(normalized)
      || normalized.startsWith("proxy-")
      || normalized.startsWith("sec-");
  }

  function prepareHeaders(rows) {
    const headers = [];
    const skipped = [];
    for (const row of rows || []) {
      const name = String(row?.name || "").trim();
      if (row?.enabled === false || !name) continue;
      const value = String(row?.value ?? "");
      if (isForbiddenHeader(name)) skipped.push({ name, value });
      else headers.push({ name, value });
    }
    return { headers, skipped };
  }

  function formatResponseBody(text, contentType = "") {
    const source = String(text ?? "");
    if (/json|\+json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(source)) {
      try {
        return { text: JSON.stringify(JSON.parse(source), null, 2), format: "json" };
      } catch {
        // Keep invalid or JSON-like text unchanged.
      }
    }
    return { text: source, format: "text" };
  }

  const api = Object.freeze({
    buildRequestUrl,
    formatResponseBody,
    isForbiddenHeader,
    normalizeCurlCommand,
    parseCurl,
    prepareHeaders,
    splitUrlAndParams,
    tokenizeCurl
  });
  globalObject.__MQTT_LOCAL_DEVTOOLS_HTTP_CLIENT_RUNTIME__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
