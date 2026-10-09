"use strict";

const extensionApi = globalThis.__MQTT_MONITOR_TEST_API__ || chrome;
const panelRuntime = globalThis.__MQTT_LOCAL_DEVTOOLS_PANEL_RUNTIME__;
const ringBufferApi = globalThis.__MQTT_LOCAL_DEVTOOLS_RING_BUFFER__;
const inspectedTabId = extensionApi.devtools.inspectedWindow.tabId;
const port = extensionApi.runtime.connect({ name: "mqtt-monitor-panel" });
const MAX_STORED_EVENTS = 5000;
const MAX_STORED_BYTES = 32 * 1024 * 1024;
const UI_RENDER_INTERVAL_MS = 125;
const SEARCH_DEBOUNCE_MS = 150;
const VIRTUAL_ROW_HEIGHT = 46;
const VIRTUAL_OVERSCAN = 8;
const TIME_ORDER_STORAGE_KEY = "mqtt-panel-time-order";
const PANE_WIDTH_STORAGE_KEY = "mqtt-panel-pane-widths";
const PANE_LAYOUT = Object.freeze({
  minLeft: 180,
  minCenter: 360,
  minRight: 280,
  maxLeft: 520,
  maxRight: 720,
  gutters: 14
});
const MQTT_TYPE_DESCRIPTIONS = Object.freeze({
  CONNECT: "连接",
  CONNACK: "连接确认",
  PUBLISH: "发布消息",
  PUBACK: "发布确认",
  PUBREC: "发布已接收",
  PUBREL: "发布释放",
  PUBCOMP: "发布完成",
  SUBSCRIBE: "订阅主题",
  SUBACK: "订阅确认",
  UNSUBSCRIBE: "取消订阅",
  UNSUBACK: "取消订阅确认",
  PINGREQ: "心跳请求",
  PINGRESP: "心跳响应",
  DISCONNECT: "断开连接",
  AUTH: "认证"
});
const EMPTY_DETAILS_TEXT = "";

function packetTypeLabel(typeName) {
  const name = String(typeName || "");
  const description = MQTT_TYPE_DESCRIPTIONS[name];
  return description ? name + "(" + description + ")" : name;
}

function loadTimeOrder() {
  try {
    return localStorage.getItem(TIME_ORDER_STORAGE_KEY) === "asc" ? "asc" : "desc";
  } catch {
    return "desc";
  }
}

function loadPaneWidths() {
  try {
    const value = JSON.parse(localStorage.getItem(PANE_WIDTH_STORAGE_KEY) || "null");
    if (Number.isFinite(value?.left) && Number.isFinite(value?.right)) {
      return { left: value.left, right: value.right };
    }
  } catch {
    // Fall back to responsive defaults when storage is unavailable or invalid.
  }
  return { left: null, right: null };
}

const state = {
  events: ringBufferApi.createBoundedRingBuffer({
    maxItems: MAX_STORED_EVENTS,
    maxBytes: MAX_STORED_BYTES
  }),
  eventIds: new Set(),
  searchTextByEventId: new Map(),
  topicIndex: panelRuntime.createTopicCounterIndex(),
  cachedPacketCount: 0,
  receivedPacketCount: 0,
  recentPacketTimestamps: [],
  recentPacketTimestampStart: 0,
  activeSearch: "",
  filteredPacketView: [],
  connections: new Map(),
  sourceSessions: new Map(),
  selectedConnectionId: "all",
  selectedTopicGroup: "all",
  selectedTopic: "all",
  expandedTopicGroups: new Set(),
  topicListInteracting: false,
  forceTopicRender: false,
  selectedEventId: null,
  detailsText: EMPTY_DETAILS_TEXT,
  detailsCopyText: "",
  detailMatches: [],
  detailMatchIndex: 0,
  timeOrder: loadTimeOrder(),
  paneWidths: loadPaneWidths(),
  paused: false,
  pageHookReady: false,
  connectionRenderSignature: "",
  topicRenderSignature: ""
};

