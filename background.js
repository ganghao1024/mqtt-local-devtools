"use strict";

importScripts("background-runtime.js");

const backgroundRuntime = self.__MQTT_LOCAL_DEVTOOLS_BACKGROUND_RUNTIME__;
const panelPorts = new Map();
const panelTabUrls = new Map();
const readyPanelPorts = new Set();
const HTTP_URL_PATTERNS = ["http://*/*", "https://*/*"];

function ignoreActionError(operation) {
  if (operation && typeof operation.catch === "function") {
    void operation.catch(() => {});
  }
}

function showMqttBadge(tabId) {
  ignoreActionError(chrome.action.setBadgeText({ tabId, text: "MQTT" }));
  ignoreActionError(chrome.action.setBadgeBackgroundColor({ tabId, color: "#16a34a" }));
}

function clearMqttBadge(tabId) {
  ignoreActionError(chrome.action.setBadgeText({ tabId, text: "" }));
}

function hasPanelForSourceTab(sourceTab) {
  for (const [panelTabId, ports] of panelPorts.entries()) {
    if (![...ports].some((port) => readyPanelPorts.has(port))) continue;
    if (backgroundRuntime.shouldDeliverEvent({
      sourceTabId: sourceTab.id,
      sourceUrl: sourceTab.url || "",
      panelTabId,
      panelUrl: panelTabUrls.get(panelTabId) || ""
    })) return true;
  }
  return false;
}

function syncReplayModeForTab(tab) {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: "MQTT_MONITOR_SET_REPLAY_MODE",
    panelConnected: hasPanelForSourceTab(tab)
  }, () => {
    void chrome.runtime.lastError;
  });
}

function refreshReplayModes() {
  chrome.tabs.query({ url: HTTP_URL_PATTERNS }, (tabs) => {
    if (chrome.runtime.lastError) return;
    for (const tab of tabs) syncReplayModeForTab(tab);
  });
}

function addPanelPort(tabId, port) {
  if (!panelPorts.has(tabId)) panelPorts.set(tabId, new Set());
  panelPorts.get(tabId).add(port);
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    panelTabUrls.set(tabId, tab.url || "");
    if (readyPanelPorts.has(port)) refreshReplayModes();
  });
}

function removePanelPort(port) {
  let changed = false;
  readyPanelPorts.delete(port);
  for (const [tabId, ports] of panelPorts.entries()) {
    if (ports.delete(port)) changed = true;
    if (ports.size === 0) {
      panelPorts.delete(tabId);
      panelTabUrls.delete(tabId);
    }
  }
  if (changed) refreshReplayModes();
}

function broadcastFromSourceTab(sourceTab, message) {
  for (const [panelTabId, ports] of panelPorts.entries()) {
    if (!backgroundRuntime.shouldDeliverEvent({
      sourceTabId: sourceTab.id,
      sourceUrl: sourceTab.url || "",
      panelTabId,
      panelUrl: panelTabUrls.get(panelTabId) || ""
    })) continue;

    for (const port of ports) {
      try {
        port.postMessage(message);
      } catch {
        ports.delete(port);
      }
    }
  }
}

function getTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      resolve(chrome.runtime.lastError ? null : tab);
    });
  });
}

function queryLocalTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: backgroundRuntime.LOCAL_URL_PATTERNS }, (tabs) => {
      resolve(chrome.runtime.lastError ? [] : tabs);
    });
  });
}

function readTabSnapshot(tab) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "MQTT_MONITOR_GET_SNAPSHOT" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      const events = Array.isArray(response?.events) ? response.events : [];
      resolve(events.map((event) => backgroundRuntime.enrichEventWithTab(event, tab)));
    });
  });
}

async function collectSnapshot(inspectedTabId) {
  const inspectedTab = await getTab(inspectedTabId);
  if (!inspectedTab) return { events: [], error: "Inspected tab is unavailable" };

  const sourceTabs = backgroundRuntime.isLocalDevelopmentUrl(inspectedTab.url || "")
    ? await queryLocalTabs()
    : [inspectedTab];
  const snapshots = await Promise.all(sourceTabs.map(readTabSnapshot));
  return { events: snapshots.flat(), sourceTabCount: sourceTabs.length };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "mqtt-monitor-panel") return;

  port.onMessage.addListener((message) => {
    if (message?.type === "PANEL_INIT" && Number.isInteger(message.tabId)) {
      addPanelPort(message.tabId, port);
    }
    if (
      message?.type === "PANEL_READY"
      && Number.isInteger(message.tabId)
      && panelPorts.get(message.tabId)?.has(port)
    ) {
      readyPanelPorts.add(port);
      refreshReplayModes();
    }
  });
  port.onDisconnect.addListener(() => removePanelPort(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MQTT_MONITOR_BRIDGE_READY" && sender.tab?.id !== undefined) {
    sendResponse({ panelConnected: hasPanelForSourceTab(sender.tab) });
    return false;
  }

  if (message?.type === "MQTT_MONITOR_EVENTS" && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const events = Array.isArray(message.events) ? message.events : [];
    const enrichedEvents = events.map((event) => backgroundRuntime.enrichEventWithTab(event, sender.tab));
    broadcastFromSourceTab(sender.tab, { type: "MQTT_MONITOR_EVENTS", events: enrichedEvents });

    if (events.some((event) => event?.kind === "packet")) {
      showMqttBadge(tabId);
    }
    return false;
  }

  if (message?.type === "MQTT_MONITOR_EVENT" && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const event = backgroundRuntime.enrichEventWithTab(message.event, sender.tab);
    broadcastFromSourceTab(sender.tab, { type: "MQTT_MONITOR_EVENT", event });

    if (message.event?.kind === "packet") {
      showMqttBadge(tabId);
    }
    return false;
  }

  if (message?.type === "MQTT_MONITOR_GET_SNAPSHOT" && Number.isInteger(message.tabId)) {
    collectSnapshot(message.tabId).then(sendResponse);
    return true;
  }

  if (message?.type === "MQTT_MONITOR_PING_TAB" && Number.isInteger(message.tabId)) {
    chrome.tabs.sendMessage(message.tabId, { type: "MQTT_MONITOR_PING" }, (response) => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { installed: false, error: error.message } : response);
    });
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") clearMqttBadge(tabId);
  if (changeInfo.url && panelPorts.has(tabId)) {
    panelTabUrls.set(tabId, changeInfo.url);
    refreshReplayModes();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const hadPanel = panelPorts.has(tabId);
  panelPorts.delete(tabId);
  panelTabUrls.delete(tabId);
  if (hadPanel) refreshReplayModes();
});
