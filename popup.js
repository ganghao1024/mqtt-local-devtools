"use strict";

const siteElement = document.querySelector("#site");

async function showStatus() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url || !/^https?:/i.test(activeTab.url)) {
    siteElement.textContent = "当前页面不是可监听的 HTTP/HTTPS 页面。";
    return;
  }

  const url = new URL(activeTab.url);
  siteElement.innerHTML = `当前站点：<code>${url.origin}</code>`;
  siteElement.insertAdjacentText("beforeend", "\n已启用，请刷新页面后打开 DevTools。 ");
}

void showStatus();
