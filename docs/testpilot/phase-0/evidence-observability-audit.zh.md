# TestPilot 阶段 0 — 证据与可观测性审计

[English](evidence-observability-audit.md) | 中文

本审计记录 harness 能把什么存为证据、能上报一次运行的什么，以及它并不具备什么。它覆盖阶段 0 计划的 A12 工作包，且只读取本仓库中的代码。每条结论都带文件路径与行号。

## 附件

附件存储是内容寻址的。引用携带一个 id，绝不携带路径或 bearer URL。

| 元素 | 规则 | 证据 |
|---|---|---|
| 媒体类型 | 光栅图像词汇表恰好是 PNG、JPEG、WebP 与 GIF | `packages/attachment/attachment/src/types.ts:8` |
| 图像引用 | 一个不透明存储 id、从存储字节验证出的媒体类型、精确的编码字节长度，以及内在宽高 | `packages/attachment/attachment/src/types.ts:11-32` |
| 文件引用 | 内容寻址 id 是所存字节的 sha256 摘要，外加一个净化过的展示文件名；该 id 绝不是文件系统路径，也绝不是 bearer URL | `packages/attachment/attachment/src/types.ts:34-46` |
| 限额 | 部署解析出的限额是每图字节数、每消息图片数、每消息聚合字节数、内在像素数、单边尺寸，以及被接受的媒体类型 | `packages/attachment/attachment/src/types.ts:73-82` |

默认值约束一次图像上传。

| 限额 | 默认值 | 证据 |
|---|---|---|
| 每图字节数 | 50 MiB | `packages/attachment/attachment-local/src/index.ts:33-34` |
| 每消息图片数 | 20 | `packages/attachment/attachment-local/src/index.ts:35-36` |
| 每消息聚合字节数 | 200 MiB | `packages/attachment/attachment-local/src/index.ts:37-38` |
| 内在像素数 | 64,000,000 | `packages/attachment/attachment-local/src/index.ts:39-40` |
| 单边尺寸 | 65,535 px | `packages/attachment/attachment-local/src/index.ts:41-46` |

准入与提交是两个步骤。

| 规则 | 细节 | 证据 |
|---|---|---|
| 规范 base64 | 上传必须是规范 base64；非规范形式在解码之前即被拒绝 | `packages/attachment/attachment/src/admission.ts:14-28` |
| 批量形态 | 一个批次在保存任何成员之前先整体校验，然后按输入顺序逐个提交成员 | `packages/attachment/attachment/src/index.ts:101-123` |
| 文件无限额 | 文件完全不带准入限额：任何字节内容与长度都被接受并按字节原样存储 | `packages/attachment/attachment/src/index.ts:208-222` |
| 流式需要背压 | 流式文件提交必须施加背压，且不得把完整文件收集进内存 | `packages/attachment/attachment/src/index.ts:224-257` |
| 孤立对象 | 存储失败不返回部分引用，但已发布的内容寻址对象可能保持不可达，直到将来的保留策略回收它们 | `packages/attachment/attachment/src/index.ts:93-97` |

在磁盘上，本地后端把对象存放在一个带版本号的根目录下，并使用两级内容寻址分片。

| 元素 | 规则 | 证据 |
|---|---|---|
| 根目录 | `join(dshHome, 'attachments', 'v1')` | `packages/attachment/attachment-local/src/index.ts:180` |
| 文件路径 | 摘要充当目录名，使净化过的展示文件名保留为所存叶子名，从而在 `files` 下形成两级分片 | `packages/attachment/attachment-local/src/file-store.ts:75` |

## 交付物

两个包交付产物，且都不复制文件内容。

`present` 工具把已存在的文件声明为最终交付物。

| 元素 | 规则 | 证据 |
|---|---|---|
| 工具 | 注册为 `present`，是作用域限定在其所属 Session 内的工具 | `packages/deliverables/tool-present/src/index.ts:38` |
| 参数 | 只有 `path` 与 `description`；该工具声明文件，绝不复制其内容 | `packages/deliverables/tool-present/src/index.ts:53` |
| 路径规则 | 目标必须是已存在的普通文件；目录、不存在的路径或非普通文件都会被拒绝 | `packages/deliverables/tool-present/src/index.ts:88-95` |
| 事件 | 成功结果追加一个 `deliverables/presented` 事件，携带 turn、call id 与文件清单 | `packages/deliverables/tool-present/src/index.ts:106-108` |
| 事件形状 | 该事件携带 `turn`、`callId` 与 `files`，每个文件携带一个 path 与可选的 description | `packages/deliverables/tool-present/src/types.ts:11-17` |