const elements = {
  workspace: document.querySelector(".workspace"),
  leftPaneResizer: document.querySelector("#leftPaneResizer"),
  rightPaneResizer: document.querySelector("#rightPaneResizer"),
  connectionFilter: document.querySelector("#connectionFilter"),
  directionFilter: document.querySelector("#directionFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  timeOrderFilter: document.querySelector("#timeOrderFilter"),
  searchInput: document.querySelector("#searchInput"),
  topicSearchInput: document.querySelector("#topicSearchInput"),
  pauseButton: document.querySelector("#pauseButton"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  allConnectionsButton: document.querySelector("#allConnectionsButton"),
  clearTopicFilterButton: document.querySelector("#clearTopicFilterButton"),
  connectionCount: document.querySelector("#connectionCount"),
  connectionsList: document.querySelector("#connectionsList"),
  topicGroupsList: document.querySelector("#topicGroupsList"),
  topicEmptyState: document.querySelector("#topicEmptyState"),
  activeTopicFilter: document.querySelector("#activeTopicFilter"),
  tableWrap: document.querySelector(".table-wrap"),
  packetRows: document.querySelector("#packetRows"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateTitle: document.querySelector("#emptyStateTitle"),
  emptyStateDescription: document.querySelector("#emptyStateDescription"),
  statusIndicator: document.querySelector("#statusIndicator"),
  statusText: document.querySelector("#statusText"),
  packetCount: document.querySelector("#packetCount"),
  resultCount: document.querySelector("#resultCount"),
  headerStats: document.querySelector("#headerStats"),
  detailsSearchInput: document.querySelector("#detailsSearchInput"),
  detailsSearchCount: document.querySelector("#detailsSearchCount"),
  detailsScroll: document.querySelector("#detailsScroll"),
  detailsEmpty: document.querySelector("#detailsEmpty"),
  metadataCard: document.querySelector("#metadataCard"),
  payloadCard: document.querySelector("#payloadCard"),
  rawDetailsCard: document.querySelector("#rawDetailsCard"),
  rawDetailsContent: document.querySelector("#rawDetailsContent"),
  detailsContent: document.querySelector("#detailsContent"),
  payloadMeta: document.querySelector("#payloadMeta"),
  detailTime: document.querySelector("#detailTime"),
  detailDirection: document.querySelector("#detailDirection"),
  detailType: document.querySelector("#detailType"),
  detailTopic: document.querySelector("#detailTopic"),
  detailQos: document.querySelector("#detailQos"),
  detailClientId: document.querySelector("#detailClientId"),
  detailConnection: document.querySelector("#detailConnection"),
  copyButton: document.querySelector("#copyButton")
};
elements.timeOrderFilter.value = state.timeOrder;

const renderScheduler = panelRuntime.createRenderScheduler(renderAll, {
  intervalMs: UI_RENDER_INTERVAL_MS
});
const searchDebouncer = panelRuntime.createDebouncer((value) => {
  state.activeSearch = value.trim().toLowerCase();
  elements.tableWrap.scrollTop = 0;
  renderAll();
}, SEARCH_DEBOUNCE_MS);

function scheduleLiveRender() {
  if (!state.paused) renderScheduler.schedule();
}

function defaultPaneWidths() {
  const width = elements.workspace.clientWidth || window.innerWidth || 1280;
  return {
    left: Math.max(220, Math.round(width * 0.18)),
    right: Math.max(340, Math.round(width * 0.31))
  };
}

function applyPaneWidths(activePane = "both") {
  const defaults = defaultPaneWidths();
  const constrained = panelRuntime.constrainPaneWidths(
    elements.workspace.clientWidth || window.innerWidth || 1280,
    state.paneWidths.left ?? defaults.left,
    state.paneWidths.right ?? defaults.right,
    { ...PANE_LAYOUT, activePane }
  );
  state.paneWidths = { left: constrained.left, right: constrained.right };
  elements.workspace.style.setProperty("--left-pane-width", constrained.left + "px");
  elements.workspace.style.setProperty("--right-pane-width", constrained.right + "px");
  elements.leftPaneResizer.setAttribute("aria-valuemin", String(PANE_LAYOUT.minLeft));
  elements.leftPaneResizer.setAttribute("aria-valuemax", String(PANE_LAYOUT.maxLeft));
  elements.leftPaneResizer.setAttribute("aria-valuenow", String(Math.round(constrained.left)));
  elements.rightPaneResizer.setAttribute("aria-valuemin", String(PANE_LAYOUT.minRight));
  elements.rightPaneResizer.setAttribute("aria-valuemax", String(PANE_LAYOUT.maxRight));
  elements.rightPaneResizer.setAttribute("aria-valuenow", String(Math.round(constrained.right)));
}

function savePaneWidths() {
  try {
    localStorage.setItem(PANE_WIDTH_STORAGE_KEY, JSON.stringify({
      left: Math.round(state.paneWidths.left),
      right: Math.round(state.paneWidths.right)
    }));
  } catch {
    // Widths still apply for the current DevTools session.
  }
}

function resetPaneWidths() {
  state.paneWidths = defaultPaneWidths();
  applyPaneWidths();
  savePaneWidths();
}

function installPaneResizer(handle, pane) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    applyPaneWidths();
    const startX = event.clientX;
    const startWidths = { ...state.paneWidths };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing-panes");

    const move = (moveEvent) => {
      if (!handle.hasPointerCapture(moveEvent.pointerId)) return;
      const delta = moveEvent.clientX - startX;
      if (pane === "left") state.paneWidths.left = startWidths.left + delta;
      else state.paneWidths.right = startWidths.right - delta;
      applyPaneWidths(pane);
    };
    const finish = () => {
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-panes");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      savePaneWidths();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    event.preventDefault();
  });

  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const step = event.shiftKey ? 48 : 16;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (pane === "left") state.paneWidths.left += direction * step;
    else state.paneWidths.right -= direction * step;
    applyPaneWidths(pane);
    savePaneWidths();
    event.preventDefault();
  });

  handle.addEventListener("dblclick", resetPaneWidths);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", { hour12: false })
    + "."
    + String(date.getMilliseconds()).padStart(3, "0");
}

function connectionDisplayName(connection) {
  if (connection.clientId) return connection.clientId;
  if (connection.url) {
    try {
      const url = new URL(connection.url);
      return "ws-" + url.host;
    } catch {
      // Fall through to the captured connection identifier.
    }
  }
  return "连接 " + String(connection.id || "").split(":").pop();
}

function connectionOptionLabel(connection) {
  const name = connectionDisplayName(connection);
  if (!connection.sourceTab?.url) return name;
  try {
    return name + " · " + new URL(connection.sourceTab.url).host;
  } catch {
    return name;
  }
}

function packetTopicOrInfo(packet) {
  if (packet.topic !== undefined) return packet.topic || "(Topic Alias)";
  if (packet.topics?.length) return packet.topics.map((item) => item.topic).join(", ");
  if (packet.clientId !== undefined) return "Client ID: " + (packet.clientId || "(空)");
  if (packet.reasonCode !== undefined) return "Reason: " + packet.reasonCode;
  return "";
}

