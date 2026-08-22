# MQTT Local DevTools

## 简短说明

在 Chrome DevTools 中实时查看网页已有的 MQTT over WebSocket 连接、Topic 与 Payload。

## 详细说明

MQTT Local DevTools 是面向前端开发、物联网联调和问题排查的 Chrome DevTools 扩展，支持 localhost、IP 地址和线上域名页面。它监听页面已经创建的 MQTT over WebSocket 连接，不会创建第二个 MQTT 客户端，也不会改变或拦截应用原有的 WebSocket 数据流。

主要功能：

- 查看 MQTT 连接地址、Client ID、协议版本和连接状态。
- 实时解析 MQTT 3.1.1 与 MQTT 5.0 常用报文。
- 展示 CONNECT、PUBLISH、SUBSCRIBE、PING 和 ACK 等发送、接收报文。
- 按连接、Topic 分组、具体子 Topic、方向、报文类型和关键字筛选。
- Topic、报文列表和详情三栏支持拖动分隔线调整宽度，并自动保存布局。
- 同时显示相对时间和精确时间，并支持正序、倒序切换。
- 自动将 UTF-8 Payload 转为可读文本，并格式化合法 JSON。
- 支持详情关键字高亮、复制完整报文和导出 JSON。
- 高频报文使用批量传输和增量渲染，降低 DevTools 面板卡顿。

使用方式：

1. 安装扩展后刷新需要调试的网页。
2. 打开 Chrome DevTools。
3. 选择顶部的“MQTT”面板。
4. 在网页建立 MQTT over WebSocket 连接后查看实时数据。

隐私说明：扩展处理的数据仅保存在当前浏览器页面与 DevTools 会话的内存中，不会上传到开发者或任何第三方服务器。只有用户主动点击“导出 JSON”时，浏览器才会将当前筛选结果下载到本地。

当前只支持网页主线程中的 `ws://` 和 `wss://` MQTT 连接，不支持原生 TCP MQTT、Node.js 后端连接或 Worker 中创建的 WebSocket。

## 分类与语言

- 建议分类：Developer Tools
- 主要语言：中文（简体）
- 成人内容：否

## 单一用途声明

在 Chrome DevTools 中监听、解析和展示当前本地或线上网页已有的 MQTT over WebSocket 连接与报文，帮助开发者进行联调和故障排查。所有数据处理均在当前浏览器本地完成。

## 权限说明

### `http://*/*` 与 `https://*/*`

扩展需要在网页脚本创建 WebSocket 之前注入本地 MQTT 监听器。开发者可能在任意域名、localhost 或 IP 地址页面进行联调，因此需要覆盖全部 HTTP/HTTPS 页面。监听器只读取当前页面的 WebSocket/MQTT 数据并发送到同一浏览器中的 DevTools 面板，不会向开发者服务器或第三方发送数据。

### DevTools 页面

用于在 Chrome DevTools 中创建 MQTT 面板并展示连接和报文信息。

## 数据披露建议

- 处理的数据：网站内容、页面 URL、WebSocket 地址、MQTT Client ID、Topic、报文元信息和 Payload。
- 数据用途：仅用于扩展的核心调试功能。
- 是否出售数据：否。
- 是否用于广告、信用评估或个性化推荐：否。
- 是否传输到第三方：否。
- 是否在浏览器之外保存：否。
- 远程代码：不使用。
