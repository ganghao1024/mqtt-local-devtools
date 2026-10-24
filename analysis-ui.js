(function installAnalysisUI() {
  "use strict";
  const source = globalThis.__MQTT_PANEL_ANALYSIS_SOURCE__;
  const runtime = globalThis.__MQTT_LOCAL_DEVTOOLS_ANALYSIS_RUNTIME__;
  const session = globalThis.__MQTT_LOCAL_DEVTOOLS_ANALYSIS_SESSION__;
  const navigation = globalThis.__MQTT_PANEL_MODULES__;
  if (!source || !runtime || !session || !navigation) return;
  const $ = id => document.getElementById(id);
  const limits = session.LIMITS;
  const cache = session.createCache();
  const selected = new Set();
  let config = { topic: "", topicGroup: "", topicGroupDepth: 3, packetType: "PUBLISH", fields: [], devicePath: "", topicIsObject: true, ignorePaths: [], identityRule: "complete-topic" };
  const inspect = runtime.createInspector(config);
  let currentId = null, pinnedId = null, report = null, revision = 0, activeTab = "diff", page = 0;
  let running = false, sourceDisconnected = false, captureFrozen = false, frozenSkipped = 0;
  const PAGE_SIZE = 100;
  const find = id => cache.get(id);
  const scopedRecords = () => cache.records().filter(record => session.inScope(record, config));
  const records = () => scopedRecords().filter(record => selected.has(record.event.id));
  $("analysisWorkspace").innerHTML = [
    '<section id="analysisCard" class="analysis-shell">',
    '<header class="analysis-heading"><div><h1>故障分析</h1><p>一个 Topic，一张字段表。每条消息都保留。</p></div><div class="analysis-heading-tools"><span id="analysisCacheStatus" class="analysis-cache-status" role="status"></span><details class="analysis-more"><summary>更多操作</summary><div><button id="analysisRun" class="text-button" type="button">分析当前选择</button><button id="analysisPoolClear" class="text-button" type="button">清空选择</button><button id="analysisClearCache" class="text-button" type="button">清空独立缓存</button></div></details></div></header>',
    '<div class="analysis-query"><div class="analysis-query-main"><label class="analysis-topic-label" for="analysisTopicGroup"><span>1 · 完整 Topic</span><select id="analysisTopicGroup" aria-label="分析完整 Topic"><option value="">展开分组，选择一个完整 Topic</option></select></label><label class="analysis-n-label" for="analysisLatestCount"><span>2 · 最新消息数</span><input id="analysisLatestCount" aria-label="最新消息数量 N" type="number" min="1" max="1000" step="1" value="50"></label><button id="analysisSelectLatest" class="action-button primary" type="button">分析</button><button id="analysisFetchLatest" class="action-button" type="button" disabled>获取最新 N 条</button></div>',
    '<div class="analysis-field-query"><label for="analysisFields">3 · 关注字段 <span>可选，留空显示全部</span></label><input id="analysisFields" aria-label="关注字段" maxlength="8192" placeholder="例如 status, data.battery, errorCode · 多个字段用逗号分隔"><button id="analysisResetFields" class="text-button" type="button">显示全部字段</button></div><span id="analysisTopicScopeStatus" class="analysis-query-help" role="status">仅分析选中的完整 Topic，不合并同组的其他 Topic。</span></div>',
    '<p id="analysisNotice" role="status">开始分析后冻结本轮消息。需要新数据时，点击“获取最新 N 条”；已有缓存仅手动清空。</p>',
    '<p id="analysisFreezeStatus" class="analysis-freeze-status hidden" role="status"></p>',
    '<p id="analysisCacheWarning" class="analysis-cache-warning hidden" role="status"></p>',
    '<div class="analysis-body"><section class="analysis-stage">',
    '<div class="analysis-result-toolbar"><div class="editor-tabs analysis-tabs" role="tablist" aria-label="故障分析功能"><button id="analysisChangesTab" class="editor-tab selected" role="tab" aria-selected="true" aria-controls="changesSection" type="button">字段表与变化</button><button id="analysisDiffTab" class="editor-tab" role="tab" aria-selected="false" aria-controls="comparisonSection" type="button">A/B 对比</button><button id="analysisRawTab" class="editor-tab" role="tab" aria-selected="false" aria-controls="rawAnalysisSection" type="button">原始数据</button></div><div class="analysis-export-toolbar"><button id="analysisExportChanges" class="text-button" type="button" disabled>导出分析</button><button id="analysisExportRaw" class="text-button" type="button" disabled>导出原文</button><button id="analysisExportCombined" class="action-button compact" type="button" disabled>一起导出</button></div></div>',
    '<div id="analysisEmptyState" class="analysis-onboarding"><strong>从一个完整 Topic 开始</strong><span>选好 Topic 和数量后，消息按行排列；关注字段按列展开，未变化的值也会保留。</span><button id="analysisChooseMessages" class="text-button" type="button">去 MQTT 查看 Topic</button></div>',
    '<section id="changesSection" class="analysis-tabpanel" role="tabpanel" aria-labelledby="analysisChangesTab"><p id="analysisResultSummary" class="analysis-result-summary" role="status">等待分析 · 设置字段可聚焦问题，留空可查看全部字段。</p><div class="analysis-change-controls"><select id="analysisChangeView" aria-label="变化视图"><option value="matrix">消息字段表</option><option value="changes">逐条变化</option><option value="fields">字段变化规律</option></select><input id="analysisChangeSearch" type="search" aria-label="筛选变化字段" placeholder="搜索字段路径"><span class="analysis-matrix-legend">● 变化单元格 · 未变化的行也保留</span></div><div id="analysisChangesTable" tabindex="0" aria-label="分析结果，可滚动查看"></div><div class="analysis-pagination"><button id="analysisPreviousPage" class="text-button" type="button">上一页</button><span id="analysisPageInfo"></span><button id="analysisNextPage" class="text-button" type="button">下一页</button></div><details id="analysisSkipped"><summary id="analysisSkippedSummary">无法自动比较的消息</summary><div id="analysisSkippedRows"></div></details></section>',
    '<section id="comparisonSection" class="analysis-tabpanel hidden" role="tabpanel" aria-labelledby="analysisDiffTab"><div class="analysis-compare-controls"><label>消息 A · 变化前<select id="compareASelect" aria-label="消息 A"></select></label><label>消息 B · 变化后<select id="compareBSelect" aria-label="消息 B"></select></label></div><div class="analysis-actions"><button id="comparePrevious" class="action-button compact" type="button">与上一条比较</button><button id="comparePin" class="action-button compact" type="button">设为比较 A</button><button id="compareManual" class="action-button primary" type="button">比较 A / B</button></div><p id="compareObjects">在当前完整 Topic 中选择两条消息对比。</p><div id="diffResults"></div><details id="compareContext"><summary>比较消息完整上下文</summary><pre id="compareContextText"></pre></details></section>',
    '<section id="rawAnalysisSection" class="analysis-tabpanel hidden" role="tabpanel" aria-labelledby="analysisRawTab"><h2>消息原文</h2><p class="analysis-help">从字段表点击“查看原文”，或展开底部已选消息。导出保留实际捕获内容，未脱敏。</p><pre id="analysisRawContent"></pre></section>',
    '<div class="analysis-current"><span id="analysisCurrentMessage">尚未选择消息</span><button id="analysisViewInMqtt" class="text-button" type="button" disabled>在 MQTT 中查看</button></div>',
    '</section></div>',
    '<details class="analysis-inbox" id="analysisSelectionDetails"><summary><span id="analysisPoolCount">分析选择 · 0 / 1000</span><span>展开管理所选消息</span></summary><div id="analysisMessageList" class="analysis-message-list"></div><button id="analysisAddMore" class="text-button" type="button">去 MQTT 手动选择</button></details>',
    '<span id="analysisExportStatus" class="analysis-export-status" role="status">独立缓存最多 5000 条 / 32 MiB · 满后停止写入，不自动淘汰 · 原始导出未脱敏</span>',
    '</section>'
  ].join("");
  const quick = document.createElement("div");
  quick.className = "analysis-quick-actions";
  quick.innerHTML = '<button id="quickComparePrevious" class="action-button compact" type="button" disabled>与上一条比较</button><button id="quickAddAnalysis" class="action-button compact" type="button" disabled>加入故障分析</button>';
  $("detailsScroll").prepend(quick);
  function stamp(value) { return Number.isFinite(value) ? new Date(value).toISOString() : "时间无效"; }
  function label(record) {
    return "#" + record.order + " · " + record.event.packet.topic + " · " + (record.event.direction === "incoming" ? "接收" : "发送") + " · 连接 " + record.event.connectionId;
  }
  function notice(message) { $("analysisNotice").textContent = message; }
  function setTab(value, focus = false) {
    activeTab = value;
    document.querySelector(".analysis-current").classList.toggle("hidden", value === "changes");
    for (const [name, suffix, panel] of [["diff", "Diff", "comparisonSection"], ["changes", "Changes", "changesSection"], ["raw", "Raw", "rawAnalysisSection"]]) {
      const button = $("analysis" + suffix + "Tab");
      button.classList.toggle("selected", name === value); button.setAttribute("aria-selected", String(name === value)); button.tabIndex = name === value ? 0 : -1;
      $(panel).classList.toggle("hidden", name !== value);
      if (name === value && focus) button.focus();
    }
  }
  function open(tab = "diff") { navigation.activate("analysis"); setTab(tab); }
  function updateExports() {
    $("analysisExportRaw").disabled = selected.size === 0;
    $("analysisExportChanges").disabled = !report || running;
    $("analysisExportCombined").disabled = !report || running;
    $("analysisRun").disabled = selected.size === 0;
    $("analysisSelectLatest").disabled = !config.topic || !cache.topics().some(topic => topic.name === config.topic);
    $("analysisFetchLatest").disabled = !config.topic;
  }
  function invalidateReport(message = "选择或设置已改变，请重新分析") {
    revision += 1; report = null; running = false;
    $("analysisResultSummary").textContent = message; $("analysisChangesTable").replaceChildren();
    $("analysisSkippedRows").replaceChildren(); $("analysisSkippedSummary").textContent = "无法分析的消息";
    $("analysisPageInfo").textContent = ""; updateExports();
  }
  function invalidateComparison(message) {
    $("diffResults").replaceChildren(); $("compareContextText").textContent = ""; $("compareObjects").textContent = message;
  }
  function makeTable(headers, rows, action) {
    const table = document.createElement("table"); table.className = "analysis-data-table";
    const head = document.createElement("thead"), tr = document.createElement("tr");
    for (const text of headers) { const th = document.createElement("th"); th.textContent = text; tr.append(th); }
    head.append(tr); table.append(head);
    const body = document.createElement("tbody");
    for (const row of rows) {
      const node = document.createElement("tr");
      for (const text of row.cells) { const td = document.createElement("td"); td.textContent = text; node.append(td); }
      if (action) { const td = document.createElement("td"), button = document.createElement("button"); button.type = "button"; button.className = "text-button"; button.textContent = "查看对比"; button.addEventListener("click", () => action(row.value)); td.append(button); node.append(td); }
      body.append(node);
    }
    table.append(body); return table;
  }
  function compare(left, right, mode) {
    if (!left || !right) { invalidateComparison("分析消息不存在或已被手动清空，请重新选择"); return; }
    if (![left, right].every(record => session.inScope(record, config))) { invalidateComparison("只能比较当前完整 Topic 中的消息"); return; }
    $("compareObjects").textContent = mode + "\nA: " + label(left) + "\nB: " + label(right);
    $("compareContextText").textContent = JSON.stringify({ A: left, B: right }, null, 2);
    const before = runtime.payload(left.event), after = runtime.payload(right.event);
    $("diffResults").replaceChildren();
    if (!before.ok || !after.ok) { $("diffResults").textContent = "无法比较 JSON 字段。A: " + (before.reason || "JSON") + "；B: " + (after.reason || "JSON"); return; }
    const result = runtime.diff(before.value, after.value, config.ignorePaths);
    const summary = document.createElement("p"); summary.textContent = result.changes.length + " 个变化" + (result.limited ? "（达到分析上限，结果不完整）" : "");
    $("diffResults").append(summary);
    if (result.changes.length) $("diffResults").append(makeTable(["变化", "字段路径", "变化前 · A", "变化后 · B"], result.changes.map(change => ({ cells: [change.kind, change.path, change.before.exists ? JSON.stringify(change.before.value) : "[字段不存在]", change.after.exists ? JSON.stringify(change.after.value) : "[字段不存在]"] }))));
  }
  function comparePrevious() {
    const record = find(currentId); if (!record) return;
    const prior = runtime.previous(scopedRecords().map(item => item.event), currentId, config, inspect);
    if (!prior.event) { invalidateComparison(label(record) + "\n" + prior.reason); return; }
    compare(find(prior.event.id), record, "同一对象的上一条消息（来自独立分析缓存）");
  }
  function showCurrent(id) {
    const record = find(id); if (!record || !session.inScope(record, config)) return;
    currentId = id;
    $("analysisCurrentMessage").textContent = label(record);
    $("analysisViewInMqtt").disabled = !source.event(id);
    $("analysisRawContent").textContent = JSON.stringify(record, null, 2);
  }
  function renderSelection() {
    $("analysisMessageList").replaceChildren();
    const oldA = $("compareASelect").value, oldB = $("compareBSelect").value;
    const aOptions = [new Option("选择变化前的消息", "")], bOptions = [new Option("选择变化后的消息", "")];
    const items = records();
    for (const record of [...items].reverse()) {
      const id = record.event.id, row = document.createElement("div"); row.className = "analysis-message-item";
      const button = document.createElement("button"); button.type = "button"; button.className = "analysis-message-select"; button.dataset.analysisId = id;
      button.textContent = label(record); button.classList.toggle("selected", id === currentId); button.setAttribute("aria-pressed", String(id === currentId));
      button.addEventListener("click", () => { showCurrent(id); renderSelection(); });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "移除"; remove.setAttribute("aria-label", "移除分析消息 " + id); remove.addEventListener("click", () => toggle(id, false));
      row.append(button, remove); $("analysisMessageList").append(row);
    }
    for (const record of items) { aOptions.push(new Option(label(record), record.event.id)); bOptions.push(new Option(label(record), record.event.id)); }
    $("compareASelect").replaceChildren(...aOptions); $("compareBSelect").replaceChildren(...bOptions);
    $("compareASelect").value = selected.has(pinnedId) ? pinnedId : selected.has(oldA) ? oldA : items.length > 1 ? items[0].event.id : "";
    $("compareBSelect").value = selected.has(currentId) ? currentId : selected.has(oldB) ? oldB : items.at(-1)?.event.id || "";
    $("analysisPoolCount").textContent = "分析选择 · " + selected.size + " / " + limits.maxSelected;
    $("openAnalysisSelection").textContent = "分析已选 (" + selected.size + ")";
    $("analysisEmptyState").classList.toggle("hidden", selected.size > 0);
    $("comparePrevious").disabled = !find(currentId); $("comparePin").disabled = !find(currentId);
    $("compareManual").disabled = !$("compareASelect").value || !$("compareBSelect").value || $("compareASelect").value === $("compareBSelect").value;
    updateExports();
  }
  function clearCurrent() {
    currentId = null; $("analysisCurrentMessage").textContent = "尚未选择分析消息"; $("analysisRawContent").textContent = ""; $("analysisViewInMqtt").disabled = true;
  }
  function addIds(ids, choose = false) {
    let switched = false;
    if (ids.length === 1) {
      const event = find(ids[0])?.event || source.event(ids[0]);
      if (session.topicGroup(event) === null) { notice("故障分析只接收具有 Topic 的 PUBLISH 消息，请选择业务消息"); return; }
      switched = config.topic !== event.packet.topic;
      if (switched) selectTopicGroup(event.packet.topic);
    }
    if (!config.topic) { notice("请先选择一个完整 Topic，再加入其筛选结果"); return; }
    let skipped = 0, added = 0;
    for (const id of ids) {
      if (selected.has(id)) continue;
      if (!find(id)) {
        const event = source.event(id); if (event) cache.append(event, source.connection(event.connectionId), source.sequence(id));
      }
      if (!find(id) || !session.inScope(find(id), config)) { skipped += 1; continue; }
      if (selected.size >= limits.maxSelected) { skipped += 1; continue; }
      selected.add(id); added += 1;
    }
    if (added) { invalidateReport(); invalidateComparison("选择已更新，点击比较或分析当前选择"); }
    if (choose && selected.has(ids[0])) showCurrent(ids[0]);
    else if (!find(currentId) && selected.size) showCurrent(records().at(-1).event.id);
    renderSelection(); source.refreshSelectionMarks(); renderStats();
    notice((switched ? "已切换完整 Topic，旧选择和结果已清空，缓存消息保留。" : "") + "当前 Topic 已选 " + selected.size + " 条" + (skipped ? "；另有 " + skipped + " 条未加入（其他 Topic、选择超限、独立缓存已满或单条过大）" : "") + "。独立缓存不会随 MQTT 列表清空。");
  }
  function toggle(id, checked) {
    if (checked) { addIds([id]); return; }
    if (!selected.delete(id)) return;
    if (pinnedId === id) pinnedId = null;
    if (currentId === id) { clearCurrent(); if (selected.size) showCurrent(records().at(-1).event.id); }
    invalidateReport(); invalidateComparison("分析选择已改变，请重新比较"); renderSelection(); source.refreshSelectionMarks();
  }
  function renderStats() {
    const stats = cache.stats();
    $("analysisCacheStatus").textContent = "独立缓存 " + stats.count + " / " + stats.maxItems + " 条 · " + (stats.bytes / 1048576).toFixed(1) + " / 32 MiB" + (captureFrozen ? " · 已冻结" : "") + (stats.full ? " · 已满，停止写入 · 未收录 " + stats.skipped : captureFrozen || sourceDisconnected ? "" : " · 接收中") + (stats.rejected ? " · 过大跳过 " + stats.rejected : "") + (sourceDisconnected ? " · 捕获通道断开" : "");
    $("analysisSelectLatest").textContent = "分析";
    $("analysisFreezeStatus").classList.toggle("hidden", !captureFrozen);
    $("analysisFreezeStatus").textContent = captureFrozen ? "本轮已冻结，不再自动接收分析消息（已略过 " + frozenSkipped + " 条新消息）。点击“获取最新 N 条”可复制当前 Topic 的最新消息并重新分析，获取后仍保持冻结。" : "";
    $("analysisCacheWarning").classList.toggle("hidden", !stats.full);
    $("analysisCacheWarning").textContent = stats.full ? "分析缓存已达到" + (stats.fullReason === "items" ? "条数" : "容量") + "上限，已停止收录新消息；已有记录、选择和分析结果均保留。以下“最新 N 条”只从已保留记录中选择。可先导出，再通过“更多操作 → 清空独立缓存”恢复接收。未收录 " + stats.skipped + " 条。" : "";
    renderTopicGroups();
  }
  let topicOptionsSignature = "";
  function renderTopicGroups() {
    const cachedTopics = cache.topics(), topicMap = new Map(cachedTopics.map(topic => [topic.name, topic]));
    // Live Topic names are navigation metadata only; no live payloads enter the frozen cache.
    if (captureFrozen) for (const event of source.events()) {
      const group = session.topicGroup(event); if (group === null || topicMap.has(event.packet.topic)) continue;
      topicMap.set(event.packet.topic, { name: event.packet.topic, count: 0, group });
    }
    const topics = [...topicMap.values()].sort((a, b) => a.name.localeCompare(b.name)), signature = JSON.stringify([config.topic, topics.map(topic => topic.name)]);
    if (signature !== topicOptionsSignature) {
      topicOptionsSignature = signature;
      const select = $("analysisTopicGroup"), groups = new Map();
      select.replaceChildren(new Option("展开分组，选择一个完整 Topic", ""));
      for (const topic of topics) {
        if (!groups.has(topic.group)) { const group = document.createElement("optgroup"); group.label = topic.group; groups.set(topic.group, group); select.append(group); }
        groups.get(topic.group).append(new Option(topic.name + (topic.count ? "（" + topic.count + " 条）" : "（待获取）"), topic.name));
      }
      if (config.topic && !topics.some(topic => topic.name === config.topic)) select.append(new Option(config.topic + "（暂无消息）", config.topic));
      select.value = config.topic;
    }
    if (document.activeElement !== $("analysisTopicGroup")) {
      const counts = new Map(topics.map(topic => [topic.name, topic.count]));
      for (const option of $("analysisTopicGroup").options) {
        if (!option.value) continue;
        const text = option.value + (counts.has(option.value) ? counts.get(option.value) ? "（" + counts.get(option.value) + " 条）" : "（待获取）" : "（暂无消息）");
        if (option.textContent !== text) option.textContent = text;
      }
    }
    const count = topics.find(topic => topic.name === config.topic)?.count || 0;
    $("analysisTopicScopeStatus").textContent = config.topic ? "可用 " + count + " 条 · " + "完整 Topic 对应一个设备 · 自动标记字段变化" + " · 按捕获顺序" : "仅分析选中的完整 Topic，不合并同组的其他 Topic。";
    $("analysisTopicGroup").title = config.topic || "选择完整 Topic";
    $("analysisSelectLatest").disabled = !config.topic || !count;
    $("analysisFetchLatest").disabled = !config.topic;
  }
  function selectTopicGroup(topic) {
    if (config.topic === topic) return;
    config = { ...config, topic, topicGroup: topic ? globalThis.__MQTT_LOCAL_DEVTOOLS_PANEL_RUNTIME__.topicGroupKey(topic, 3) : "" };
    clearSelection(); $("analysisChangeSearch").value = ""; page = 0;
    $("analysisExportStatus").textContent = "原始数据保留捕获原文，未脱敏。";
    renderTopicGroups();
    notice(topic ? "已选择完整 Topic，独立缓存消息保留。点“开始分析”查看该 Topic 的已缓存消息。" : "请选择一个完整 Topic 后再分析。");
  }
  const scheduler = globalThis.__MQTT_LOCAL_DEVTOOLS_PANEL_RUNTIME__.createRenderScheduler(() => {
    renderStats();
  }, { intervalMs: 125 });
  function capture(event, connection, order) {
    if (captureFrozen) {
      if (event.kind === "packet" && !cache.get(event.id)) frozenSkipped += 1;
      scheduler.schedule(); return;
    }
    cache.append(event, connection, order);
    scheduler.schedule();
  }
  function groupLabel(id) {
    const group = report?.groups.find(item => item.id === id);
    return group ? "连接 " + group.connectionId + " · " + (group.direction === "incoming" ? "接收" : "发送") : id;
  }
  function inspectPair(beforeId, afterId) {
    if (!find(beforeId) || !find(afterId)) { notice("分析消息不存在或已被手动清空"); return; }
    showCurrent(afterId); pinnedId = beforeId; renderSelection();
    compare(find(beforeId), find(afterId), "变化列表对应的消息"); setTab("diff");
  }
  function renderChanges() {
    $("analysisChangesTable").replaceChildren();
    if (!report) return;
    if ($("analysisChangeView").value === "matrix") { renderMatrix(); return; }
    const fields = $("analysisChangeView").value === "fields", query = $("analysisChangeSearch").value.trim().toLowerCase();
    const rows = (fields ? report.fields : report.changes).filter(item => (item.path + " " + groupLabel(item.groupId)).toLowerCase().includes(query));
    // Reverse the display only; comparisons and exports retain capture order.
    if (fields) rows.sort((a, b) => (find(b.lastAfterId)?.order ?? 0) - (find(a.lastAfterId)?.order ?? 0));
    else rows.reverse();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); page = Math.max(0, Math.min(page, pages - 1));
    const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const data = visible.map(item => ({ value: item, cells: fields ?
      [groupLabel(item.groupId), item.path, String(item.count), item.patterns.join("；"), item.flow.map(session.valueText).join(" → ") + (item.flowTruncated ? " …（仅展示前 16 个状态）" : "")] :
      ["#" + item.beforeOrder + " → #" + item.afterOrder + "\n" + stamp(item.beforeCapturedAt) + " → " + stamp(item.afterCapturedAt), groupLabel(item.groupId), item.path, item.kind + (item.typeChanged ? " / 类型变化" : ""), session.valueText(item.before), session.valueText(item.after)] }));
    $("analysisChangesTable").append(makeTable(fields ? ["对象", "字段路径", "变化次数", "观察到的模式", "值的流转", "上下文"] : ["前后消息", "对象", "字段路径", "变化", "变化前", "变化后", "上下文"], data,
      item => inspectPair(fields ? item.firstBeforeId : item.beforeId, fields ? item.lastAfterId : item.afterId)));
    $("analysisPageInfo").textContent = rows.length + " 项 · " + (fields ? "最近变化在前" : "最新在前") + " · 第 " + (page + 1) + " / " + pages + " 页 · 每页 " + PAGE_SIZE + " 项";
    $("analysisPreviousPage").disabled = page === 0; $("analysisNextPage").disabled = page + 1 >= pages;
  }
  function renderMatrix() {
    const matrix = report.matrix, query = $("analysisChangeSearch").value.trim().toLowerCase();
    const rows = matrix.rows.slice().reverse();
    const columns = matrix.columns.map((path, index) => ({ path, index })).filter(column => column.path.toLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(matrix.rows.length / PAGE_SIZE)); page = Math.min(Math.max(page, 0), pages - 1);
    const table = document.createElement("table"); table.className = "analysis-matrix-table";
    const head = table.createTHead(), header = head.insertRow();
    for (const text of ["消息 / 接收时间", ...columns.map(column => column.path), "操作"]) { const th = document.createElement("th"); th.scope = "col"; th.textContent = text; header.append(th); }
    const body = table.createTBody();
    for (const row of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const tr = body.insertRow(); tr.dataset.matrixId = row.id;
      const id = tr.insertCell(); id.textContent = "#" + row.order + " · " + stamp(row.capturedAt).slice(11, 23);
      if (row.reason) { const reason = document.createElement("small"); reason.textContent = row.valid ? "仅展示值 · 无法匹配上一条" : row.reason; reason.title = row.reason; id.append(reason); }
      for (const column of columns) {
        const cell = row.cells[column.index], td = tr.insertCell();
        td.textContent = row.valid ? session.valueText(cell) : "[无法解析]";
        if (cell.changed) { td.className = "matrix-cell-changed"; const mark = document.createElement("small"); mark.textContent = "● " + cell.kind; td.append(mark); td.title = "相较同一对象消息 " + row.beforeId; }
        if (!cell.exists && row.valid) td.classList.add("matrix-cell-missing");
      }
      const actions = tr.insertCell(), raw = document.createElement("button"); raw.type = "button"; raw.className = "text-button"; raw.textContent = "查看原文";
      raw.addEventListener("click", () => { showCurrent(row.id); renderSelection(); setTab("raw"); }); actions.append(raw);
      if (row.beforeId) { const diff = document.createElement("button"); diff.type = "button"; diff.className = "text-button"; diff.textContent = "查看对比"; diff.addEventListener("click", () => inspectPair(row.beforeId, row.id)); actions.append(diff); }
    }
    $("analysisChangesTable").append(table);
    $("analysisPageInfo").textContent = matrix.rows.length + " 条消息 · " + columns.length + " 个字段 · 最新在前 · 第 " + (page + 1) + " / " + pages + " 页 · 每页 " + PAGE_SIZE + " 条";
    $("analysisPreviousPage").disabled = page === 0; $("analysisNextPage").disabled = page + 1 >= pages;
  }
  async function analyzeSelected() {
    if (!config.topic) { notice("请先选择一个完整 Topic"); return; }
    config = { ...config, fields: [...new Set($("analysisFields").value.split(/[,，\n]/).map(path => path.trim()).filter(Boolean))] };
    const snapshot = records();
    if (!snapshot.length) { notice("请先选择消息"); return; }
    captureFrozen = true; renderStats();
    const token = ++revision;
    running = true; report = null; updateExports(); setTab("changes");
    $("analysisChangesTable").replaceChildren(); $("analysisSkippedRows").replaceChildren();
    try {
      const job = session.createSequenceAnalysis(snapshot, config);
      let state;
      do {
        if (token !== revision) return;
        state = job.step(20);
        $("analysisResultSummary").textContent = "正在分析 " + state.processed + " / " + state.total + " 条消息…";
        if (!state.done) await new Promise(resolve => setTimeout(resolve, 0));
      } while (!state.done);
      if (token !== revision) return;
      const sequence = state.result, matrixJob = session.createMatrixAnalysis(snapshot, config);
      do {
        if (token !== revision) return;
        state = matrixJob.step(20);
        $("analysisResultSummary").textContent = "正在生成字段表 " + state.processed + " / " + state.total + " 条…";
        if (!state.done) await new Promise(resolve => setTimeout(resolve, 0));
      } while (!state.done);
      if (token !== revision) return;
      report = { ...sequence, matrix: state.result };
      if (new TextEncoder().encode(JSON.stringify(report)).byteLength > limits.maxReportBytes) throw new Error("分析报告超过 8 MiB，请减少 N 或字段数");
      running = false; page = 0;
      const count = report.counts;
      $("analysisResultSummary").textContent = count.messages + " 条消息 · " + report.matrix.columns.length + " 个字段 · " + count.changes + " 条变化 · 未变化的消息已保留" + (report.matrix.counts.invalid ? " · " + report.matrix.counts.invalid + " 条无法解析" : "") + (report.limited ? "\n结果不完整：" + report.limitations.join("；") : "") + (report.matrix.limited ? "\n字段表不完整：" + report.matrix.limitReason : "");
      $("analysisSkippedSummary").textContent = "分析依据与未比较说明" + (count.skipped ? "（" + count.skipped + " 条）" : "");
      const statistics = document.createElement("p"); statistics.textContent = count.objects + " 个对象 · " + count.comparedPairs + " 次相邻比较 · " + count.unchangedPairs + " 次无变化 · " + count.fields + " 个变化字段。变化标记只比较已确认的同一对象。"; $("analysisSkippedRows").append(statistics);
      for (const item of report.skipped) { const p = document.createElement("p"); p.textContent = "#" + item.order + " " + item.id + "：" + item.reason; $("analysisSkippedRows").append(p); }
      renderChanges(); updateExports();
    } catch (error) { if (token === revision) { running = false; report = null; $("analysisResultSummary").textContent = error.message; updateExports(); } }
  }
  async function chooseLatest() {
    if (!config.topic) { notice("请先选择一个完整 Topic"); return; }
    const input = $("analysisLatestCount");
    if (!input.checkValidity() || !Number.isInteger(Number(input.value)) || Number(input.value) < 1) { input.reportValidity(); notice("N 必须是 1–1000 的整数"); return; }
    const n = Number(input.value), latest = cache.latest(n, config.topicGroup, config.topic);
    invalidateReport(); selected.clear(); pinnedId = null; clearCurrent(); invalidateComparison("已选择最新消息，可保留 A/B 对比或查看变化列表");
    for (const record of latest) selected.add(record.event.id);
    if (latest.length) showCurrent(latest.at(-1).event.id);
    renderSelection(); source.refreshSelectionMarks();
    notice("已取当前完整 Topic 最新 " + latest.length + " 条" + (latest.length < n ? "（请求 " + n + " 条，缓存不足）" : "") + "；保留未变化消息，不混入其他 Topic。");
    await analyzeSelected();
  }
  async function fetchLatest() {
    if (!config.topic) { notice("请先选择一个完整 Topic"); return; }
    const input = $("analysisLatestCount"), n = Number(input.value);
    if (!input.checkValidity() || !Number.isInteger(n) || n < 1) { input.reportValidity(); notice("N 必须是 1–1000 的整数"); return; }
    const live = source.events().filter(event => session.inScope({ event }, config)).map(event => ({ event, connection: source.connection(event.connectionId), order: source.sequence(event.id) })).sort((a, b) => a.order - b.order).slice(-n);
    if (!live.length) { notice("MQTT 当前缓存中没有此完整 Topic 的消息，本轮数据和结果保持不变。"); return; }
    const result = cache.appendBatch(live);
    if (!result.ok) { notice("未获取新一轮消息：" + result.reason + "。原有缓存、选择和结果保持不变。"); return; }
    captureFrozen = true; frozenSkipped = 0;
    invalidateReport(); selected.clear(); pinnedId = null; clearCurrent(); invalidateComparison("已手动获取新一轮消息");
    for (const { event } of live) selected.add(event.id);
    showCurrent(live.at(-1).event.id); renderSelection(); source.refreshSelectionMarks(); renderStats();
    notice("已手动获取当前完整 Topic 最新 " + live.length + " 条" + (live.length < n ? "（请求 " + n + " 条，MQTT 当前缓存不足）" : "") + "并冻结；旧缓存消息保留，不自动接收后续消息。");
    await analyzeSelected();
  }
  function download(mode) {
    try {
      const value = session.buildExport(mode, records(), report, config, source.version());
      const text = JSON.stringify(value, null, 2);
      if (new TextEncoder().encode(text).byteLength > limits.maxExportBytes) throw new Error("格式化导出超过 64 MiB，请减少 N");
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" })), link = document.createElement("a");
      link.href = url; link.download = "mqtt-analysis-" + mode + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      $("analysisExportStatus").textContent = "已导出 " + records().length + " 条所选消息对应的" + (mode === "changes" ? "变化列表" : mode === "raw" ? "原始数据" : "变化列表和原始数据");
    } catch (error) { $("analysisExportStatus").textContent = error.message; }
  }
  function quickAdd(withPrevious) {
    const id = source.selectedId(); if (!source.event(id)) return;
    addIds([id], true); open();
    if (!find(id) || !selected.has(id)) return;
    if (withPrevious) {
      const prior = runtime.previous(scopedRecords().map(item => item.event), id, config, inspect);
      if (prior.event) addIds([prior.event.id]);
      comparePrevious();
    }
  }
  function clearSelection() {
    selected.clear(); pinnedId = null; clearCurrent(); invalidateComparison("已清空分析选择，独立缓存消息保留"); invalidateReport("请选择消息后分析"); renderSelection(); source.refreshSelectionMarks();
  }
  globalThis.__MQTT_PANEL_ANALYSIS__ = {
    onPacket: (event, connection) => capture(event, connection, source.sequence(event.id)),
    onSelect() { const enabled = Boolean(source.event(source.selectedId())); $("quickComparePrevious").disabled = !enabled; $("quickAddAnalysis").disabled = !enabled; },
    onSourceEvict(id) { if (currentId === id) $("analysisViewInMqtt").disabled = true; if (source.selectedId() === id) { $("quickComparePrevious").disabled = true; $("quickAddAnalysis").disabled = true; } },
    hasMessage: id => selected.has(id), toggleMessage: toggle,
    openTopic(topic) { selectTopicGroup(topic); open("changes"); }
  };
  for (const event of source.events()) if (event.kind === "packet") capture(event, source.connection(event.connectionId), source.sequence(event.id));
  source.port.onDisconnect?.addListener(() => { sourceDisconnected = true; renderStats(); notice("捕获通道断开。独立缓存已有数据仍可分析和导出。"); });
  $("quickComparePrevious").addEventListener("click", () => quickAdd(true)); $("quickAddAnalysis").addEventListener("click", () => quickAdd(false));
  $("openAnalysisSelection").addEventListener("click", () => open());
  $("addFilteredToAnalysis").addEventListener("click", () => {
    const topic = source.selectedTopic();
    if (topic !== "all") selectTopicGroup(topic);
    const ids = source.filteredIds().reverse();
    // Bulk additions must not infer a different scope from a lone filtered row.
    if (!config.topic) notice("请展开 Topic 分组，选择其中一个完整 Topic 后再加入筛选结果");
    else addIds(ids.filter(id => source.event(id)?.packet.topic === config.topic));
    open();
  });
  $("analysisTopicGroup").addEventListener("change", () => selectTopicGroup($("analysisTopicGroup").value));
  $("analysisSelectLatest").addEventListener("click", chooseLatest); $("analysisRun").addEventListener("click", analyzeSelected);
  $("analysisFetchLatest").addEventListener("click", fetchLatest);
  $("analysisLatestCount").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); chooseLatest(); } });
  $("analysisPoolClear").addEventListener("click", clearSelection);
  $("analysisClearCache").addEventListener("click", () => { cache.clear(); captureFrozen = false; frozenSkipped = 0; clearSelection(); renderStats(); notice("独立缓存已手动清空，已恢复接收；再次开始分析后会冻结。MQTT 原列表未清空。"); });
  for (const id of ["analysisChooseMessages", "analysisAddMore"]) $(id).addEventListener("click", () => navigation.activate("mqtt"));
  $("analysisViewInMqtt").addEventListener("click", () => { const event = source.event(currentId); if (event) { source.select(event); navigation.activate("mqtt"); } else notice("消息已从 MQTT 原列表淘汰，仍可在原始数据页查看独立副本"); });
  $("comparePrevious").addEventListener("click", comparePrevious);
  $("comparePin").addEventListener("click", () => { pinnedId = currentId; renderSelection(); });
  $("compareManual").addEventListener("click", () => {
    const left = find($("compareASelect").value), right = find($("compareBSelect").value);
    if (right) showCurrent(right.event.id); compare(left, right, "手动比较（同一完整 Topic）"); renderSelection();
  });
  for (const id of ["compareASelect", "compareBSelect"]) $(id).addEventListener("change", () => { $("compareManual").disabled = !$("compareASelect").value || !$("compareBSelect").value || $("compareASelect").value === $("compareBSelect").value; });
  const tabs = [["changes", "Changes"], ["diff", "Diff"], ["raw", "Raw"]];
  for (const [name, suffix] of tabs) {
    $("analysis" + suffix + "Tab").addEventListener("click", () => setTab(name));
    $("analysis" + suffix + "Tab").addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); setTab(event.key === "Home" ? "changes" : event.key === "End" ? "raw" : tabs[(tabs.findIndex(item => item[0] === activeTab) + (event.key === "ArrowRight" ? 1 : 2)) % 3][0], true);
    });
  }
  const search = globalThis.__MQTT_LOCAL_DEVTOOLS_PANEL_RUNTIME__.createDebouncer(() => { page = 0; renderChanges(); }, 150);
  $("analysisChangeSearch").addEventListener("input", () => search.schedule());
  $("analysisChangeView").addEventListener("change", () => { page = 0; renderChanges(); });
  $("analysisPreviousPage").addEventListener("click", () => { page -= 1; renderChanges(); }); $("analysisNextPage").addEventListener("click", () => { page += 1; renderChanges(); });
  $("analysisExportChanges").addEventListener("click", () => download("changes")); $("analysisExportRaw").addEventListener("click", () => download("raw")); $("analysisExportCombined").addEventListener("click", () => download("combined"));
  $("analysisFields").addEventListener("input", () => { config = { ...config, fields: [...new Set($("analysisFields").value.split(/[,，\n]/).map(path => path.trim()).filter(Boolean))] }; invalidateReport("关注字段已更改，请点“开始分析”"); });
  $("analysisFields").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); chooseLatest(); } });
  $("analysisResetFields").addEventListener("click", () => { $("analysisFields").value = ""; config = { ...config, fields: [] }; invalidateReport("已切换为全部字段，请点“开始分析”"); $("analysisFields").focus(); });
  renderStats(); renderSelection(); setTab("changes");
})();