function packetPayloadPreview(packet) {
  if (packet.payloadText !== undefined) {
    return packet.payloadText.replace(/\s+/g, " ").slice(0, 240);
  }
  if (packet.payloadHex) return packet.payloadHex;
  return "";
}

function payloadPresentation(packet) {
  const size = Number.isFinite(packet.payloadSize)
    ? packet.payloadSize
    : new TextEncoder().encode(packet.payloadText || "").length;

  if (packet.payloadText !== undefined) {
    if (packet.payloadEncoding === "utf-8" && packet.payloadText) {
      try {
        return {
          format: "JSON",
          size,
          text: JSON.stringify(JSON.parse(packet.payloadText), null, 2)
        };
      } catch {
        // Keep readable UTF-8 payloads as plain text.
      }
    }
    return {
      format: packet.payloadEncoding === "utf-8" ? "UTF-8" : "TEXT",
      size,
      text: packet.payloadText || "(空 Payload)"
    };
  }

  if (packet.payloadHex) {
    return { format: "HEX", size, text: packet.payloadHex };
  }
  return { format: "无 Payload", size: 0, text: "(该报文没有 Payload)" };
}

function renderDetails(options = {}) {
  const keyword = elements.detailsSearchInput.disabled
    ? ""
    : elements.detailsSearchInput.value.trim();
  const matches = panelRuntime.findTextMatches(state.detailsText, keyword);
  state.detailMatches = matches;

  if (!matches.length) {
    state.detailMatchIndex = 0;
    elements.detailsContent.textContent = state.detailsText;
    elements.detailsSearchCount.textContent = keyword ? "0/0" : "";
    return;
  }

  state.detailMatchIndex = Math.max(0, Math.min(state.detailMatchIndex, matches.length - 1));
  const fragment = document.createDocumentFragment();
  let offset = 0;
  let activeMark = null;
  matches.forEach((match, index) => {
    if (match.start > offset) {
      fragment.append(document.createTextNode(state.detailsText.slice(offset, match.start)));
    }
    const mark = document.createElement("mark");
    mark.className = "details-match" + (index === state.detailMatchIndex ? " active" : "");
    mark.textContent = state.detailsText.slice(match.start, match.end);
    fragment.append(mark);
    if (index === state.detailMatchIndex) activeMark = mark;
    offset = match.end;
  });
  if (offset < state.detailsText.length) {
    fragment.append(document.createTextNode(state.detailsText.slice(offset)));
  }
  elements.detailsContent.replaceChildren(fragment);
  elements.detailsSearchCount.textContent = (state.detailMatchIndex + 1) + "/" + matches.length;
  if (options.scrollActive && activeMark) activeMark.scrollIntoView({ block: "center" });
}

function clearDetails() {
  state.selectedEventId = null;
  state.detailsText = EMPTY_DETAILS_TEXT;
  state.detailsCopyText = "";
  state.detailMatches = [];
  state.detailMatchIndex = 0;
  elements.detailsSearchInput.value = "";
  elements.detailsSearchInput.disabled = true;
  elements.detailsSearchCount.textContent = "";
  elements.detailsContent.textContent = "";
  elements.rawDetailsContent.textContent = "";
  elements.rawDetailsCard.open = false;
  elements.detailsEmpty.classList.remove("hidden");
  elements.metadataCard.classList.add("hidden");
  elements.payloadCard.classList.add("hidden");
  elements.rawDetailsCard.classList.add("hidden");
  elements.copyButton.disabled = true;
}

function resetSourceTab(sourceTabId) {
  const removed = state.events.removeWhere((event) => event.sourceTab?.id === sourceTabId);
  const removedEventIds = new Set(removed.map((event) => event.id));
  removed.forEach(removeIndexedEvent);
  const removedConnectionIds = new Set();
  for (const [connectionId, connection] of state.connections) {
    if (connection.sourceTab?.id !== sourceTabId) continue;
    state.connections.delete(connectionId);
    removedConnectionIds.add(connectionId);
  }
  state.connectionRenderSignature = "";

  if (removedConnectionIds.has(state.selectedConnectionId)) {
    state.selectedConnectionId = "all";
  }
  if (removedEventIds.has(state.selectedEventId)) clearDetails();
}

function searchableEventText(event) {
  const connection = state.connections.get(event.connectionId) || {};
  return JSON.stringify({
    clientId: connection.clientId,
    url: connection.url,
    sourceTab: connection.sourceTab,
    packet: event.packet
  }).toLowerCase();
}

function removeIndexedEvent(event) {
  state.eventIds.delete(event.id);
  state.searchTextByEventId.delete(event.id);
  if (event.kind !== "packet") return;
  state.topicIndex.remove(event);
  state.cachedPacketCount = Math.max(0, state.cachedPacketCount - 1);
}

function refreshConnectionSearchText(connectionId) {
  for (const event of state.events.toArray()) {
    if (event.kind === "packet" && event.connectionId === connectionId) {
      state.searchTextByEventId.set(event.id, searchableEventText(event));
    }
  }
}

function eventMatchesSourceHostname(event) {
  const sourceUrl = event?.sourceTab?.url || event?.pageUrl || "";
  if (event?.kind === "connection") {
    return panelRuntime.mqttConnectionMatchesSource(event.connection?.url || "", sourceUrl);
  }
  if (event?.kind === "packet") {
    const knownConnectionUrl = state.connections.get(event.connectionId)?.url || "";
    const connectionUrl = event.connectionUrl || knownConnectionUrl;
    return !connectionUrl || panelRuntime.mqttConnectionMatchesSource(connectionUrl, sourceUrl);
  }
  return true;
}

