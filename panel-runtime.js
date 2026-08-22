(function installPanelRuntime(globalObject) {
  "use strict";

  function defaultNow() {
    return globalObject.performance?.now?.() ?? Date.now();
  }

  function appendWithLimit(items, item, limit) {
    const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
    const removeCount = Math.max(0, items.length - safeLimit + 1);
    const removed = removeCount ? items.splice(0, removeCount) : [];
    items.push(item);
    return removed;
  }

  function createRenderScheduler(render, options = {}) {
    const intervalMs = options.intervalMs ?? 33;
    const now = options.now || defaultNow;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    let timerId = null;
    let lastRenderedAt = Number.NEGATIVE_INFINITY;

    function run() {
      timerId = null;
      lastRenderedAt = now();
      render();
    }

    function schedule() {
      if (timerId !== null) return;
      const elapsed = now() - lastRenderedAt;
      timerId = setTimer(run, Math.max(0, intervalMs - elapsed));
    }

    function cancel() {
      if (timerId === null) return;
      clearTimer(timerId);
      timerId = null;
    }

    function flush() {
      cancel();
      run();
    }

    return Object.freeze({ schedule, cancel, flush });
  }

  function connectionSignature(connections, labelForConnection) {
    return connections
      .map((connection) => `${connection.id}\u0001${labelForConnection(connection)}`)
      .join("\u0002");
  }

  function syncConnectionSelect(
    select,
    connections,
    selectedConnectionId,
    OptionConstructor = globalObject.Option,
    labelForConnection = (connection) => connection.clientId || connection.id
  ) {
    const signature = connectionSignature(connections, labelForConnection);
    const changed = select.dataset.connectionSignature !== signature;

    if (changed) {
      const options = [new OptionConstructor("全部连接", "all")];
      for (const connection of connections) {
        options.push(new OptionConstructor(labelForConnection(connection), connection.id));
      }
      select.replaceChildren(...options);
      select.dataset.connectionSignature = signature;
    }

    const desiredValue = selectedConnectionId === "all" || connections.some((item) => item.id === selectedConnectionId)
      ? selectedConnectionId
      : "all";
    if (select.value !== desiredValue) select.value = desiredValue;
    return changed;
  }

  function reconcileKeyedChildren(container, items, keyForItem, createNode, updateNode = () => {}) {
    const existingNodes = new Map();
    for (const node of Array.from(container.children)) {
      existingNodes.set(node.dataset.renderKey, node);
    }

    const desiredKeys = new Set(items.map((item) => String(keyForItem(item))));
    let removed = 0;
    for (const node of Array.from(container.children)) {
      if (desiredKeys.has(node.dataset.renderKey)) continue;
      container.removeChild(node);
      existingNodes.delete(node.dataset.renderKey);
      removed += 1;
    }

    let created = 0;
    let reused = 0;
    items.forEach((item, index) => {
      const key = String(keyForItem(item));
      let node = existingNodes.get(key);
      if (node) {
        reused += 1;
      } else {
        node = createNode(item);
        node.dataset.renderKey = key;
        existingNodes.set(key, node);
        created += 1;
      }

      updateNode(node, item);
      const currentNode = container.children[index] || null;
      if (currentNode !== node) container.insertBefore(node, currentNode);
    });

    return { created, removed, reused };
  }

  function visiblePacketsByTimeOrder(packets, limit, timeOrder) {
    const visible = packets.slice(-limit);
    return timeOrder === "asc" ? visible : visible.reverse();
  }

  function virtualWindow(items, options = {}) {
    const rowHeight = Math.max(1, Number(options.rowHeight) || 46);
    const overscan = Math.max(0, Math.floor(Number(options.overscan) || 0));
    const viewportHeight = Math.max(0, Number(options.viewportHeight) || 0);
    const maxScrollTop = Math.max(0, items.length * rowHeight - viewportHeight);
    const scrollTop = Math.min(Math.max(0, Number(options.scrollTop) || 0), maxScrollTop);
    const firstVisible = Math.floor(scrollTop / rowHeight);
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const start = Math.max(0, firstVisible - overscan);
    const end = Math.min(items.length, firstVisible + visibleCount + overscan);
    return {
      start,
      end,
      topHeight: start * rowHeight,
      bottomHeight: Math.max(0, (items.length - end) * rowHeight),
      items: items.slice(start, end)
    };
  }

  function createDebouncer(callback, waitMs = 150, options = {}) {
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    let timerId = null;
    function schedule(...args) {
      if (timerId !== null) clearTimer(timerId);
      timerId = setTimer(() => {
        timerId = null;
        callback(...args);
      }, waitMs);
    }
    function cancel() {
      if (timerId === null) return;
      clearTimer(timerId);
      timerId = null;
    }
    function flush(...args) {
      cancel();
      callback(...args);
    }
    return Object.freeze({ schedule, cancel, flush });
  }

  function formatRelativeTime(timestamp, now = Date.now()) {
    const elapsed = Math.max(0, now - Number(timestamp || 0));
    if (elapsed < 1000) return "刚刚";
    if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)} 秒前`;
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
    return `${Math.floor(elapsed / 86_400_000)} 天前`;
  }

  function packetMessageRate(events, now = Date.now(), windowMs = 1000) {
    const safeWindow = Math.max(1, Number(windowMs) || 1000);
    const windowStart = now - safeWindow;
    const packetCount = events.reduce((count, event) => (
      event?.kind === "packet" && event.timestamp > windowStart && event.timestamp <= now
        ? count + 1
        : count
    ), 0);
    return Math.round((packetCount * 1000) / safeWindow);
  }

  function packetTopics(event) {
    if (typeof event?.packet?.topic === "string" && event.packet.topic) {
      return [event.packet.topic];
    }
    if (Array.isArray(event?.packet?.topics)) {
      return event.packet.topics
        .map((item) => item?.topic)
        .filter((topic) => typeof topic === "string" && topic);
    }
    return [];
  }

  function topicGroupKey(topic, depth = 3) {
    const source = String(topic || "");
    const segments = source.split("/").filter(Boolean);
    if (!segments.length) return source;
    return segments.slice(0, Math.max(1, depth)).join("/");
  }

  function eventMatchesTopicGroup(event, group, depth = 3) {
    if (!group || group === "all") return true;
    return packetTopics(event).some((topic) => topicGroupKey(topic, depth) === group);
  }

  function eventMatchesTopic(event, selectedTopic) {
    if (!selectedTopic || selectedTopic === "all") return true;
    return packetTopics(event).includes(selectedTopic);
  }

  function groupPacketTopicTree(events, options = {}) {
    const selectedConnectionId = options.connectionId || "all";
    const search = String(options.search || "").trim().toLocaleLowerCase();
    const depth = options.depth || 3;
    const stableOrder = options.stableOrder === true;
    const groups = new Map();

    for (const event of events) {
      if (event?.kind !== "packet") continue;
      if (selectedConnectionId !== "all" && event.connectionId !== selectedConnectionId) continue;
      for (const topic of packetTopics(event)) {
        const groupName = topicGroupKey(topic, depth);
        if (!groupName) continue;
        let group = groups.get(groupName);
        if (!group) {
          group = { name: groupName, count: 0, topics: new Map() };
          groups.set(groupName, group);
        }
        group.count += 1;
        group.topics.set(topic, (group.topics.get(topic) || 0) + 1);
      }
    }

    return Array.from(groups.values())
      .map((group) => {
        const groupMatches = !search || group.name.toLocaleLowerCase().includes(search);
        const topics = Array.from(group.topics, ([name, count]) => ({ name, count }))
          .filter((topic) => groupMatches || topic.name.toLocaleLowerCase().includes(search))
          .sort((left, right) => stableOrder
            ? left.name.localeCompare(right.name)
            : right.count - left.count || left.name.localeCompare(right.name));
        return { name: group.name, count: group.count, topics, groupMatches };
      })
      .filter((group) => group.groupMatches || group.topics.length > 0)
      .map(({ groupMatches, ...group }) => group)
      .sort((left, right) => stableOrder
        ? left.name.localeCompare(right.name)
        : right.count - left.count || left.name.localeCompare(right.name));
  }

  function groupPacketTopics(events, options = {}) {
    return groupPacketTopicTree(events, options).map(({ name, count }) => ({ name, count }));
  }

  function createTopicCounterIndex(options = {}) {
    const depth = options.depth || 3;
    const all = new Map();
    const byConnection = new Map();

    function mutateMap(groups, topic, delta) {
      const groupName = topicGroupKey(topic, depth);
      if (!groupName) return;
      let group = groups.get(groupName);
      if (!group && delta > 0) {
        group = { name: groupName, count: 0, topics: new Map() };
        groups.set(groupName, group);
      }
      if (!group) return;
      group.count += delta;
      const nextTopicCount = (group.topics.get(topic) || 0) + delta;
      if (nextTopicCount > 0) group.topics.set(topic, nextTopicCount);
      else group.topics.delete(topic);
      if (group.count <= 0 || !group.topics.size) groups.delete(groupName);
    }

    function mutate(event, delta) {
      if (event?.kind !== "packet") return;
      const topics = packetTopics(event);
      let connectionGroups = byConnection.get(event.connectionId);
      if (!connectionGroups && delta > 0) {
        connectionGroups = new Map();
        byConnection.set(event.connectionId, connectionGroups);
      }
      for (const topic of topics) {
        mutateMap(all, topic, delta);
        if (connectionGroups) mutateMap(connectionGroups, topic, delta);
      }
      if (connectionGroups && !connectionGroups.size) byConnection.delete(event.connectionId);
    }

    function groups(options = {}) {
      const source = options.connectionId && options.connectionId !== "all"
        ? byConnection.get(options.connectionId) || new Map()
        : all;
      const search = String(options.search || "").trim().toLocaleLowerCase();
      const stableOrder = options.stableOrder === true;
      return Array.from(source.values())
        .map((group) => {
          const groupMatches = !search || group.name.toLocaleLowerCase().includes(search);
          const topics = Array.from(group.topics, ([name, count]) => ({ name, count }))
            .filter((topic) => groupMatches || topic.name.toLocaleLowerCase().includes(search))
            .sort((left, right) => stableOrder
              ? left.name.localeCompare(right.name)
              : right.count - left.count || left.name.localeCompare(right.name));
          return { name: group.name, count: group.count, topics, groupMatches };
        })
        .filter((group) => group.groupMatches || group.topics.length)
        .map(({ groupMatches, ...group }) => group)
        .sort((left, right) => stableOrder
          ? left.name.localeCompare(right.name)
          : right.count - left.count || left.name.localeCompare(right.name));
    }

    function clear() {
      all.clear();
      byConnection.clear();
    }

    return Object.freeze({
      add: (event) => mutate(event, 1),
      clear,
      groups,
      remove: (event) => mutate(event, -1)
    });
  }

  function constrainPaneWidths(containerWidth, requestedLeft, requestedRight, options = {}) {
    const minLeft = options.minLeft ?? 180;
    const minCenter = options.minCenter ?? 360;
    const minRight = options.minRight ?? 280;
    const maxLeft = options.maxLeft ?? 520;
    const maxRight = options.maxRight ?? 720;
    const gutters = options.gutters ?? 14;
    const activePane = options.activePane || "both";
    const available = Math.max(0, Number(containerWidth) - gutters);
    const clamp = (value, minimum, maximum) => Math.min(Math.max(Number(value), minimum), maximum);

    let left = clamp(requestedLeft, minLeft, maxLeft);
    let right = clamp(requestedRight, minRight, maxRight);
    if (activePane === "left") {
      right = clamp(right, minRight, Math.max(minRight, available - minCenter - minLeft));
      left = clamp(left, minLeft, Math.max(minLeft, Math.min(maxLeft, available - minCenter - right)));
    } else {
      left = clamp(left, minLeft, Math.max(minLeft, available - minCenter - minRight));
      right = clamp(right, minRight, Math.max(minRight, Math.min(maxRight, available - minCenter - left)));
    }

    return { left, center: Math.max(0, available - left - right), right };
  }

  function findTextMatches(text, query) {
    const source = String(text ?? "");
    const keyword = String(query ?? "");
    if (!keyword) return [];

    const sourceLower = source.toLocaleLowerCase();
    const keywordLower = keyword.toLocaleLowerCase();
    const matches = [];
    let offset = 0;
    while (offset <= source.length - keyword.length) {
      const start = sourceLower.indexOf(keywordLower, offset);
      if (start < 0) break;
      matches.push({ start, end: start + keyword.length });
      offset = start + keyword.length;
    }
    return matches;
  }

  function observeSourceSession(sourceSessions, event) {
    if (event?.kind !== "hook-ready" || event.sourceTab?.id === undefined || !event.sessionId) return null;
    const sourceTabId = event.sourceTab.id;
    const sessionId = String(event.sessionId);
    const previousSessionId = sourceSessions.get(sourceTabId);
    sourceSessions.set(sourceTabId, sessionId);
    return {
      changed: previousSessionId !== undefined && previousSessionId !== sessionId,
      previousSessionId,
      sessionId,
      sourceTabId
    };
  }

  function pruneSourceTabData(events, connections, sourceTabId) {
    const removedEventIds = new Set();
    const remainingEvents = events.filter((event) => {
      const remove = event.sourceTab?.id === sourceTabId;
      if (remove) removedEventIds.add(event.id);
      return !remove;
    });

    const remainingConnections = new Map();
    const removedConnectionIds = new Set();
    for (const [connectionId, connection] of connections) {
      if (connection.sourceTab?.id === sourceTabId) removedConnectionIds.add(connectionId);
      else remainingConnections.set(connectionId, connection);
    }

    return {
      connections: remainingConnections,
      events: remainingEvents,
      removedConnectionIds,
      removedEventIds
    };
  }

  const api = Object.freeze({
    appendWithLimit,
    constrainPaneWidths,
    createDebouncer,
    createRenderScheduler,
    createTopicCounterIndex,
    eventMatchesTopic,
    eventMatchesTopicGroup,
    findTextMatches,
    formatRelativeTime,
    groupPacketTopicTree,
    groupPacketTopics,
    observeSourceSession,
    packetMessageRate,
    packetTopics,
    pruneSourceTabData,
    reconcileKeyedChildren,
    syncConnectionSelect,
    topicGroupKey,
    virtualWindow,
    visiblePacketsByTimeOrder
  });
  globalObject.__MQTT_LOCAL_DEVTOOLS_PANEL_RUNTIME__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