`workspace-changes` 插件总结一个 turn 改动了什么。

| 元素 | 规则 | 证据 |
|---|---|---|
| Host 服务 | Host 为某个 Session 与事件序列暴露 `summary` 与 `diff` | `packages/deliverables/workspace-changes/src/index.ts:116-120` |
| 订阅 | 该插件观察 `turn/start`、`tool/result` 与 `turn/end` | `packages/deliverables/workspace-changes/src/index.ts:145-153` |
| 生命周期 | 摘要只活到其 Session 被销毁；`session/disposed` 事件会忘记它 | `packages/deliverables/workspace-changes/src/index.ts:9`、`packages/deliverables/workspace-changes/src/index.ts:154` |
| 临时副本 | 临时目录在平台临时根之下创建 | `packages/deliverables/workspace-changes/src/index.ts:136`、`packages/deliverables/workspace-changes/src/recorder.ts:270` |
| 摘要形状 | 摘要携带 turn、工作目录、按展示顺序排列的改动文件、完整文件计数、增加与删除的行数，以及可选的 git 快照 id | `packages/deliverables/workspace-changes/src/types.ts:23-41` |

## 遥测

OTel 入口提供两条独立通道，彼此不共享状态。

| 通道 | 范围 | 证据 |
|---|---|---|
| `createEventReporter` | 一条按计数批处理的普通事件通道；注入的消费方必须在自己的 fiber 释放期间排空它 | `packages/telemetry/otel/src/index.ts:22` |
| `createSessionLogReporter` | 一条按字节设限的 Session 日志通道；授权与脱敏先于上报 | `packages/telemetry/otel/src/index.ts:30` |

产品事件契约禁止携带内容，属性也不携带自动身份。

| 规则 | 细节 | 证据 |
|---|---|---|
| body | body 是人类可读的摘要；它绝不是 prompt、response、credential 或文件内容 | `packages/telemetry/otel/src/event-log.ts:20` |
| attributes | 属性是调用方选定的业务字段；没有自动的设备或账号身份 | `packages/telemetry/otel/src/event-log.ts:26` |
| 转发 | 产品遥测后端只转发调用方选定的字段 | `packages/host/product-telemetry-otel/src/index.ts:118-120` |

Session 日志通道序列化整个事件，并拒绝超限记录。

| 规则 | 细节 | 证据 |
|---|---|---|
| 载荷 | 整个事件被 JSON 序列化进 `content` 属性 | `packages/telemetry/otel/src/session-log.ts:216` |
| 字节上限 | 采集器请求上限为 4,000,000 个未压缩字节 | `packages/telemetry/otel/src/session-log.ts:12` |
| 超限 | 超过上限的记录整条被拒；其内容绝不被截断 | `packages/telemetry/otel/src/session-log.ts:102-105` |
| 传输 | 传输不继承环境凭据 | `packages/telemetry/otel/src/transport.ts:45-61` |
| 队列 | 队列满则丢弃该记录并告警 | `packages/telemetry/otel/src/session-log.ts:89-92` |

捕获侧拥有脱敏扩展点，而它自带零条规则。

| 元素 | 规则 | 证据 |
|---|---|---|
| 扩展点 | `session-telemetry/record` waterfall 是脱敏扩展点；本包自带零条规则 | `packages/session/session-telemetry/src/index.ts:44` |
| 无监听器 | 最内层 `next()` 原样放行记录，因此没有挂载监听器时，记录按捕获时的样子抵达后端 | `packages/session/session-telemetry/src/index.ts:26-39` |
| 记录契约 | 一条记录携带 source event、channel、time、预映射的 severity、身份属性集合与载荷 | `packages/session/session-telemetry/src/index.ts:65-91` |
| 执行点 | waterfall 在捕获时运行，位于协调器的包含边界之内 | `packages/session/session-telemetry/src/coordinator.ts:206` |
| fail-closed | 抛错的监听器扣留那一条记录，绝不抵达 agent loop | `packages/session/session-telemetry/src/coordinator.ts:246-252` |
| 捕获模式 | 捕获要么跟随实时事件，要么只在被请求时读取规范日志 | `packages/session/session-telemetry/src/coordinator.ts:30` |
| 身份属性 | 身份属性集合是最小集，并省略任何可从 body 恢复的信息 | `packages/session/session-telemetry/src/coordinator.ts:291-305` |