function consumeEvent(event, render = true) {
  if (!event?.id || state.eventIds.has(event.id)) return;
  const sourceSession = panelRuntime.observeSourceSession(state.sourceSessions, event);
  if (sourceSession?.changed) resetSourceTab(sourceSession.sourceTabId);
  if (!eventMatchesSourceHostname(event)) return;

  if (event.kind === "hook-ready") state.pageHookReady = true;

  if (event.kind === "connection" && event.connection?.id) {
    const previous = state.connections.get(event.connection.id) || {};
    state.connections.set(event.connection.id, {
      ...previous,
      ...event.connection,
      sourceTab: event.sourceTab || previous.sourceTab
    });
    refreshConnectionSearchText(event.connection.id);
  }

  if (event.kind === "packet") {
    const previous = state.connections.get(event.connectionId) || { id: event.connectionId };
    const patch = { mqtt: true, sourceTab: event.sourceTab || previous.sourceTab };
    if (event.packet.clientId !== undefined) patch.clientId = event.packet.clientId;
    if (event.packet.protocolVersion) patch.protocolVersion = event.packet.protocolVersion;
    state.connections.set(event.connectionId, { ...previous, ...patch });
  }

  const byteSize = ringBufferApi.serializedByteLength(event);
  const removed = state.events.append(event, byteSize);
  removed.forEach(removeIndexedEvent);
  state.eventIds.add(event.id);
  if (event.kind === "packet") {
    state.receivedPacketCount += 1;
    state.cachedPacketCount += 1;
    state.topicIndex.add(event);
    state.searchTextByEventId.set(event.id, searchableEventText(event));
    state.recentPacketTimestamps.push(event.timestamp);
  }
  if (removed.some((item) => item.id === state.selectedEventId)) clearDetails();

  if (render) scheduleLiveRender();
}

function mqttConnections() {
  return Array.from(state.connections.values()).filter((connection) => connection.mqtt);
}

let payloadGroupField = "";
let payloadGroupSelected = null;
let classifyPayload = panelRuntime.createPayloadClassifier("");
const payloadGroupInput = document.querySelector("#payloadGroupField");
const payloadGroupTags = document.querySelector("#payloadGroupTags");

