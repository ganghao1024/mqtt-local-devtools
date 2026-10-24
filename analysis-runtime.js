(function installAnalysisRuntime(globalObject) {
  "use strict";

  const own = (value, key) => value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
  // Dot paths and RFC 6901 JSON Pointers are exact, never recursive field searches.
  function pathParts(path) {
    if (!path) return [];
    return path.startsWith("/")
      ? path.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      : path.split(".");
  }
  function field(value, path) {
    if (!path) return { exists: false };
    for (const part of pathParts(path)) {
      if (!own(value, part)) return { exists: false };
      value = value[part];
    }
    return { exists: true, value };
  }
  function payload(event) {
    if (event?.packet?.payloadTruncated) return { ok: false, reason: "Payload 已截断，不能可靠分析" };
    try {
      if (typeof event?.packet?.payloadText !== "string") throw new Error();
      return { ok: true, value: JSON.parse(event.packet.payloadText) };
    } catch {
      return { ok: false, reason: "非 JSON / 无 Payload" };
    }
  }
  function identity(event, config, parsed = payload(event)) {
    if (event?.packet?.typeName !== "PUBLISH" || !event.packet.topic || !event.connectionId) {
      return { reliable: false, reason: "需要有连接和完整 Topic 的 PUBLISH 消息" };
    }
    const base = [event.sourceTab?.id ?? null, event.connectionId, event.packet.topic, event.direction];
    if (config.devicePath) {
      if (!parsed.ok) return { reliable: false, reason: parsed.reason };
      const device = field(parsed.value, config.devicePath);
      if (!device.exists || device.value === null || device.value === "" ||
          !["string", "number", "boolean"].includes(typeof device.value)) {
        return { reliable: false, reason: "设备标识缺失或不是非空标量，禁止自动匹配" };
      }
      base.push(device.value);
      return { key: JSON.stringify(base), reliable: true, device: device.value };
    }
    return { key: JSON.stringify(base), reliable: config.topicIsObject === true,
      reason: "仅按来源页、连接、Topic 和方向分组；未确认 Topic 独占对象，使用手动比较" };
  }
  function previous(events, currentId, config, inspect = event => ({ object: identity(event, config) })) {
    const index = events.findIndex(event => event.id === currentId);
    if (index < 0) return { reason: "当前消息已被缓存淘汰或页面清理" };
    const object = inspect(events[index]).object;
    if (!object.reliable) return { reason: object.reason, object };
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = inspect(events[i]).object;
      if (candidate.reliable && candidate.key === object.key) return { event: events[i], object };
    }
    return { object, reason: "缓存中没有同一对象的上一条；更早历史可能已淘汰，不能跨缺口推断" };
  }
  const pointer = parts => "/" + parts.map(part => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
  function diff(before, after, ignorePaths = [], options = {}) {
    const changes = [];
    const ignored = ignorePaths.filter(Boolean).map(pathParts);
    const stack = [{ before, after, beforeExists: true, afterExists: true, parts: [] }];
    let visited = 0;
    let limited = false;
    while (stack.length) {
      const item = stack.pop();
      if (ignored.some(parts => parts.length <= item.parts.length && parts.every((part, index) => part === item.parts[index]))) continue;
      if (++visited > (options.maxNodes ?? 50000) || changes.length >= (options.maxChanges ?? 1000) || item.parts.length > 64) {
        limited = true;
        break;
      }
      const { before: left, after: right, beforeExists, afterExists, parts } = item;
      if (beforeExists && afterExists && Object.is(left, right)) continue;
      const leftObject = left !== null && typeof left === "object";
      const rightObject = right !== null && typeof right === "object";
      if ((beforeExists && afterExists && leftObject && rightObject && Array.isArray(left) === Array.isArray(right)) ||
          (!beforeExists && rightObject && Object.keys(right).length) || (!afterExists && leftObject && Object.keys(left).length)) {
        const keys = [...new Set([...(leftObject ? Object.keys(left) : []), ...(rightObject ? Object.keys(right) : [])])];
        for (let i = keys.length - 1; i >= 0; i -= 1) {
          const key = keys[i];
          stack.push({ before: leftObject ? left[key] : undefined, after: rightObject ? right[key] : undefined, beforeExists: own(left, key), afterExists: own(right, key), parts: [...parts, key] });
        }
      } else {
        changes.push({ path: parts.length ? pointer(parts) : "(根)",
          kind: !beforeExists ? "新增" : !afterExists ? "删除" : "修改",
          before: beforeExists ? { exists: true, value: left } : { exists: false },
          after: afterExists ? { exists: true, value: right } : { exists: false } });
      }
    }
    return { changes, limited };
  }
  function createInspector(config) {
    const cache = new WeakMap();
    return event => {
      if (!cache.has(event)) cache.set(event, { object: identity(event, config) });
      return cache.get(event);
    };
  }
  const api = Object.freeze({ pathParts, field, payload, identity, previous, diff, createInspector });
  globalObject.__MQTT_LOCAL_DEVTOOLS_ANALYSIS_RUNTIME__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
