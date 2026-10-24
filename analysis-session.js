(function installAnalysisSession(globalObject) {
  "use strict";
  const runtime = globalObject.__MQTT_LOCAL_DEVTOOLS_ANALYSIS_RUNTIME__ || (typeof require === "function" ? require("./analysis-runtime.js") : null);
  const buffers = globalObject.__MQTT_LOCAL_DEVTOOLS_RING_BUFFER__ || (typeof require === "function" ? require("./ring-buffer.js") : null);
  const panel = globalObject.__MQTT_LOCAL_DEVTOOLS_PANEL_RUNTIME__ || (typeof require === "function" ? require("./panel-runtime.js") : null);
  const LIMITS = Object.freeze({ maxItems: 5000, maxBytes: 32 * 1024 * 1024, maxSelected: 1000, maxChanges: 10000, maxFields: 2000, maxReportBytes: 8 * 1024 * 1024, maxExportBytes: 64 * 1024 * 1024 });
  const clone = value => JSON.parse(JSON.stringify(value));
  // Use the same three-segment rule as the MQTT Topic sidebar. Control packets
  // with multiple subscriptions are excluded so raw exports cannot span groups.
  function topicGroup(event) {
    return event?.packet?.typeName === "PUBLISH" && typeof event.packet.topic === "string" && event.packet.topic
      ? panel.topicGroupKey(event.packet.topic, 3) : null;
  }
  function inTopicGroup(record, group) { return typeof group === "string" && group.length > 0 && topicGroup(record.event) === group; }
  function inScope(record, config) { return (config.topicGroup === undefined || inTopicGroup(record, config.topicGroup)) && (config.topic === undefined || (topicGroup(record.event) !== null && record.event.packet.topic === config.topic)); }
  function validateScope(records, config) {
    if ((config.topicGroup !== undefined && !config.topicGroup) || records.some(record => !inScope(record, config))) throw new Error("所选消息不属于当前完整 Topic / Topic 分组，请重新选择");
  }
  function createCache(options = {}) {
    const maxItems = Math.max(1, Math.floor(Number(options.maxItems ?? LIMITS.maxItems) || 1)), maxBytes = Math.max(1, Math.floor(Number(options.maxBytes ?? LIMITS.maxBytes) || 1));
    const ring = buffers.createBoundedRingBuffer({ maxItems, maxBytes });
    const byId = new Map();
    let sequence = 0, rejected = 0, skipped = 0, revision = 0, fullReason = "";
    function append(event, connection = {}, captureOrder) {
      if (event?.kind !== "packet" || !event.id || byId.has(event.id)) return { added: false, removed: [] };
      if (fullReason) { skipped += 1; revision += 1; return { added: false, removed: [], full: true }; }
      const order = Number.isSafeInteger(captureOrder) && captureOrder > 0 ? captureOrder : sequence + 1;
      sequence = Math.max(sequence, order);
      const record = clone({ event, connection, order });
      const size = buffers.serializedByteLength(record);
      // Protect captured evidence: never ask the ring to evict existing records.
      // Once full, refuse further input until the user explicitly clears it.
      if (size > maxBytes) { rejected += 1; revision += 1; return { added: false, removed: [], rejected: true }; }
      if (ring.length >= maxItems || ring.totalBytes + size > maxBytes) {
        fullReason = ring.length >= maxItems ? "items" : "bytes";
        skipped += 1; revision += 1;
        return { added: false, removed: [], full: true };
      }
      ring.append(record, size); byId.set(event.id, record); revision += 1;
      if (ring.length === maxItems || ring.totalBytes === maxBytes) fullReason = ring.length === maxItems ? "items" : "bytes";
      return { added: true, removed: [], full: Boolean(fullReason) };
    }
    function remove(id) {
      if (!byId.has(id)) return;
      ring.removeWhere(record => record.event.id === id); byId.delete(id); revision += 1;
    }
    function appendBatch(input) {
      if (!Array.isArray(input) || input.length > LIMITS.maxSelected) return { ok: false, reason: "最多一次获取 1000 条消息" };
      const pending = [], seen = new Set(); let addedBytes = 0, nextOrder = sequence;
      for (const item of input) {
        if (item?.event?.kind !== "packet" || !item.event.id) return { ok: false, reason: "获取的消息无效" };
        if (byId.has(item.event.id) || seen.has(item.event.id)) continue;
        if (fullReason) return { ok: false, reason: "独立缓存已满，请先导出并手动清空缓存" };
        if (ring.length + pending.length >= maxItems) return { ok: false, reason: "独立缓存剩余条数不足，请先导出并手动清空缓存" };
        const order = Number.isSafeInteger(item.order) && item.order > 0 ? item.order : nextOrder + 1;
        nextOrder = Math.max(nextOrder, order);
        const record = clone({ event: item.event, connection: item.connection || {}, order }), size = buffers.serializedByteLength(record);
        if (ring.totalBytes + addedBytes + size > maxBytes) return { ok: false, reason: "独立缓存剩余容量不足或单条消息过大，请减少 N 或手动清空缓存" };
        pending.push({ record, size }); seen.add(item.event.id); addedBytes += size;
      }
      // Commit only after the complete sample fits; failures keep the prior round intact.
      for (const { record, size } of pending) { ring.append(record, size); byId.set(record.event.id, record); }
      sequence = nextOrder;
      if (pending.length) revision += 1;
      if (ring.length === maxItems || ring.totalBytes === maxBytes) fullReason = ring.length === maxItems ? "items" : "bytes";
      return { ok: true, added: pending.length };
    }
    const records = () => ring.toArray().sort((a, b) => a.order - b.order);
    return Object.freeze({ append, appendBatch, remove, get: id => byId.get(id), records,
      latest(n, group, topic) { if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxSelected) throw new Error("N 必须是 1–1000 的整数"); return records().filter(record => inScope(record, { topicGroup: group, topic })).slice(-n); },
      topics() {
        const counts = new Map();
        for (const record of byId.values()) if (topicGroup(record.event) !== null) { const topic = record.event.packet.topic; counts.set(topic, (counts.get(topic) || 0) + 1); }
        return [...counts].map(([name, count]) => ({ name, count, group: panel.topicGroupKey(name, 3) })).sort((a, b) => a.name.localeCompare(b.name));
      },
      topicGroups() {
        const counts = new Map();
        for (const record of byId.values()) { const group = topicGroup(record.event); if (group !== null) counts.set(group, (counts.get(group) || 0) + 1); }
        return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
      },
      clear() { ring.clear(); byId.clear(); fullReason = ""; skipped = 0; rejected = 0; revision += 1; },
      stats: () => ({ count: ring.length, bytes: ring.totalBytes, maxItems, maxBytes, evicted: 0, rejected, skipped, full: Boolean(fullReason), fullReason, revision }) });
  }
  function valueType(part) { return !part.exists ? "missing" : part.value === null ? "null" : Array.isArray(part.value) ? "array" : typeof part.value; }
  function compact(part) {
    if (!part.exists) return { exists: false, type: "missing" };
    const type = valueType(part), text = JSON.stringify(part.value);
    return text.length <= 512 ? { exists: true, type, value: part.value } : { exists: true, type, preview: text.slice(0, 512), truncated: true, originalCharacters: text.length };
  }
  function valueText(part) { return !part.exists ? "[字段不存在]" : part.truncated ? part.preview + "… [长值已截断]" : JSON.stringify(part.value); }
  function createMatrixAnalysis(records, config) {
    if (!records.length || records.length > LIMITS.maxSelected) throw new Error("请选择 1–1000 条分析消息");
    validateScope(records, config);
    const ordered = [...records].sort((a, b) => a.order - b.order), columns = new Set(), rows = [], previous = new Map();
    const requested = [...new Set(config.fields || [])], maxColumns = Math.min(100, Math.floor(20000 / ordered.length));
    if (requested.length > maxColumns || requested.some(path => !path || path.length > 256)) throw new Error("字段过多或过长，请减少 N 或字段数（最多 " + maxColumns + " 个字段，每项 256 字符）");
    requested.forEach(path => columns.add(path));
    const ignored = (config.ignorePaths || []).map(runtime.pathParts);
    let phase = requested.length ? "rows" : "columns", index = 0, limited = false, result = null, bytes = 0;
    const read = (value, path) => path === "(根)" ? { exists: true, value } : runtime.field(value, path);
    function discover(record) {
      const parsed = runtime.payload(record.event); if (!parsed.ok) return;
      const stack = [{ value: parsed.value, parts: [] }]; let visited = 0;
      while (stack.length) {
        const { value, parts } = stack.pop();
        if (++visited > 50000 || parts.length > 64) { limited = true; break; }
        if (ignored.some(prefix => prefix.length <= parts.length && prefix.every((part, i) => part === parts[i]))) continue;
        if (value !== null && typeof value === "object" && Object.keys(value).length) {
          const keys = Object.keys(value), remaining = Math.max(0, 50000 - visited - stack.length);
          if (keys.length > remaining) limited = true;
          for (const key of keys.slice(0, remaining).reverse()) stack.push({ value: value[key], parts: [...parts, key] });
        } else {
          const path = parts.length ? "/" + parts.map(part => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/") : "(根)";
          if (!columns.has(path) && columns.size >= maxColumns) { limited = true; continue; }
          columns.add(path);
        }
      }
    }
    function addRow(record) {
      const parsed = runtime.payload(record.event), object = runtime.identity(record.event, config, parsed);
      const row = { id: record.event.id, order: record.order, capturedAt: record.event.timestamp, valid: parsed.ok, reason: parsed.ok ? (object.reliable ? "" : object.reason) : parsed.reason, beforeId: null, cells: [] };
      const prior = object.reliable ? previous.get(object.key) : null;
      if (prior) row.beforeId = prior.event.id;
      const before = prior ? runtime.payload(prior.event) : null;
      for (const path of columns) {
        const part = parsed.ok ? read(parsed.value, path) : { exists: false };
        const old = before?.ok ? read(before.value, path) : null;
        const parts = path === "(根)" ? [] : runtime.pathParts(path);
        const excluded = ignored.some(prefix => prefix.length <= parts.length && prefix.every((key, i) => key === parts[i]));
        const relativeIgnored = ignored.filter(prefix => prefix.length > parts.length && parts.every((key, i) => key === prefix[i])).map(prefix => "/" + prefix.slice(parts.length).map(key => key.replace(/~/g, "~0").replace(/\//g, "~1")).join("/"));
        const comparison = !excluded && old?.exists && part.exists ? runtime.diff(old.value, part.value, relativeIgnored) : null;
        if (comparison?.limited) limited = true;
        const changed = !excluded && old !== null && (old.exists !== part.exists || (comparison?.changes.length > 0));
        row.cells.push({ ...compact(part), changed, ...(changed ? { kind: !old.exists ? "新增" : !part.exists ? "删除" : "修改" } : {}) });
      }
      if (object.reliable && parsed.ok) previous.set(object.key, record);
      else {
        // An unknown record may belong to any device in this source/connection/topic/direction.
        for (const [key, old] of previous) if (old.event.connectionId === record.event.connectionId && old.event.direction === record.event.direction && old.event.sourceTab?.id === record.event.sourceTab?.id && old.event.packet.topic === record.event.packet.topic) previous.delete(key);
      }
      bytes += buffers.serializedByteLength(row);
      if (bytes > LIMITS.maxReportBytes / 2) throw new Error("字段表超过 4 MiB，请减少 N 或字段数");
      rows.push(row);
    }
    return { step(batchSize = 20) {
      if (result) return { done: true, processed: ordered.length, total: ordered.length, result };
      const end = Math.min(index + Math.max(1, batchSize), ordered.length);
      while (index < end) (phase === "columns" ? discover : addRow)(ordered[index++]);
      if (index === ordered.length) {
        if (phase === "columns") { phase = "rows"; index = 0; }
        else result = { format: "message-field-matrix-v1", topic: config.topic, columns: [...columns], rows, limited, limitReason: limited ? "字段、遍历或单元格比较达到上限，请指定关注字段或减少 N" : "", counts: { messages: rows.length, fields: columns.size, invalid: rows.filter(row => !row.valid).length } };
      }
      return { done: result !== null, processed: index, total: ordered.length, result };
    } };
  }
  function createSequenceAnalysis(records, config, options = {}) {
    if (!records.length || records.length > LIMITS.maxSelected) throw new Error("请选择 1–1000 条分析消息");
    validateScope(records, config);
    const ordered = [...records].sort((a, b) => a.order - b.order);
    const groups = new Map(), fields = new Map(), changes = [], pairs = [], skipped = [], reasons = new Set();
    const maxChanges = options.maxChanges ?? LIMITS.maxChanges, maxFields = options.maxFields ?? LIMITS.maxFields;
    const changeBudget = options.changeBudget ?? 2 * 1024 * 1024;
    let index = 0, compared = 0, unchanged = 0, retainedBytes = 0, result = null;
    function addChange(change, group, prior, record) {
      if (changes.length >= maxChanges) { reasons.add("变化条目达到上限"); return; }
      const row = { index: changes.length + 1, groupId: group.id, beforeId: prior.event.id, afterId: record.event.id,
        beforeOrder: prior.order, afterOrder: record.order, beforeCapturedAt: prior.event.timestamp, afterCapturedAt: record.event.timestamp,
        path: change.path, kind: change.kind, typeChanged: change.before.exists && change.after.exists && valueType(change.before) !== valueType(change.after), before: compact(change.before), after: compact(change.after) };
      const bytes = buffers.serializedByteLength(row);
      if (retainedBytes + bytes > changeBudget) { reasons.add("变化内容达到容量上限"); return; }
      changes.push(row); retainedBytes += bytes;
      const key = JSON.stringify([group.id, row.path]);
      let field = fields.get(key);
      if (!field) {
        if (fields.size >= maxFields) { reasons.add("变化字段达到上限"); return; }
        field = { groupId: group.id, path: row.path, count: 0, first: row.before, last: row.after, firstBeforeId: row.beforeId, lastAfterId: row.afterId,
          flow: [row.before], kinds: new Set(), types: false, numeric: true, up: false, down: false, returned: false, firstKey: JSON.stringify(change.before), lastKey: "" };
        fields.set(key, field);
      }
      field.count += 1; field.last = row.after; field.lastAfterId = row.afterId; field.kinds.add(row.kind); field.types ||= row.typeChanged;
      if (field.flow.length < 16) field.flow.push(row.after);
      field.numeric &&= valueType(change.before) === "number" && valueType(change.after) === "number";
      if (field.numeric) { field.up ||= change.after.value > change.before.value; field.down ||= change.after.value < change.before.value; }
      field.lastKey = JSON.stringify(change.after);
      field.returned ||= field.count > 1 && field.lastKey === field.firstKey;
    }
    function process(record) {
      const parsed = runtime.payload(record.event), object = runtime.identity(record.event, config, parsed);
      if (!object.reliable) {
        skipped.push({ id: record.event.id, order: record.order, reason: object.reason });
        // An unidentified record can belong to any object in this topic. Do not bridge it.
        for (const group of groups.values()) {
          if (group.sourceTabId === (record.event.sourceTab?.id ?? null) && group.connectionId === record.event.connectionId && group.topic === record.event.packet.topic && group.direction === record.event.direction) { group.prior = null; group.parsed = null; }
        }
        return;
      }
      let group = groups.get(object.key);
      if (!group) {
        group = { id: "object-" + (groups.size + 1), sourceTabId: record.event.sourceTab?.id ?? null, connectionId: record.event.connectionId,
          topic: record.event.packet.topic, direction: record.event.direction, device: object.device ?? null, count: 0, prior: null, parsed: null };
        groups.set(object.key, group);
      }
      group.count += 1;
      const prior = group.prior, previousPayload = group.parsed;
      group.prior = record; group.parsed = parsed;
      if (!parsed.ok) { skipped.push({ id: record.event.id, order: record.order, reason: parsed.reason }); return; }
      if (!prior) return;
      if (!previousPayload.ok) { skipped.push({ id: record.event.id, order: record.order, beforeId: prior.event.id, reason: "上一条不是完整 JSON，不能跨过此消息推断变化" }); return; }
      compared += 1;
      const difference = runtime.diff(previousPayload.value, parsed.value, config.ignorePaths || []);
      if (config.fields?.length) {
        const focus = config.fields.map(runtime.pathParts);
        difference.changes = difference.changes.filter(change => {
          const parts = change.path === "(根)" ? [] : runtime.pathParts(change.path);
          return focus.some(path => path.slice(0, Math.min(path.length, parts.length)).every((part, i) => part === parts[i]));
        });
      }
      if (difference.limited) reasons.add("部分单次比较达到差异分析上限");
      if (!difference.changes.length && !difference.limited) unchanged += 1;
      const start = changes.length;
      for (const change of difference.changes) addChange(change, group, prior, record);
      pairs.push({ groupId: group.id, beforeId: prior.event.id, afterId: record.event.id, beforeOrder: prior.order, afterOrder: record.order,
        totalChanges: difference.changes.length, retainedChanges: changes.length - start, limited: difference.limited || changes.length - start < difference.changes.length });
    }
    function finish() {
      const summaries = [...fields.values()].map(field => ({ groupId: field.groupId, path: field.path, count: field.count, first: field.first, last: field.last,
        firstBeforeId: field.firstBeforeId, lastAfterId: field.lastAfterId, flow: field.flow, flowTruncated: field.count + 1 > field.flow.length,
        patterns: [field.numeric ? field.up && field.down ? "数值上下波动" : field.up ? field.count > 1 ? "数值持续增加" : "数值增加" : field.down ? field.count > 1 ? "数值持续减少" : "数值减少" : "数值变化" : "值发生切换",
          ...(field.returned ? ["曾回到初始值"] : []), ...(field.types ? ["发生类型变化"] : []), ...[...field.kinds].filter(kind => kind !== "修改").map(kind => "字段" + kind)] }));
      result = { algorithm: "adjacent-object-fields-v1", order: "capture-order", arrayRule: "index", ...(config.topicGroup !== undefined ? { topicGroup: config.topicGroup } : {}), ...(config.topic !== undefined ? { topic: config.topic } : {}), selectedIds: ordered.map(record => record.event.id),
        counts: { messages: ordered.length, objects: groups.size, comparedPairs: compared, unchangedPairs: unchanged, changedPairs: pairs.filter(pair => pair.totalChanges > 0).length, detectedChanges: pairs.reduce((sum, pair) => sum + pair.totalChanges, 0), changes: changes.length, fields: summaries.length, skipped: skipped.length },
        groups: [...groups.values()].map(({ prior, parsed, ...group }) => group), pairs, fields: summaries, changes, skipped,
        limited: reasons.size > 0, limitations: [...reasons], note: "仅描述选中消息的字段变化模式，不推断业务因果；未选消息之间可能存在缺口。长值在报告中截断，原始消息保持完整。" };
      if (buffers.serializedByteLength(result) > LIMITS.maxReportBytes) throw new Error("变化报告超过 8 MiB，请减少 N 或增加忽略字段");
    }
    return Object.freeze({ step(batchSize = 20) {
      if (result) return { done: true, processed: index, total: ordered.length, result };
      const end = Math.min(index + Math.max(1, batchSize), ordered.length);
      while (index < end) process(ordered[index++]);
      if (index === ordered.length) finish();
      return { done: result !== null, processed: index, total: ordered.length, result };
    } });
  }
  function analyze(records, config, options) { const job = createSequenceAnalysis(records, config, options); let state; do { state = job.step(50); } while (!state.done); return state.result; }
  function buildExport(mode, records, report, config, toolVersion, now = Date.now()) {
    if (!["changes", "raw", "combined"].includes(mode)) throw new Error("无效的导出类型");
    if (!records.length || records.length > LIMITS.maxSelected) throw new Error("没有有效的分析选择");
    validateScope(records, config);
    const ordered = [...records].sort((a, b) => a.order - b.order), ids = ordered.map(record => record.event.id);
    if (mode !== "raw" && (!report || report.topicGroup !== config.topicGroup || report.topic !== config.topic || JSON.stringify(report.selectedIds) !== JSON.stringify(ids))) throw new Error("变化结果已失效，请重新分析后导出");
    const value = { format: "mqtt-fault-analysis", formatVersion: 1, mode, toolVersion, exportedAt: new Date(now).toISOString(),
      order: "capture-order", config: clone(config), selection: ids.map((id, index) => ({ id, order: ordered[index].order })),
      ...(mode !== "raw" ? { report } : {}), ...(mode !== "changes" ? { messages: ordered.map(record => ({ order: record.order, event: record.event, connectionAtCapture: record.connection })) } : {}) };
    if (buffers.serializedByteLength(value) > LIMITS.maxExportBytes) throw new Error("导出内容超过 64 MiB，请减少选择数量");
    return value;
  }
  const api = Object.freeze({ LIMITS, topicGroup, inTopicGroup, inScope, createCache, createMatrixAnalysis, createSequenceAnalysis, analyze, buildExport, valueText });
  globalObject.__MQTT_LOCAL_DEVTOOLS_ANALYSIS_SESSION__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