function renderPayloadGroups(packets) {
  if (!payloadGroupTags) return;
  const counts = new Map();
  if (payloadGroupField) {
    for (const event of packets) {
      for (const value of classifyPayload(event)) counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  const groups = payloadGroupField ? [[null, packets.length], ...counts] : [];
  if (payloadGroupSelected !== null && !counts.has(payloadGroupSelected)) groups.push([payloadGroupSelected, 0]);
  const existing = new Map([...payloadGroupTags.children].map(node => [node.dataset.key, node]));
  for (const [key, count] of groups) {
    const id = key === null ? "all" : key;
    let button = existing.get(id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "payload-group-tag";
      button.dataset.key = id;
      button.addEventListener("click", () => {
        payloadGroupSelected = key;
        elements.tableWrap.scrollTop = 0;
        renderAll();
      });
      payloadGroupTags.append(button);
    }
    existing.delete(id);
    const label = key === null ? "全部" : key === "missing" ? "无字段 / 非 JSON" : String(JSON.parse(key)) || '""';
    const text = `${label} (${count})`;
    if (button.textContent !== text) button.textContent = text;
    button.title = text;
    button.setAttribute("aria-pressed", String(payloadGroupSelected === key));
  }
  for (const node of existing.values()) node.remove();
}

const payloadGroupDebouncer = panelRuntime.createDebouncer((value) => {
  payloadGroupField = value.trim();
  payloadGroupSelected = null;
  classifyPayload = panelRuntime.createPayloadClassifier(payloadGroupField);
  elements.tableWrap.scrollTop = 0;
  renderAll();
}, SEARCH_DEBOUNCE_MS);
payloadGroupInput?.addEventListener("input", () => payloadGroupDebouncer.schedule(payloadGroupInput.value));

function filteredPackets(ignorePayloadGroup = false) {
  const search = state.activeSearch;
  return state.events.toArray().filter((event) => {
    if (event.kind !== "packet") return false;
    if (!ignorePayloadGroup && payloadGroupField && payloadGroupSelected !== null && !classifyPayload(event).includes(payloadGroupSelected)) return false;
    if (state.selectedConnectionId !== "all" && event.connectionId !== state.selectedConnectionId) return false;
    if (!panelRuntime.eventMatchesTopicGroup(event, state.selectedTopicGroup)) return false;
    if (!panelRuntime.eventMatchesTopic(event, state.selectedTopic)) return false;
    if (elements.directionFilter.value !== "all" && event.direction !== elements.directionFilter.value) return false;
    if (elements.typeFilter.value !== "all" && event.packet.typeName !== elements.typeFilter.value) return false;
    return !search || state.searchTextByEventId.get(event.id)?.includes(search);
  });
}

function renderConnectionOptions(connections) {
  if (
    state.selectedConnectionId !== "all"
    && !connections.some((item) => item.id === state.selectedConnectionId)
  ) {
    state.selectedConnectionId = "all";
  }
  panelRuntime.syncConnectionSelect(
    elements.connectionFilter,
    connections,
    state.selectedConnectionId,
    Option,
    connectionOptionLabel
  );
}

function selectConnection(connectionId) {
  state.selectedConnectionId = connectionId;
  state.selectedTopicGroup = "all";
  state.selectedTopic = "all";
  elements.connectionFilter.value = connectionId;
  state.connectionRenderSignature = "";
  state.topicRenderSignature = "";
  state.forceTopicRender = true;
  elements.tableWrap.scrollTop = 0;
  renderAll();
}

function renderConnections(connections) {
  elements.connectionCount.textContent = String(connections.length);
  elements.allConnectionsButton.classList.toggle("selected", state.selectedConnectionId === "all");
  const signature = JSON.stringify(connections.map((connection) => [
    connection.id,
    connection.clientId,
    connection.url,
    connection.status,
    connection.sourceTab?.url,
    state.selectedConnectionId === connection.id
  ]));
  if (signature === state.connectionRenderSignature) return;
  state.connectionRenderSignature = signature;
  elements.connectionsList.replaceChildren();

  for (const connection of connections) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "connection-card"
      + (state.selectedConnectionId === connection.id ? " selected" : "");
    button.title = [connection.url, connection.sourceTab?.url].filter(Boolean).join("\n");
    button.setAttribute("aria-pressed", String(state.selectedConnectionId === connection.id));

    const head = document.createElement("div");
    head.className = "connection-head";
    const dot = document.createElement("span");
    dot.className = "status-dot " + (connection.status || "");
    const name = document.createElement("span");
    name.className = "connection-name";
    name.textContent = connectionDisplayName(connection);
    head.append(dot, name);

    const url = document.createElement("div");
    url.className = "connection-url";
    url.textContent = connection.url || "等待连接地址";
    const source = document.createElement("div");
    source.className = "connection-source";
    source.textContent = connection.sourceTab?.url ? "来源：" + connection.sourceTab.url : "";
    button.append(head, url, source);
    button.addEventListener("click", () => selectConnection(connection.id));
    elements.connectionsList.append(button);
  }
}

function renderTopicGroups() {
  const allGroups = state.topicIndex.groups({
    connectionId: state.selectedConnectionId,
    stableOrder: true
  });
  const selectedGroup = allGroups.find((group) => group.name === state.selectedTopicGroup);
  if (state.selectedTopicGroup !== "all" && !selectedGroup) {
    state.selectedTopicGroup = "all";
    state.selectedTopic = "all";
  } else if (
    state.selectedTopic !== "all"
    && !selectedGroup?.topics.some((topic) => topic.name === state.selectedTopic)
  ) {
    state.selectedTopic = "all";
  }

  const search = elements.topicSearchInput.value.trim();
  const groups = state.topicIndex.groups({
    connectionId: state.selectedConnectionId,
    search,
    stableOrder: true
  });
  elements.clearTopicFilterButton.classList.toggle("selected", state.selectedTopicGroup === "all");
  elements.topicEmptyState.classList.toggle("hidden", groups.length > 0);
  const signature = JSON.stringify({
    groups,
    selectedTopicGroup: state.selectedTopicGroup,
    selectedTopic: state.selectedTopic,
    expanded: Array.from(state.expandedTopicGroups).sort(),
    search
  });
  if (state.topicListInteracting && !state.forceTopicRender) return;
  state.forceTopicRender = false;
  if (signature === state.topicRenderSignature) return;
  state.topicRenderSignature = signature;
  elements.topicGroupsList.replaceChildren();

  for (const group of groups) {
    const item = document.createElement("div");
    item.className = "topic-group-item";
    const row = document.createElement("div");
    row.className = "topic-group-row" + (group.name === state.selectedTopicGroup ? " selected" : "");
    const childrenId = "topic-group-" + group.name.replace(/[^a-zA-Z0-9_-]/g, "-");
    const expanded = Boolean(search) || state.expandedTopicGroups.has(group.name);

    const expandButton = document.createElement("button");
    expandButton.type = "button";
    expandButton.className = "topic-expand-button";
    expandButton.title = expanded ? "收起子 Topic" : "展开子 Topic";
    expandButton.setAttribute("aria-label", (expanded ? "收起 " : "展开 ") + group.name);
    expandButton.setAttribute("aria-expanded", String(expanded));
    expandButton.setAttribute("aria-controls", childrenId);

    const chevron = document.createElement("span");
    chevron.className = "topic-chevron";
    chevron.textContent = "›";
    expandButton.append(chevron);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "topic-group";
    button.title = "筛选分组：" + group.name;
    button.setAttribute("aria-pressed", String(group.name === state.selectedTopicGroup && state.selectedTopic === "all"));
    const name = document.createElement("span");
    name.className = "topic-name";
    name.textContent = group.name;
    const badge = document.createElement("span");
    badge.className = "topic-badge";
    badge.textContent = String(group.count);
    button.append(name, badge);
    button.addEventListener("click", () => {
      state.selectedTopicGroup = group.name;
      state.selectedTopic = "all";
      state.forceTopicRender = true;
      elements.tableWrap.scrollTop = 0;
      renderAll();
    });
    expandButton.addEventListener("click", () => {
      if (state.expandedTopicGroups.has(group.name)) state.expandedTopicGroups.delete(group.name);
      else state.expandedTopicGroups.add(group.name);
      state.topicRenderSignature = "";
      state.forceTopicRender = true;
      renderTopicGroups();
    });
    row.append(expandButton, button);
    item.append(row);

    const children = document.createElement("div");
    children.id = childrenId;
    children.className = "topic-children" + (expanded ? "" : " hidden");
    for (const topic of group.topics) {
      const child = document.createElement("button");
      child.type = "button";
      child.className = "topic-child" + (topic.name === state.selectedTopic ? " selected" : "");
      child.title = topic.name;
      child.setAttribute("aria-pressed", String(topic.name === state.selectedTopic));
      const childName = document.createElement("span");
      childName.className = "topic-child-name";
      childName.textContent = topic.name.startsWith(group.name + "/")
        ? topic.name.slice(group.name.length + 1)
        : topic.name;
      const childBadge = document.createElement("span");
      childBadge.className = "topic-badge";
      childBadge.textContent = String(topic.count);
      child.append(childName, childBadge);
      child.addEventListener("click", () => {
        state.selectedTopicGroup = group.name;
        state.selectedTopic = topic.name;
        state.expandedTopicGroups.add(group.name);
        state.forceTopicRender = true;
        elements.tableWrap.scrollTop = 0;
        renderAll();
      });
      children.append(child);
    }
    item.append(children);
    elements.topicGroupsList.append(item);
  }

  const topicSelected = state.selectedTopicGroup !== "all";
  elements.activeTopicFilter.classList.toggle("hidden", !topicSelected);
  elements.activeTopicFilter.textContent = topicSelected
    ? (state.selectedTopic !== "all" ? state.selectedTopic : state.selectedTopicGroup)
    : "";
}

function createPacketRow(event) {
  const packet = event.packet;
  const row = document.createElement("tr");

  const timeCell = document.createElement("td");
  timeCell.className = "time-cell";
  const relative = document.createElement("span");
  relative.className = "time-relative";
  const absolute = document.createElement("span");
  absolute.className = "time-absolute";
  absolute.textContent = formatTime(event.timestamp);
  timeCell.append(relative, absolute);

  const directionCell = document.createElement("td");
  directionCell.className = "direction " + event.direction;
  const directionBadge = document.createElement("span");
  directionBadge.className = "direction-badge";
  directionBadge.textContent = event.direction === "incoming" ? "接收" : "发送";
  directionCell.append(directionBadge);

  const typeCell = document.createElement("td");
  typeCell.className = "packet-type";
  typeCell.textContent = packetTypeLabel(packet.typeName);
  typeCell.title = typeCell.textContent;

  const topicCell = document.createElement("td");
  topicCell.className = "topic";
  topicCell.textContent = packetTopicOrInfo(packet);
  topicCell.title = topicCell.textContent;

  const qosCell = document.createElement("td");
  qosCell.textContent = String(packet.qos ?? "");

  const payloadCell = document.createElement("td");
  payloadCell.className = "payload";
  payloadCell.textContent = packetPayloadPreview(packet);
  payloadCell.title = payloadCell.textContent;

  row.append(timeCell, directionCell, typeCell, topicCell, qosCell, payloadCell);
  row.addEventListener("click", () => selectEvent(event));
  return row;
}

function updatePacketRow(row, event) {
  row.classList.toggle("selected", event.id === state.selectedEventId);
  row.setAttribute("aria-selected", String(event.id === state.selectedEventId));
  row.dataset.timestamp = String(event.timestamp);
  const relative = row.querySelector(".time-relative");
  if (relative) relative.textContent = panelRuntime.formatRelativeTime(event.timestamp);
}

function createVirtualRow(item) {
  if (!item.virtualSpacer) return createPacketRow(item);
  const row = document.createElement("tr");
  row.className = "virtual-spacer";
  const cell = document.createElement("td");
  cell.colSpan = 6;
  row.append(cell);
  return row;
}

function updateVirtualRow(row, item) {
  if (!item.virtualSpacer) {
    updatePacketRow(row, item);
    return;
  }
  const height = Math.max(0, item.height);
  row.style.height = height + "px";
  row.firstElementChild.style.height = height + "px";
}

function renderPacketWindow() {
  const viewport = panelRuntime.virtualWindow(state.filteredPacketView, {
    scrollTop: elements.tableWrap.scrollTop,
    viewportHeight: elements.tableWrap.clientHeight,
    rowHeight: VIRTUAL_ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN
  });
  const visible = [];
  if (viewport.topHeight) {
    visible.push({ id: "__virtual_top__", virtualSpacer: true, height: viewport.topHeight });
  }
  visible.push(...viewport.items);
  if (viewport.bottomHeight) {
    visible.push({ id: "__virtual_bottom__", virtualSpacer: true, height: viewport.bottomHeight });
  }
  panelRuntime.reconcileKeyedChildren(
    elements.packetRows,
    visible,
    (item) => item.id,
    createVirtualRow,
    updateVirtualRow
  );
}

function renderPackets(packets) {
  state.filteredPacketView = state.timeOrder === "asc" ? packets : packets.slice().reverse();
  renderPacketWindow();

  const emptyState = panelRuntime.packetEmptyState(state.cachedPacketCount, packets.length);
  elements.emptyState.classList.toggle("hidden", emptyState === null);
  if (emptyState) {
    elements.emptyStateTitle.textContent = emptyState.title;
    elements.emptyStateDescription.textContent = emptyState.description;
  }
  elements.resultCount.textContent = packets.length + " 条结果";
  elements.packetCount.textContent = packets.length + " 条报文（虚拟滚动）";
}

function updateVisibleRelativeTimes() {
  for (const row of elements.packetRows.children) {
    if (row.classList.contains("virtual-spacer")) continue;
    const relative = row.querySelector(".time-relative");
    if (relative) relative.textContent = panelRuntime.formatRelativeTime(Number(row.dataset.timestamp));
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
}

function currentPacketRate(now = Date.now()) {
  const timestamps = state.recentPacketTimestamps;
  let start = state.recentPacketTimestampStart;
  while (start < timestamps.length && timestamps[start] <= now - 1000) start += 1;
  state.recentPacketTimestampStart = start;
  if (start > 1024 && start > timestamps.length / 2) {
    state.recentPacketTimestamps = timestamps.slice(start);
    state.recentPacketTimestampStart = 0;
    return state.recentPacketTimestamps.length;
  }
  return timestamps.length - start;
}

function renderStatus() {
  const rate = currentPacketRate();
  const packetStats = "缓存 " + state.cachedPacketCount
    + " 条 / " + formatBytes(state.events.totalBytes)
    + " · 累计 " + state.receivedPacketCount + " 条";
  elements.headerStats.textContent = packetStats + " · " + rate + " msg/s";

  if (state.paused) {
    elements.statusIndicator.className = "status-dot";
    elements.statusText.textContent = "已暂停界面刷新，报文仍在后台缓冲";
    return;
  }
  if (!state.pageHookReady) {
    elements.statusIndicator.className = "status-dot error";
    elements.statusText.textContent = "未检测到监听器，请刷新页面或授权当前站点";
    return;
  }

  const connections = mqttConnections();
  const openCount = connections.filter((item) => item.status === "open").length;
  const sourceCount = new Set(connections.map((item) => item.sourceTab?.id).filter(Boolean)).size;
  elements.statusIndicator.className = "status-dot " + (openCount ? "open" : "");
  elements.statusText.textContent = connections.length
    ? "正在监听当前页面 MQTT 连接 · "
      + openCount + " 活动 / " + connections.length + " 连接 / " + sourceCount + " 页面"
    : "监听器已就绪，等待页面创建 MQTT WebSocket";
}

function renderAll() {
  const connections = mqttConnections();
  renderConnectionOptions(connections);
  renderConnections(connections);
  renderTopicGroups();
  const basePackets = filteredPackets(true);
  renderPayloadGroups(basePackets);
  renderPackets(payloadGroupField && payloadGroupSelected !== null
    ? basePackets.filter(event => classifyPayload(event).includes(payloadGroupSelected))
    : basePackets);
  renderStatus();
}

function eventForDisplay(event) {
  const {
    rawHex,
    payloadHex,
    payloadText,
    payloadEncoding,
    payloadSize,
    payloadTruncated,
    ...mqtt
  } = event.packet;
  const payload = {
    encoding: payloadEncoding,
    size: payloadSize
  };

  if (payloadText !== undefined) payload.utf8 = payloadText;
  if (payloadTruncated !== undefined) payload.truncated = payloadTruncated;
  if (payloadEncoding === "utf-8" && payloadText) {
    try {
      payload.json = JSON.parse(payloadText);
    } catch {
      // The payload is readable text, but not JSON.
    }
  }
  if (payloadHex) payload.hexPreview = payloadHex;

  return {
    time: new Date(event.timestamp).toISOString(),
    direction: event.direction,
    connection: state.connections.get(event.connectionId),
    mqtt,
    payload,
    rawMqttFrame: {
      hexPreview: rawHex
    }
  };
}

function selectEvent(event) {
  state.selectedEventId = event.id;
  const packet = event.packet;
  const connection = state.connections.get(event.connectionId) || {};
  const presentation = payloadPresentation(packet);
  const fullDetails = JSON.stringify(eventForDisplay(event), null, 2);

  state.detailsText = presentation.text;
  state.detailsCopyText = fullDetails;
  state.detailMatchIndex = 0;
  elements.detailsSearchInput.disabled = false;
  elements.detailsEmpty.classList.add("hidden");
  elements.metadataCard.classList.remove("hidden");
  elements.payloadCard.classList.remove("hidden");
  elements.rawDetailsCard.classList.remove("hidden");
  elements.rawDetailsCard.open = false;
  elements.detailsScroll.scrollTop = 0;

  elements.detailTime.textContent = formatTime(event.timestamp)
    + " (" + panelRuntime.formatRelativeTime(event.timestamp) + ")";
  elements.detailDirection.className = event.direction;
  elements.detailDirection.textContent = event.direction === "incoming"
    ? "接收（Broker → Client）"
    : "发送（Client → Broker）";
  elements.detailType.textContent = packet.typeName || "—";
  elements.detailTopic.textContent = packetTopicOrInfo(packet) || "—";
  elements.detailQos.textContent = String(packet.qos ?? "—");
  elements.detailClientId.textContent = connection.clientId || "—";
  elements.detailConnection.textContent = connection.url || event.connectionId || "—";
  elements.payloadMeta.textContent = presentation.format + " · " + presentation.size + " bytes";
  elements.rawDetailsContent.textContent = fullDetails;
  elements.copyButton.disabled = false;
  renderDetails({ scrollActive: Boolean(elements.detailsSearchInput.value.trim()) });
  renderPacketWindow();
}

function downloadJson() {
  const data = filteredPackets().map(eventForDisplay);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mqtt-capture-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function togglePause() {
  state.paused = !state.paused;
  elements.pauseButton.querySelector(".button-label").textContent = state.paused ? "继续" : "暂停";
  elements.pauseButton.setAttribute("aria-pressed", String(state.paused));
  if (state.paused) renderScheduler.cancel();
  renderScheduler.flush();
}

function clearFilters() {
  payloadGroupDebouncer.cancel();
  payloadGroupSelected = null;
  state.selectedConnectionId = "all";
  state.selectedTopicGroup = "all";
  state.selectedTopic = "all";
  elements.connectionFilter.value = "all";
  elements.directionFilter.value = "all";
  elements.typeFilter.value = "all";
  elements.searchInput.value = "";
  state.activeSearch = "";
  searchDebouncer.cancel();
  elements.topicSearchInput.value = "";
  state.connectionRenderSignature = "";
  state.topicRenderSignature = "";
  state.forceTopicRender = true;
  elements.tableWrap.scrollTop = 0;
  renderAll();
}

elements.connectionFilter.addEventListener("change", () => {
  selectConnection(elements.connectionFilter.value);
});
elements.allConnectionsButton.addEventListener("click", () => selectConnection("all"));
elements.clearTopicFilterButton.addEventListener("click", () => {
  state.selectedTopicGroup = "all";
  state.selectedTopic = "all";
  state.forceTopicRender = true;
  elements.tableWrap.scrollTop = 0;
  renderAll();
});
elements.directionFilter.addEventListener("change", () => {
  elements.tableWrap.scrollTop = 0;
  renderAll();
});
elements.typeFilter.addEventListener("change", () => {
  elements.tableWrap.scrollTop = 0;
  renderAll();
});
elements.timeOrderFilter.addEventListener("change", () => {
  state.timeOrder = elements.timeOrderFilter.value === "asc" ? "asc" : "desc";
  try {
    localStorage.setItem(TIME_ORDER_STORAGE_KEY, state.timeOrder);
  } catch {
    // The selected order still applies for the current DevTools session.
  }
  elements.tableWrap.scrollTop = 0;
  renderAll();
});
elements.searchInput.addEventListener("input", () => {
  searchDebouncer.schedule(elements.searchInput.value);
});
elements.topicSearchInput.addEventListener("input", renderAll);
let virtualScrollFrame = null;
elements.tableWrap.addEventListener("scroll", () => {
  if (virtualScrollFrame !== null) return;
  virtualScrollFrame = requestAnimationFrame(() => {
    virtualScrollFrame = null;
    renderPacketWindow();
  });
}, { passive: true });
elements.topicGroupsList.addEventListener("pointerenter", () => {
  state.topicListInteracting = true;
});
elements.topicGroupsList.addEventListener("pointerleave", () => {
  state.topicListInteracting = false;
  state.topicRenderSignature = "";
  renderTopicGroups();
});
elements.topicGroupsList.addEventListener("focusin", () => {
  state.topicListInteracting = true;
});
elements.topicGroupsList.addEventListener("focusout", (event) => {
  if (elements.topicGroupsList.contains(event.relatedTarget)) return;
  state.topicListInteracting = false;
  state.topicRenderSignature = "";
  renderTopicGroups();
});
elements.pauseButton.addEventListener("click", togglePause);
elements.clearButton.addEventListener("click", () => {
  const removed = state.events.removeWhere((event) => event.kind === "packet");
  removed.forEach(removeIndexedEvent);
  state.receivedPacketCount = 0;
  state.recentPacketTimestamps = [];
  state.recentPacketTimestampStart = 0;
  state.selectedTopicGroup = "all";
  state.selectedTopic = "all";
  state.topicRenderSignature = "";
  state.forceTopicRender = true;
  clearDetails();
  elements.tableWrap.scrollTop = 0;
  renderAll();
});
elements.exportButton.addEventListener("click", downloadJson);
elements.detailsSearchInput.addEventListener("input", () => {
  state.detailMatchIndex = 0;
  renderDetails({ scrollActive: true });
});
elements.detailsSearchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !state.detailMatches.length) return;
  const movement = event.shiftKey ? -1 : 1;
  state.detailMatchIndex = (
    state.detailMatchIndex + movement + state.detailMatches.length
  ) % state.detailMatches.length;
  renderDetails({ scrollActive: true });
  event.preventDefault();
  event.stopPropagation();
});
elements.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.detailsCopyText);
  const label = elements.copyButton.querySelector("span");
  const previous = label.textContent;
  label.textContent = "已复制";
  setTimeout(() => { label.textContent = previous; }, 900);
});

