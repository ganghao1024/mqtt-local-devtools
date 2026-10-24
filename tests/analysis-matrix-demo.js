// Only loaded by the explicit local ?experiment=matrix test route.
(() => {
  const topic = "demo/site/device/A", other = "demo/site/device/B";
  const payloads = [
    { device: "A", status: "idle", data: { battery: 80 } },
    { device: "A", status: "idle", data: { battery: 80 } },
    { device: "A", status: "running", data: { battery: 80 }, diagnostics: { code: 0 } },
    { device: "A", status: "running", data: { battery: 79 }, diagnostics: { code: 0 } },
    { device: "A", status: null, data: {}, diagnostics: { code: 2 } }
  ];
  const packet = (id, name, value, index) => ({ id, kind: "packet", connectionId: "demo", direction: "incoming", timestamp: Date.now() - 5000 + index * 500, packet: { typeName: "PUBLISH", topic: name, qos: 1, retain: false, dup: false, payloadText: JSON.stringify(value) } });
  const events = payloads.map((value, i) => packet("demo-a-" + i, topic, value, i));
  events.splice(2, 0, packet("demo-b-0", other, { device: "B", status: "offline", data: { battery: 10 } }, 2));
  events.push(packet("demo-b-1", other, { device: "B", status: "ready", data: { battery: 9 } }, 6));
  mqttHarness.emit(events);
  globalThis.__MQTT_PANEL_ANALYSIS__.openTopic(topic);
  document.querySelector("#analysisLatestCount").value = "5";
  document.querySelector("#analysisFields").value = "status, data.battery";
  const guide = document.createElement("div"); guide.id = "matrixExperimentGuide"; guide.className = "matrix-experiment-guide";
  const text = document.createElement("span"); text.textContent = "本地实验 · 5 条 A 消息 + 2 条 B 消息。试试清空关注字段，或切换到 B。数据均为模拟，不连接 Broker。";
  const reset = document.createElement("button"); reset.type = "button"; reset.className = "text-button"; reset.textContent = "重置实验"; reset.addEventListener("click", () => location.reload());
  guide.append(text, reset); document.querySelector(".analysis-heading").after(guide);
  document.querySelector("#analysisSelectLatest").click();
})();