已发布的 OpenTelemetry session 后端默认只共享 feedback。

| 规则 | 细节 | 证据 |
|---|---|---|
| 默认模式 | `FEEDBACK_ONLY` | `packages/session/session-telemetry-otel/src/index.ts:37` |
| 授权 | 只有同一 Session 的显式 feedback 事件才授权重放；fork 种子不授权 | `packages/session/session-telemetry-otel/src/index.ts:43-51` |
| 身份 | OTLP resource 携带匿名 user id，而非账号身份 | `packages/session/session-telemetry-otel/src/index.ts:198` |

## 不存在的能力

本仓库没有 HTML 报告设施、没有 Playwright trace 产物，也没有视频录制设施。

| 能力 | 状态 | 证据 |
|---|---|---|
| HTML 报告 | 缺失；不存在 report 包，也没有注册任何报告渲染器 | `packages/` 目录树中没有 report、trace 或 video 包 |
| Playwright trace | 缺失；`packages/` 中任何位置都不产出 `trace.zip` | `packages/` 目录树中没有写 trace 的代码 |
| 视频录制 | 缺失；浏览器包与 inspector 包中都没有注册录制器 | `packages/` 目录树中没有视频写出器 |
| Inspector | inspector 只做实时 CDP 观测；它把捕获到的 fetch 观测发布给 Inspector Worker，绝不把 trace 产物写到磁盘 | `packages/experimental/inspector/src/shared/network/observation.ts:1`、`packages/experimental/inspector/src/host/inspection/network.ts:5-7` |

## 明确回答

**证据模型把结构化证据与二进制证据分开。**

| 种类 | 存放位置 | 域记录持有什么 | 证据 |
|---|---|---|---|
| 结构化证据：run、case、assertion、结论 | 一条 storage domain 记录 | 整条记录 | Workspace domain 展示了该形态：一个带一张表与一个版本的 `defineDomain` spec（`packages/workspace/workspace/src/spec.ts:76-84`） |
| 二进制证据：截图、trace、视频 | 附件存储 | 仅一个 `attachmentId` 引用 | 引用携带 id 与元数据，从不携带字节，也从不携带路径（`packages/attachment/attachment/src/types.ts:11-46`） |

先例是 MCP 桥。MCP 结果中的 image 块被解码、按模型声明的输入模态准入，并通过附件存储落盘；此后模型收到的是附件引用，原始字节留在程序侧（`packages/mcp/mcp-client/src/tools.ts:333-338`、`packages/mcp/mcp-client/src/tools.ts:371-403`）。

`workspace-changes` 的先例说明摘要不是报告。它的摘要只在其 Session 存活期间被提供，并在 Session 被销毁时被忘记（`packages/deliverables/workspace-changes/src/index.ts:9`、`packages/deliverables/workspace-changes/src/index.ts:154`），因此它不会作为长期报告存续。

**HTML 报告是附件存储中的一个文件，由域记录引用。**它不是新的存储子系统。

| 步骤 | 规则 | 证据 |
|---|---|---|
| 存储 | 报告作为逐字节文件提交，因此不带准入限额，并被按字节原样存储 | `packages/attachment/attachment/src/index.ts:208-222` |
| 引用 | 域记录只持有内容寻址的 `attachmentId` | `packages/attachment/attachment/src/types.ts:39-46` |
| 取回 | 一次经过认证的 HTTP 读取返回该文件，响应带 `Content-Security-Policy: sandbox; default-src 'none'` | `packages/api/session-controller/src/media-references.ts:17-24`、`packages/api/session-controller/src/media-references.ts:26-67` |
| 渲染 | 客户端可以在 sandboxed iframe 内渲染该文档，其 bootstrap 把字节注入一个不透明源 | `packages/client/ui-sidebar-documentpreview/src/client/html/bootstrap.ts:24-46` |

**保留机制必须由 TestPilot 自建。**存储层与附件层都没有。