document.addEventListener("keydown", (event) => {
  if (document.body.dataset.activeModule === "http") return;
  const target = event.target;
  const isEditing = target instanceof HTMLElement
    && (target.matches("input, select, textarea") || target.isContentEditable);

  if (event.key === "Escape") {
    clearFilters();
    if (isEditing) target.blur();
    event.preventDefault();
    return;
  }
  if (isEditing) return;
  if (event.key === " ") {
    togglePause();
    event.preventDefault();
    return;
  }
  if (event.key === "/") {
    elements.searchInput.focus();
    event.preventDefault();
  }
});

port.postMessage({ type: "PANEL_INIT", tabId: inspectedTabId });
port.onMessage.addListener((message) => {
  if (message?.type === "MQTT_MONITOR_EVENT") consumeEvent(message.event);
  if (message?.type === "MQTT_MONITOR_EVENTS") {
    for (const event of message.events || []) consumeEvent(event, false);
    scheduleLiveRender();
  }
});

extensionApi.runtime.sendMessage(
  { type: "MQTT_MONITOR_GET_SNAPSHOT", tabId: inspectedTabId },
  (response) => {
    void extensionApi.runtime.lastError;
    for (const event of response?.events || []) consumeEvent(event, false);
    renderAll();
    port.postMessage({ type: "PANEL_READY", tabId: inspectedTabId });
  }
);

setInterval(() => {
  if (state.paused) return;
  updateVisibleRelativeTimes();
  renderStatus();
}, 1000);

installPaneResizer(elements.leftPaneResizer, "left");
installPaneResizer(elements.rightPaneResizer, "right");
window.addEventListener("resize", () => {
  applyPaneWidths();
  renderPacketWindow();
});
applyPaneWidths();
clearDetails();
renderAll();
