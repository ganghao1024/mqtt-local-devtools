"use strict";

(function installHttpClient() {
  const runtime = globalThis.__MQTT_LOCAL_DEVTOOLS_HTTP_CLIENT_RUNTIME__;
  const MAX_RENDERED_RESPONSE_CHARS = 5 * 1024 * 1024;
  const MODULE_STORAGE_KEY = "mqtt-local-devtools-active-module";
  const HTTP_PANE_STORAGE_KEY = "mqtt-local-devtools-http-pane-heights";
  const HTTP_PANE_DEFAULTS = Object.freeze({ importHeight: 148, requestHeight: 266 });
  const HTTP_PANE_MINIMUMS = Object.freeze({ importHeight: 96, requestHeight: 150, responseHeight: 100 });
  const state = {
    module: "mqtt",
    params: [],
    headers: [],
    paneHeights: { ...HTTP_PANE_DEFAULTS },
    controller: null,
    responseCopyText: "",
    activeRequestTab: "params",
    activeResponseTab: "body"
  };

  const elements = {
    mqttModuleButton: document.querySelector("#mqttModuleButton"),
    httpModuleButton: document.querySelector("#httpModuleButton"),
    mqttHeaderActions: document.querySelector("#mqttHeaderActions"),
    mqttWorkspace: document.querySelector("#mqttWorkspace"),
    httpWorkspace: document.querySelector("#httpWorkspace"),
    curlImportCard: document.querySelector("#curlImportCard"),
    httpRequestCard: document.querySelector("#httpRequestCard"),
    httpResponseCard: document.querySelector("#httpResponseCard"),
    httpTopResizer: document.querySelector("#httpTopResizer"),
    httpBottomResizer: document.querySelector("#httpBottomResizer"),
    mqttFooterStatus: document.querySelector("#mqttFooterStatus"),
    httpFooterStatus: document.querySelector("#httpFooterStatus"),
    packetCount: document.querySelector("#packetCount"),
    shortcuts: document.querySelector(".shortcuts"),
    httpStatusText: document.querySelector("#httpStatusText"),
    curlInput: document.querySelector("#curlInput"),
    parseCurlButton: document.querySelector("#parseCurlButton"),
    clearHttpButton: document.querySelector("#clearHttpButton"),
    curlParseStatus: document.querySelector("#curlParseStatus"),
    httpRequestForm: document.querySelector("#httpRequestForm"),
    httpMethod: document.querySelector("#httpMethod"),
    httpUrl: document.querySelector("#httpUrl"),
    sendHttpButton: document.querySelector("#sendHttpButton"),
    cancelHttpButton: document.querySelector("#cancelHttpButton"),
    paramsTabButton: document.querySelector("#paramsTabButton"),
    headersTabButton: document.querySelector("#headersTabButton"),
    bodyTabButton: document.querySelector("#bodyTabButton"),
    paramsEditor: document.querySelector("#paramsEditor"),
    headersEditor: document.querySelector("#headersEditor"),
    bodyEditor: document.querySelector("#bodyEditor"),
    paramsRows: document.querySelector("#paramsRows"),
    headersRows: document.querySelector("#headersRows"),
    paramsCount: document.querySelector("#paramsCount"),
    headersCount: document.querySelector("#headersCount"),
    bodyCount: document.querySelector("#bodyCount"),
    addParamButton: document.querySelector("#addParamButton"),
    addHeaderButton: document.querySelector("#addHeaderButton"),
    bodyType: document.querySelector("#bodyType"),
    httpBody: document.querySelector("#httpBody"),
    formatBodyButton: document.querySelector("#formatBodyButton"),
    responseStatusBadge: document.querySelector("#responseStatusBadge"),
    responseMeta: document.querySelector("#responseMeta"),
    responseBodyTabButton: document.querySelector("#responseBodyTabButton"),
    responseHeadersTabButton: document.querySelector("#responseHeadersTabButton"),
    responseBodyPanel: document.querySelector("#responseBodyPanel"),
    responseHeadersPanel: document.querySelector("#responseHeadersPanel"),
    responseBody: document.querySelector("#responseBody"),
    responseHeaders: document.querySelector("#responseHeaders"),
    responseHeadersCount: document.querySelector("#responseHeadersCount"),
    copyResponseButton: document.querySelector("#copyResponseButton")
  };

  function setActiveModule(moduleName, options = {}) {
    const module = moduleName === "http" ? "http" : "mqtt";
    const httpActive = module === "http";
    state.module = module;
    document.body.dataset.activeModule = module;
    elements.mqttModuleButton.classList.toggle("selected", !httpActive);
    elements.mqttModuleButton.setAttribute("aria-selected", String(!httpActive));
    elements.httpModuleButton.classList.toggle("selected", httpActive);
    elements.httpModuleButton.setAttribute("aria-selected", String(httpActive));
    elements.mqttHeaderActions.classList.toggle("hidden", httpActive);
    elements.mqttWorkspace.classList.toggle("hidden", httpActive);
    elements.httpWorkspace.classList.toggle("hidden", !httpActive);
    elements.mqttFooterStatus.classList.toggle("hidden", httpActive);
    elements.httpFooterStatus.classList.toggle("hidden", !httpActive);
    elements.packetCount.classList.toggle("hidden", httpActive);
    elements.shortcuts.classList.toggle("hidden", httpActive);
    if (httpActive) applyHttpPaneHeights();
    if (options.persist !== false) {
      try {
        localStorage.setItem(MODULE_STORAGE_KEY, module);
      } catch {
        // Module selection still applies to the current session.
      }
    }
    if (httpActive && options.focus !== false) elements.curlInput.focus();
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function availableHttpPaneHeight() {
    const dividerHeight = elements.httpTopResizer.offsetHeight + elements.httpBottomResizer.offsetHeight;
    return Math.max(1, elements.httpWorkspace.clientHeight - dividerHeight);
  }

  function scaledHttpPaneMinimums(totalHeight) {
    const minimumTotal = HTTP_PANE_MINIMUMS.importHeight
      + HTTP_PANE_MINIMUMS.requestHeight
      + HTTP_PANE_MINIMUMS.responseHeight;
    if (totalHeight >= minimumTotal) return { ...HTTP_PANE_MINIMUMS };
    const importHeight = Math.max(1, Math.floor(totalHeight * HTTP_PANE_MINIMUMS.importHeight / minimumTotal));
    const requestHeight = Math.max(1, Math.floor(totalHeight * HTTP_PANE_MINIMUMS.requestHeight / minimumTotal));
    return {
      importHeight,
      requestHeight,
      responseHeight: Math.max(1, totalHeight - importHeight - requestHeight)
    };
  }

  function constrainHttpPaneHeights(importHeight, requestHeight) {
    const totalHeight = availableHttpPaneHeight();
    const minimums = scaledHttpPaneMinimums(totalHeight);
    const maxImportHeight = Math.max(
      minimums.importHeight,
      totalHeight - minimums.requestHeight - minimums.responseHeight
    );
    const constrainedImport = clamp(
      Number.isFinite(importHeight) ? importHeight : HTTP_PANE_DEFAULTS.importHeight,
      minimums.importHeight,
      maxImportHeight
    );
    const maxRequestHeight = Math.max(
      minimums.requestHeight,
      totalHeight - constrainedImport - minimums.responseHeight
    );
    const constrainedRequest = clamp(
      Number.isFinite(requestHeight) ? requestHeight : HTTP_PANE_DEFAULTS.requestHeight,
      minimums.requestHeight,
      maxRequestHeight
    );
    return {
      importHeight: constrainedImport,
      requestHeight: constrainedRequest,
      responseHeight: Math.max(0, totalHeight - constrainedImport - constrainedRequest),
      minimums,
      totalHeight
    };
  }

  function applyHttpPaneHeights() {
    if (!elements.httpWorkspace.clientHeight) return;
    const constrained = constrainHttpPaneHeights(
      state.paneHeights.importHeight,
      state.paneHeights.requestHeight
    );
    state.paneHeights = {
      importHeight: constrained.importHeight,
      requestHeight: constrained.requestHeight
    };
    elements.httpWorkspace.style.setProperty("--http-import-height", `${constrained.importHeight}px`);
    elements.httpWorkspace.style.setProperty("--http-request-height", `${constrained.requestHeight}px`);

    elements.httpTopResizer.setAttribute("aria-valuemin", String(constrained.minimums.importHeight));
    elements.httpTopResizer.setAttribute(
      "aria-valuemax",
      String(Math.round(constrained.totalHeight - constrained.minimums.requestHeight - constrained.minimums.responseHeight))
    );
    elements.httpTopResizer.setAttribute("aria-valuenow", String(Math.round(constrained.importHeight)));
    elements.httpTopResizer.setAttribute("aria-valuetext", `cURL 导入区域 ${Math.round(constrained.importHeight)} 像素`);

    elements.httpBottomResizer.setAttribute("aria-valuemin", String(constrained.minimums.requestHeight));
    elements.httpBottomResizer.setAttribute(
      "aria-valuemax",
      String(Math.round(constrained.totalHeight - constrained.importHeight - constrained.minimums.responseHeight))
    );
    elements.httpBottomResizer.setAttribute("aria-valuenow", String(Math.round(constrained.requestHeight)));
    elements.httpBottomResizer.setAttribute("aria-valuetext", `请求配置区域 ${Math.round(constrained.requestHeight)} 像素`);
  }

  function saveHttpPaneHeights() {
    try {
      localStorage.setItem(HTTP_PANE_STORAGE_KEY, JSON.stringify({
        importHeight: Math.round(state.paneHeights.importHeight),
        requestHeight: Math.round(state.paneHeights.requestHeight)
      }));
    } catch {
      // Heights still apply to the current DevTools session.
    }
  }

  function loadHttpPaneHeights() {
    try {
      const saved = JSON.parse(localStorage.getItem(HTTP_PANE_STORAGE_KEY) || "null");
      if (Number.isFinite(saved?.importHeight) && Number.isFinite(saved?.requestHeight)) {
        return { importHeight: saved.importHeight, requestHeight: saved.requestHeight };
      }
    } catch {
      // Keep the default heights when storage is unavailable or invalid.
    }
    return { ...HTTP_PANE_DEFAULTS };
  }

  function resetHttpPaneHeights() {
    state.paneHeights = { ...HTTP_PANE_DEFAULTS };
    applyHttpPaneHeights();
    saveHttpPaneHeights();
  }

  function resizeHttpPanePair(position, delta) {
    const constrained = constrainHttpPaneHeights(
      state.paneHeights.importHeight,
      state.paneHeights.requestHeight
    );
    const { minimums } = constrained;
    if (position === "top") {
      const pairHeight = constrained.importHeight + constrained.requestHeight;
      const importHeight = clamp(
        constrained.importHeight + delta,
        minimums.importHeight,
        pairHeight - minimums.requestHeight
      );
      state.paneHeights = { importHeight, requestHeight: pairHeight - importHeight };
    } else {
      const pairHeight = constrained.requestHeight + constrained.responseHeight;
      state.paneHeights.requestHeight = clamp(
        constrained.requestHeight + delta,
        minimums.requestHeight,
        pairHeight - minimums.responseHeight
      );
    }
    applyHttpPaneHeights();
  }

  function installHttpPaneResizer(handle, position) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      applyHttpPaneHeights();
      const startY = event.clientY;
      const startHeights = { ...state.paneHeights };
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");
      document.body.classList.add("resizing-http-panes");

      const move = (moveEvent) => {
        if (!handle.hasPointerCapture(moveEvent.pointerId)) return;
        state.paneHeights = { ...startHeights };
        resizeHttpPanePair(position, moveEvent.clientY - startY);
      };
      const finish = () => {
        handle.classList.remove("dragging");
        document.body.classList.remove("resizing-http-panes");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        saveHttpPaneHeights();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
      event.preventDefault();
    });

    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const step = event.shiftKey ? 32 : 8;
      resizeHttpPanePair(position, event.key === "ArrowDown" ? step : -step);
      saveHttpPaneHeights();
      event.preventDefault();
    });

    handle.addEventListener("dblclick", resetHttpPaneHeights);
  }

  function enabledNamedCount(rows) {
    return rows.filter((row) => row.enabled !== false && String(row.name || "").trim()).length;
  }

  function updateRequestCounts() {
    elements.paramsCount.textContent = String(enabledNamedCount(state.params));
    elements.headersCount.textContent = String(enabledNamedCount(state.headers));
    elements.bodyCount.textContent = elements.bodyType.value !== "none" && elements.httpBody.value ? "1" : "0";
  }

  function syncBodyType() {
    const disabled = elements.bodyType.value === "none";
    elements.httpBody.disabled = disabled;
    elements.formatBodyButton.disabled = disabled;
    updateRequestCounts();
  }

  function createDeleteIcon() {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", "m7 7 10 10M17 7 7 17");
    svg.append(path);
    return svg;
  }

  function createEditableRow(row, rows, index, kind) {
    const container = document.createElement("div");
    container.className = "key-value-row";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = row.enabled !== false;
    enabled.setAttribute("aria-label", `启用第 ${index + 1} 个${kind === "params" ? "参数" : "请求头"}`);
    enabled.addEventListener("change", () => {
      row.enabled = enabled.checked;
      container.classList.toggle("disabled", !enabled.checked);
      updateRequestCounts();
    });

    const name = document.createElement("input");
    name.type = "text";
    name.value = row.name || "";
    name.spellcheck = false;
    name.placeholder = kind === "params" ? "参数名" : "Header 名称";
    name.setAttribute("aria-label", `${kind === "params" ? "参数" : "请求头"}名称`);
    name.addEventListener("input", () => {
      row.name = name.value;
      updateRequestCounts();
    });

    const value = document.createElement("input");
    value.type = "text";
    value.value = row.value || "";
    value.spellcheck = false;
    value.placeholder = kind === "params" ? "参数值" : "Header 值";
    value.setAttribute("aria-label", `${kind === "params" ? "参数" : "请求头"}值`);
    value.addEventListener("input", () => { row.value = value.value; });

    const remove = document.createElement("button");
    remove.className = "delete-row-button";
    remove.type = "button";
    remove.setAttribute("aria-label", `删除第 ${index + 1} 行`);
    remove.append(createDeleteIcon());
    remove.addEventListener("click", () => {
      rows.splice(index, 1);
      renderRows(kind);
    });

    container.classList.toggle("disabled", !enabled.checked);
    container.append(enabled, name, value, remove);
    return container;
  }

  function renderRows(kind) {
    const rows = kind === "params" ? state.params : state.headers;
    const target = kind === "params" ? elements.paramsRows : elements.headersRows;
    target.replaceChildren(...rows.map((row, index) => createEditableRow(row, rows, index, kind)));
    updateRequestCounts();
  }

  function addRow(kind) {
    const rows = kind === "params" ? state.params : state.headers;
    rows.push({ enabled: true, name: "", value: "" });
    renderRows(kind);
    const target = kind === "params" ? elements.paramsRows : elements.headersRows;
    target.lastElementChild?.querySelector('input[type="text"]')?.focus();
  }

  function setRequestTab(tabName) {
    const validTab = ["params", "headers", "body"].includes(tabName) ? tabName : "params";
    state.activeRequestTab = validTab;
    const tabs = [
      ["params", elements.paramsTabButton, elements.paramsEditor],
      ["headers", elements.headersTabButton, elements.headersEditor],
      ["body", elements.bodyTabButton, elements.bodyEditor]
    ];
    for (const [name, button, panel] of tabs) {
      const selected = name === validTab;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
      panel.classList.toggle("hidden", !selected);
    }
  }

  function setResponseTab(tabName) {
    const headersActive = tabName === "headers";
    state.activeResponseTab = headersActive ? "headers" : "body";
    elements.responseBodyTabButton.classList.toggle("selected", !headersActive);
    elements.responseBodyTabButton.setAttribute("aria-selected", String(!headersActive));
    elements.responseHeadersTabButton.classList.toggle("selected", headersActive);
    elements.responseHeadersTabButton.setAttribute("aria-selected", String(headersActive));
    elements.responseBodyPanel.classList.toggle("hidden", headersActive);
    elements.responseHeadersPanel.classList.toggle("hidden", !headersActive);
  }

  function setMethod(method) {
    const normalized = String(method || "GET").toUpperCase();
    if (!Array.from(elements.httpMethod.options).some((option) => option.value === normalized)) {
      elements.httpMethod.add(new Option(normalized, normalized));
    }
    elements.httpMethod.value = normalized;
  }

  function showParseStatus(message, type = "neutral") {
    elements.curlParseStatus.textContent = message;
    elements.curlParseStatus.dataset.type = type;
  }

  function parseCurlInput() {
    const value = elements.curlInput.value.trim();
    if (!value) {
      showParseStatus("请先粘贴 cURL。", "error");
      return false;
    }
    try {
      const parsed = runtime.parseCurl(value);
      setMethod(parsed.method);
      elements.httpUrl.value = parsed.url;
      state.params = parsed.params;
      state.headers = parsed.headers;
      elements.httpBody.value = parsed.body;
      elements.bodyType.value = parsed.bodyType;
      syncBodyType();
      renderRows("params");
      renderRows("headers");
      setRequestTab(parsed.body ? "body" : parsed.headers.length ? "headers" : "params");
      const warnings = parsed.warnings.length ? `；${parsed.warnings.join("；")}` : "";
      showParseStatus(`已解析 ${parsed.method} 请求${warnings}`, parsed.warnings.length ? "warning" : "success");
      elements.httpStatusText.textContent = "cURL 已解析，检查参数后点击发送";
      return true;
    } catch (error) {
      showParseStatus(error?.message || "无法解析 cURL。", "error");
      return false;
    }
  }

  function resetResponse() {
    elements.responseStatusBadge.className = "response-status idle";
    elements.responseStatusBadge.textContent = "尚未发送";
    elements.responseMeta.textContent = "";
    elements.responseBody.textContent = "发送请求后在这里查看响应。";
    elements.responseHeaders.textContent = "";
    elements.responseHeadersCount.textContent = "0";
    elements.copyResponseButton.disabled = true;
    state.responseCopyText = "";
    setResponseTab("body");
  }

  function clearHttpClient() {
    if (state.controller) state.controller.abort();
    elements.curlInput.value = "";
    setMethod("GET");
    elements.httpUrl.value = "";
    state.params = [];
    state.headers = [];
    elements.httpBody.value = "";
    elements.bodyType.value = "none";
    syncBodyType();
    renderRows("params");
    renderRows("headers");
    setRequestTab("params");
    showParseStatus("等待粘贴 cURL");
    elements.httpStatusText.textContent = "HTTP 请求数据仅保留在当前 DevTools 会话内";
    resetResponse();
  }

  function formatBody() {
    const source = elements.httpBody.value.trim();
    if (!source) return;
    try {
      elements.httpBody.value = JSON.stringify(JSON.parse(source), null, 2);
      elements.bodyType.value = "json";
      syncBodyType();
      showParseStatus("请求 Body 已格式化为 JSON。", "success");
    } catch {
      showParseStatus("Body 不是有效 JSON，未做修改。", "error");
    }
  }

  function setRequestRunning(running) {
    elements.sendHttpButton.disabled = running;
    elements.cancelHttpButton.classList.toggle("hidden", !running);
  }

  function renderResponseHeaders(headers) {
    const rows = Array.from(headers.entries());
    elements.responseHeadersCount.textContent = String(rows.length);
    elements.responseHeaders.textContent = rows.length
      ? rows.map(([name, value]) => `${name}: ${value}`).join("\n")
      : "响应未暴露可读取的 Header。";
  }

  async function sendRequest() {
    let requestUrl;
    try {
      requestUrl = runtime.buildRequestUrl(elements.httpUrl.value, state.params);
    } catch (error) {
      showParseStatus(error?.message || "请求 URL 无效。", "error");
      elements.httpUrl.focus();
      return;
    }

    const method = elements.httpMethod.value.toUpperCase();
    const prepared = runtime.prepareHeaders(state.headers);
    const headers = new Headers();
    const invalidHeaders = [];
    for (const row of prepared.headers) {
      try {
        headers.append(row.name, row.value);
      } catch {
        invalidHeaders.push(row.name);
      }
    }

    const skippedNames = prepared.skipped.concat(invalidHeaders.map((name) => ({ name }))).map((item) => item.name);
    const hasBody = !["GET", "HEAD"].includes(method) && elements.bodyType.value !== "none";
    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", elements.bodyType.value === "json" ? "application/json" : "text/plain;charset=UTF-8");
    }
    const controller = new AbortController();
    state.controller = controller;
    setRequestRunning(true);
    elements.responseStatusBadge.className = "response-status loading";
    elements.responseStatusBadge.textContent = "请求中";
    elements.responseMeta.textContent = requestUrl;
    elements.responseBody.textContent = "正在等待响应…";
    elements.responseHeaders.textContent = "";
    elements.copyResponseButton.disabled = true;
    elements.httpStatusText.textContent = `${method} ${requestUrl}`;
    if (skippedNames.length) {
      showParseStatus(`发送时跳过浏览器禁止或无效的 Header：${skippedNames.join(", ")}`, "warning");
    }

    const startedAt = performance.now();
    try {
      const response = await fetch(requestUrl, {
        method,
        headers,
        body: hasBody ? elements.httpBody.value : undefined,
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
      const rawText = await response.text();
      const contentType = response.headers.get("content-type") || "";
      const formatted = runtime.formatResponseBody(rawText, contentType);
      const elapsed = Math.max(0, performance.now() - startedAt);
      const truncated = formatted.text.length > MAX_RENDERED_RESPONSE_CHARS;
      const renderedText = truncated
        ? formatted.text.slice(0, MAX_RENDERED_RESPONSE_CHARS) + "\n\n…响应过大，界面仅显示前 5 MiB…"
        : formatted.text || "（空响应）";
      elements.responseStatusBadge.className = `response-status ${response.ok ? "success" : "error"}`;
      elements.responseStatusBadge.textContent = `${response.status} ${response.statusText || ""}`.trim();
      elements.responseMeta.textContent = `${Math.round(elapsed)} ms · ${new Blob([rawText]).size} B · ${formatted.format.toUpperCase()}`;
      elements.responseBody.textContent = renderedText;
      renderResponseHeaders(response.headers);
      state.responseCopyText = rawText;
      elements.copyResponseButton.disabled = false;
      elements.httpStatusText.textContent = `${method} 请求完成：${response.status} · ${Math.round(elapsed)} ms`;
      setResponseTab("body");
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      elements.responseStatusBadge.className = `response-status ${cancelled ? "idle" : "error"}`;
      elements.responseStatusBadge.textContent = cancelled ? "已取消" : "请求失败";
      elements.responseMeta.textContent = `${Math.round(Math.max(0, performance.now() - startedAt))} ms`;
      elements.responseBody.textContent = cancelled
        ? "请求已由用户取消。"
        : `${error?.name || "Error"}: ${error?.message || "未知网络错误"}`;
      elements.httpStatusText.textContent = cancelled ? "HTTP 请求已取消" : "HTTP 请求失败";
      setResponseTab("body");
    } finally {
      if (state.controller === controller) state.controller = null;
      setRequestRunning(false);
    }
  }

  elements.mqttModuleButton.addEventListener("click", () => setActiveModule("mqtt"));
  elements.httpModuleButton.addEventListener("click", () => setActiveModule("http"));
  elements.parseCurlButton.addEventListener("click", parseCurlInput);
  elements.clearHttpButton.addEventListener("click", clearHttpClient);
  elements.curlInput.addEventListener("paste", () => {
    setTimeout(() => {
      if (/^\s*(?:\$\s+)?curl(?:\.exe)?\b/i.test(elements.curlInput.value)) parseCurlInput();
    }, 0);
  });
  elements.httpRequestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendRequest();
  });
  elements.cancelHttpButton.addEventListener("click", () => state.controller?.abort());
  elements.paramsTabButton.addEventListener("click", () => setRequestTab("params"));
  elements.headersTabButton.addEventListener("click", () => setRequestTab("headers"));
  elements.bodyTabButton.addEventListener("click", () => setRequestTab("body"));
  elements.responseBodyTabButton.addEventListener("click", () => setResponseTab("body"));
  elements.responseHeadersTabButton.addEventListener("click", () => setResponseTab("headers"));
  elements.addParamButton.addEventListener("click", () => addRow("params"));
  elements.addHeaderButton.addEventListener("click", () => addRow("headers"));
  elements.httpBody.addEventListener("input", updateRequestCounts);
  elements.bodyType.addEventListener("change", syncBodyType);
  elements.formatBodyButton.addEventListener("click", formatBody);
  elements.copyResponseButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.responseCopyText);
    const previous = elements.copyResponseButton.textContent;
    elements.copyResponseButton.textContent = "已复制";
    setTimeout(() => { elements.copyResponseButton.textContent = previous; }, 900);
  });
  document.addEventListener("keydown", (event) => {
    if (state.module !== "http" || !(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
    event.preventDefault();
    if (!state.controller) sendRequest();
  });

  state.paneHeights = loadHttpPaneHeights();
  installHttpPaneResizer(elements.httpTopResizer, "top");
  installHttpPaneResizer(elements.httpBottomResizer, "bottom");
  window.addEventListener("resize", () => {
    if (state.module === "http") applyHttpPaneHeights();
  });

  renderRows("params");
  renderRows("headers");
  syncBodyType();
  resetResponse();
  let initialModule = "mqtt";
  try {
    initialModule = localStorage.getItem(MODULE_STORAGE_KEY) === "http" ? "http" : "mqtt";
  } catch {
    // Keep MQTT as the initial module.
  }
  setActiveModule(initialModule, { persist: false, focus: false });
})();