| 层 | 状态 | 证据 |
|---|---|---|
| 附件存储 | 不存在保留机制；一次失败的提交可能留下不可达的已发布对象，直到将来的保留策略回收它们 | `packages/attachment/attachment/src/index.ts:93-97` |
| Storage domain | domain 层提供表、一个全局单例与变更事件；它不带任何过期或回收策略 | `packages/workspace/workspace/src/spec.ts:76-84` |

**本仓库中的脱敏口径很窄，它不是秘密防火墙。**

| 机制 | 覆盖范围 | 证据 |
|---|---|---|
| MCP redact | 一个窄口径过滤器，覆盖错误诊断文本与 `isError` 结果文本；它不覆盖成功结果、`structuredContent`，也不覆盖 `resources/read` 的返回值 | `packages/mcp/mcp-client/src/tools.ts:159-163`、`packages/mcp/mcp-client/src/credentials.ts:34-36` |
| Session telemetry redact | 一个自带零条规则的扩展点，因此导出的数据干净程度完全取决于部署所挂载的规则 | `packages/session/session-telemetry/src/index.ts:44` |
| 客户端 secret mask | 一个只影响显示的遮罩：它改变绘制出的文本，而消息文本、复制动作与模型输入保留原始字符 | `packages/client/ui-secret-mask/src/client/index.ts:1-6` |

**AI 失败分析只读附件引用与结构化记录。**

| 规则 | 细节 | 证据 |
|---|---|---|
| 可读 | 分析可以读取域的结构化记录，以及这些记录携带的附件引用 | `packages/attachment/attachment/src/types.ts:11-46` |
| 不可读 | 分析不得读取凭据存储；凭据提供方在 MCP 模板绑定背后解析取值，那是唯一触碰它们的组件 | `packages/mcp/mcp-client/src/credentials.ts:55-95` |
| 有据 | 分析结论必须能引用真实的执行证据，因此没有记录或引用支撑的结论不合格 | 附件 id 是所存字节的内容寻址摘要（`packages/attachment/attachment/src/types.ts:34-46`） |

## TestPilot 不可假定的事项

| 假定 | 状态 |
|---|---|
| 附件存储能容纳视频 | 否；媒体词汇表是 PNG、JPEG、WebP 与 GIF，视频只能作为逐字节文件存储（`packages/attachment/attachment/src/types.ts:8`） |
| 文件上传像图像一样有大小限制 | 否；文件完全不带准入限额（`packages/attachment/attachment/src/index.ts:208-222`） |
| 附件引用指向某个路径 | 否；引用携带内容寻址 id，绝不携带文件系统路径或 bearer URL（`packages/attachment/attachment/src/types.ts:34-46`） |
| 一次失败的附件提交什么都不会留下 | 否；已发布的对象可能保持不可达，直到保留策略回收（`packages/attachment/attachment/src/index.ts:93-97`） |
| `present` 会复制交付物内容 | 否；它声明一个 path 与一个 description（`packages/deliverables/tool-present/src/index.ts:53`） |
| workspace-changes 摘要比其 Session 活得更久 | 否；`session/disposed` 会忘记它（`packages/deliverables/workspace-changes/src/index.ts:154`） |
| 产品遥测可以携带 prompt 或 response | 否；body 契约禁止如此（`packages/telemetry/otel/src/event-log.ts:20`） |
| 超限的 session-log 记录会被截断 | 否；整条记录被拒绝（`packages/telemetry/otel/src/session-log.ts:102-105`） |
| session telemetry 会自行脱敏 | 否；该扩展点自带零条规则（`packages/session/session-telemetry/src/index.ts:44`） |
| 客户端 secret mask 保护模型输入 | 否；它只改变绘制出的文本（`packages/client/ui-secret-mask/src/client/index.ts:1-6`） |
| harness 能产出 HTML 报告或 trace 产物 | 否；不存在这样的设施，inspector 只做实时观测（`packages/experimental/inspector/src/host/inspection/network.ts:5-7`） |
| 附件会自行过期 | 否；TestPilot 必须自建保留机制（`packages/attachment/attachment/src/index.ts:93-97`） |

## 进一步探索

- [项目归属审计](project-ownership-audit.zh.md) —— 测试项目及其记录应归属何处。
- [Web 平台集成审计](web-platform-integration-audit.zh.md) —— 客户端如何把运行状态读回来。
- [阶段 0 验收](phase-0-acceptance.zh.md) —— 验收标准与未决阻塞项。
