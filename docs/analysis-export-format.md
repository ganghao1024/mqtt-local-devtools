# 故障分析导出格式 v1

UTF-8 JSON，`format = mqtt-fault-analysis`，`formatVersion = 1`。本文件为离线数据，不包含发送至 Broker 的操作。

## 三种模式

| mode | 含有 report | 含有 messages | 用途 |
| --- | --- | --- | --- |
| changes | 是 | 否 | 交接逐条变化与字段规律 |
| raw | 否 | 是 | 保留所选原始捕获数据 |
| combined | 是 | 是 | 变化与原文一起交接，按 ID 关联 |

三种模式共用 `toolVersion`、`exportedAt`、`order = capture-order`、`config`、`selection`。`config` 包含设备路径、Topic 独占声明和忽略字段；当前界面还记录 `topic`（选中的完整 Topic，严格等值匹配）、`topicGroup`（导航父分组）、`topicGroupDepth: 3`、`packetType: PUBLISH` 和 `fields`（关注字段路径；空数组表示自动收集字段并集）。父分组不决定分析范围，兄弟 Topic 不会合并。只导出所选完整 Topic 的 PUBLISH 消息，不包含订阅控制报文。`selection` 按捕获顺序包含 `{id, order}`，序号允许有未选消息形成的缺口。导出不受结果表格的筛选、视图或分页影响。

当前正式工具采用 `config.identityRule = complete-topic`：完整 Topic 对应一个设备，`topicIsObject = true`、`devicePath = ""`、`ignorePaths = []`，无需界面配置。按来源页、连接、完整 Topic、方向分别比较，不使用 Payload 内的设备字段划分对象。`report.topic` 和 `report.topicGroup` 必须与配置一致，全部所选消息必须属于该完整 Topic，否则拒绝分析和导出。v1 旧文件可能采用 Payload 设备字段、只限定父组或没有范围字段，读取方应保留其旧配置语义，不能推断为当前识别规则。

## 消息字段表

分析导出与合并导出包含 `report.matrix`，其 `format = message-field-matrix-v1`：

- `topic`：严格匹配的完整 Topic。
- `columns`：字段路径列表；自动收集时使用 JSON Pointer，数组按索引；明确指定时保留输入路径。
- `rows`：每条消息一行，包含 `id`、`order`、`capturedAt`、`valid`、`reason`、`beforeId` 和与 columns 对齐的 `cells`。未变化或无法解析的消息不会省略。
- `cells`：值描述沿用 exists/type/value 或截断预览，并带 `changed`，变化时带 `kind`。只有确认同一业务对象后才标记变化；无法确认对象时仍显示值，reason 说明原因；非 JSON 行 valid=false，不将其 cells 的缺失标记解释为字段删除。
- `counts`、`limited`、`limitReason`：行数、字段数、无法解析数及容量限制。最多 100 列 / 20000 单元格 / 4 MiB，报告合计最多 8 MiB。

关注字段不为空时，逐条变化和字段规律也只统计这些路径及子树；A/B 完整对比仍提供全部上下文。字段表中未变化的行不能视作新的状态变化。界面列表最新在前，字段规律最近变化在前；此显示排序不改变报告与原始消息的导出顺序，`rows`、逐条变化及状态流转仍保留捕获先后关系。

## 原始消息

`messages` 每条包含：

- `order`：原始捕获顺序；从原列表补入的旧消息保留原序号，不按补入时间伪造先后关系。
- `event`：独立复制的完整捕获事件，包括原 ID、时间戳、连接 ID、方向、来源页及 MQTT packet。`payloadText`、`rawHex`、`payloadHex`、QoS、retain、dup 等已捕获字段保留原值。
- `connectionAtCapture`：复制该消息时的连接元信息。后续连接状态或原列表变化不会改写此快照。

“原始”指工具实际捕获到的数据。若解码器已截断 Payload 或十六进制预览，导出也不会补齐未捕获字节。原始数据不自动脱敏。

## 变化报告

`report.algorithm = adjacent-object-fields-v1`，`arrayRule = index`。

| 字段 | 说明 |
| --- | --- |
| selectedIds | 本次报告对应的完整消息 ID 序列，必须与 selection 一致 |
| counts | 消息、对象、相邻比较、无变化、变化步骤、检测到/保留的字段变化、字段汇总及跳过数量 |
| groups | 对象编号、来源页、连接、Topic、方向、设备标识及消息数 |
| pairs | 每次相邻比较的前后消息 ID、原序号、检测和保留的变化数量、是否不完整 |
| changes | 每条变化的对象、前后消息与时间、字段路径、种类、类型变化标记及前后值描述 |
| fields | 按对象和路径汇总的变化次数、首末值、值流转、模式、首末消息引用 |
| skipped | 未能分析的消息及具体原因；无法识别的同 Topic 消息会中断连续比较 |
| limited / limitations | 结果是否受容量或计算限制，以及原因 |

值描述区分 `exists: false` 与 `exists: true`；后者带 `type`，短值带 `value`。长值带 `preview`、`truncated: true` 和 `originalCharacters`，完整原文应从 messages 查阅。`fields.flow` 最多保留 16 个状态，`flowTruncated` 标记省略。

“持续增加/减少”“上下波动”“曾回到初始值”等均为选中消息可证明的字段模式，不是业务因果结论。未知消息、选择缺口、截断和容量限制应连同结果交接。报告上限 8 MiB，整个导出上限 64 MiB。
