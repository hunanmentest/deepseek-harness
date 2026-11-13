# TestPilot 阶段 0 — Web 平台集成审计

[English](web-platform-integration-audit.md) | 中文

本审计记录 TestPilot 必须构建其上的 Host、Client 与 Remote API 界面。它覆盖阶段 0 计划的 A11 工作包，且只读取本仓库中的代码。每条结论都带文件路径与行号。

## Host HTTP 服务

`packages/host/webserver` 是一个 `node:http` 路由注册器。它不提供文件，也不承载业务逻辑：dist 服务由组合方应用负责，Electron 则改用 `file://` 加 IPC（`packages/host/webserver/src/index.ts:4-6`）。

它提供四个扩展位。

| 扩展位 | 注册 API | 行为 | 证据 |
|---|---|---|---|
| 命名路由 | `register()` 传入 handler | handler 拥有完整响应生命周期，可以一直持有响应，例如用于 SSE | `packages/host/webserver/src/index.ts:52-58`、`packages/host/webserver/src/index.ts:445-452` |
| 命名 Fetch 资源 | `register()` 传入 `resource` | `WebResource` 把 Fetch `Request` 映射为 `Response`，同时响应进程内读取 | `packages/host/webserver/src/index.ts:60-74`、`packages/host/webserver/src/index.ts:445-452` |
| WebSocket upgrade | `registerUpgrade()` | 精确路径的 upgrade，其 handler 拥有协议协商与升级后的 socket | `packages/host/webserver/src/index.ts:454-466` |
| fallback | `registerFallback()` | 唯一所有者响应所有未被命名路由匹配的请求；二次注册会抛错 | `packages/host/webserver/src/index.ts:468-483` |

路由匹配是有序的：先精确匹配，再取最长匹配前缀，最后是 fallback（`packages/host/webserver/src/index.ts:646-664`）。

若干性质约束了 TestPilot 的 HTTP 界面可以假定什么。

| 性质 | 规则 | 证据 |
|---|---|---|
| 进程内读取 | `readResource()` 计算出与 HTTP 请求将收到的相同响应，不经由 HTTP 交换 | `packages/host/webserver/src/index.ts:485-510` |
| 读取内部不做准入 | `readResource()` 不检查 cookie、Host 或 Origin；由调用方在读取前准入读取者 | `packages/host/webserver/src/index.ts:486-499` |
| 绑定地址 | 监听地址必须是某个本地网卡的具名 IPv4 或 IPv6 字面量 | `packages/host/webserver/src/index.ts:96-107` |
| 拒绝通配地址 | 未指定地址在加载期被拒，因为绑定所有网卡会把远程代码执行暴露到网络 | `packages/host/webserver/src/index.ts:358-366` |
| TLS 是全有或全无 | 无法读取或为空的 TLS 文件、无效 PEM、不匹配的密钥都会让初始化失败，而不是降级为 HTTP | `packages/host/webserver/src/index.ts:109-118`、`packages/host/webserver/src/index.ts:278-289` |
| 压缩 | `text/event-stream` 响应被排除在 gzip 之外 | `packages/host/webserver/src/index.ts:248` |
| index 注入 | `webserver/index-inject` 事件为页面所对话的 Peer 收集结构化 index 行 | `packages/host/webserver/src/index.ts:44`、`packages/host/webserver/src/index.ts:725-740` |

## API Gateway

`packages/api/gateway` 硬依赖 Typert 注册表与 remote access 服务，两者都不是可选的（`packages/api/gateway/src/index.ts:214-215`）。它服务两个平面。

| 平面 | 载体 | 端点 | 证据 |
|---|---|---|---|
| 一元调用 | Connection 服务的 RPC 路由 | `/api` | `packages/api/gateway/src/index.ts:248-254` |
| 流式调用 | Gateway 自有的 WebSocket mux | `/api/remote.mux` | `packages/api/gateway/src/index.ts:255-324`、`packages/api/gateway/src/stream-protocol.ts:7` |

两个平面不可互换。流式方法通过一元载体打开会以 `gateway/signature-invalid` 失败，一元方法通过流式载体打开同样如此（`packages/api/gateway/src/index.ts:429-435`、`packages/api/gateway/src/index.ts:463-470`）。

Gateway 还拥有两个用于转发事件的内部端点：`$events` 承载事件流，`$events/result` 返回一个 Client 事件结果（`packages/api/gateway/src/stream-protocol.ts:10`、`packages/api/gateway/src/stream-protocol.ts:13`）。

事件转发在投递之前先做访问控制。

| 规则 | 细节 | 证据 |
|---|---|---|
| 整条通知或全无 | 非 owner 收到的是完整通知或什么都没有；payload 绝不裁剪，资源无效的通知不抵达任何非 owner | `packages/api/gateway/src/index.ts:615-637` |
| 带作用域的事件需要 Agent 身份 | 缺少非空 Agent 身份的带作用域 Remote 事件被拒绝 | `packages/api/gateway/src/index.ts:639-645` |
| 只有 owner 可应答 | 只有 owner Peer 可以应答转发的 Remote 事件，且只能应答自己的 client generation | `packages/api/gateway/src/index.ts:502-504` |
| 先授权后 lookup | 访问判定先于 lookup 解析，因此被拒绝的调用不会激活任何东西 | `packages/api/gateway/src/index.ts:802-826` |

## 三个 Controller

每个 controller 都是 `TypertRemoteService`，各有一个 Remote namespace，并各自注册自己的资源种类。

| Controller | Namespace | 资源种类 | 端点 | 证据 |
|---|---|---|---|---|
| Workspace | `workspace` | `workspace`，带 `workspaceId` 线上字段 | 一元 create、initializeDefault、rename、delete、insertBefore、insertSessionBefore、archiveSession、unarchiveSession、pinSession、unpinSession；一条 `follow` 流 | `packages/api/workspace-controller/src/index.ts:72`、`packages/api/workspace-controller/src/index.ts:73`、`packages/api/workspace-controller/src/index.ts:90-199`、`packages/api/workspace-controller/src/index.ts:205-260` |
| Job | `job` | 本包不注册 | `list` 流式给出整集 roster；`follow` 流式给出单个 job 的输出并支持从绝对字节偏移续读；`kill` 取消某个 job | `packages/api/job-controller/src/index.ts:59`、`packages/api/job-controller/src/index.ts:75-78`、`packages/api/job-controller/src/index.ts:90-96`、`packages/api/job-controller/src/index.ts:109-127` |
| Session | `session` | `session`，通过 resolve 函数解析 | 端点全集列在生成的客户端声明中 | `packages/api/session-controller/src/index.ts:179`、`packages/api/session-controller/src/index.ts:191`、`packages/api/session-controller/lib/typert.remote-client.d.ts:19-45` |

Workspace feed 是「基线 + 增量」流的参考形态。

| 部分 | 规则 | 证据 |
|---|---|---|
| 基线 | 完整的当前投影同步读自注册表：全部活跃 Workspace，加上已归档与已置顶的 Session 身份 | `packages/api/workspace-controller/src/feed.ts:75-99` |
| 增量 | 后续帧来自 storage domain 的 `domain/changed` 事件：upsert、移除、顺序变化、归档集合变化、置顶集合变化 | `packages/api/workspace-controller/src/feed.ts:101-142` |

Job follow 流增加了续读语义：请求携带可选的绝对字节偏移，缺省时流从最旧的保留字节开始（`packages/api/job-controller/src/types.ts:56-60`）。

## Typert 类型边界

Typert 是 Remote 方法的类型变成线上契约的地方。

| 元素 | 规则 | 证据 |
|---|---|---|
| 声明 | `@Remote` 装饰器标记一个公共实例方法，并把版本化描述符写到类上 | `packages/typert/protocol/src/index.ts:282-300`、`packages/typert/protocol/src/index.ts:404` |
| 描述符模型 | 生成器的模型记录 service、namespace、method、mode、invocation kind、参数、uplink、取消与结果边界 | `packages/typert/generator/src/model.ts:129-158` |
| 客户端声明 | 生成器从 Host FaceModel 产出客户端侧声明，文件头带「请勿编辑」的横幅 | `packages/typert/generator/src/emitter.ts:372-442`、`packages/typert/generator/src/emitter.ts:387` |
| 模块合并 | 产出的声明通过模块增强合并进 `TypertRemoteMap` 与 `TypertRemoteNamespaceMap` 接口 | `packages/typert/generator/src/emitter.ts:403-433` |
| strict codec | 生成器为每个边界生成 strict codec | `packages/typert/generator/src/emitter.ts:1154` |
| 每个参数两个 codec | 每个参数同时产出 `codec` 与 `strictCodec` | `packages/typert/generator/src/emitter.ts:335-344` |
| 挂载必须是 strict | 客户端拒绝挂载参数缺少 strict codec 的生成的 Remote | `packages/api/gateway/src/client/index.ts:302`、`packages/api/gateway/src/client/index.ts:803-818` |
| Host 侧匹配 | Host 匹配精确声明的参数集合，并对每个出现的参数各做一次 codec 校验 | `packages/api/gateway/src/index.ts:1630`、`packages/api/gateway/src/index.ts:1665` |
| SRC 兜底 | 仅带源码标记的方法走兜底路径：参数从 JavaScript 签名推导，每个边界都得到 `src-json` codec，因此被擦除的对象约束无法恢复 | `packages/api/gateway/src/index.ts:385-386`、`packages/api/gateway/src/index.ts:401-416`、`packages/api/gateway/src/index.ts:954-961`、`packages/api/gateway/src/index.ts:1010` |

## Client 插件体系

一个包的浏览器半边是独立入口，node 半边只为了让该包成为一个普通 Loader 行而存在。`packages/client/ui-jobs` 展示了这一分工：node 半边是一个空实现体（`packages/client/ui-jobs/src/index.ts:1-9`），浏览器半边承担全部功能，包括它的 locale 字典与它的 slot 注册（`packages/client/ui-jobs/src/client/index.ts:1-53`）。

| 规则 | 细节 | 证据 |
|---|---|---|
| 声明 | 一个包通过 `dsh.client` 声明其浏览器半边，由 node 半边扫描与 roster 生成器共用的同一个校验器解析 | `packages/client/modules/src/client/manifest.ts:173-193` |
| 平台过滤 | `platform` 不是 `web` 的包永远不进入浏览器图 | `packages/client/modules/src/index.ts:905` |
| 必须导出 | 已声明的包必须导出 `./client` bundle；缺失是一次显性失败 | `packages/client/modules/src/index.ts:203-214`、`packages/client/modules/src/index.ts:906-909` |
| 图结构 | 组合出的图携带条目、带 bootstrap 或 application 阶段的批次，以及一个修订锚点 | `packages/client/modules/src/client/manifest.ts:52-107` |
| bundle 路由 | bundle 与包资源由一个前缀路由服务 | `packages/client/modules/src/index.ts:705` |
| boot 注入 | boot 脚本与 `__DSH_BOOT__` 全局被注入每一个渲染出的 index | `packages/client/modules/src/index.ts:602-637`、`packages/client/modules/src/index.ts:710-712` |

浏览器半边内部存在两种扩展风格。

| 风格 | 规则 | 证据 |
|---|---|---|
| slot 注入 | UI 插件注入既有命名 slot，并在其中注册自己的组件 | `packages/client/ui-jobs/src/client/index.ts:35-52` |
| resource | 一个 resource 就是一条 `dsh-resource://<type>/…` 形式的地址；首帧承载当前值，之后每一帧承载一次变化 | `packages/client/resources/src/client/contract.ts:1-16`、`packages/client/resources/src/client/contract.ts:60-62`、`packages/client/resources/src/client/contract.ts:71-85` |

## 明确回答

**进度订阅走 Remote 流载体，不是 SSE。** 本仓库中面向领域状态的客户端推送路径是 Gateway 的 WebSocket mux。`text/event-stream` 出现在 gzip 排除逻辑（`packages/host/webserver/src/index.ts:248`）、仅供开发的插件图通道（`packages/client/hmr/src/index.ts:168`、`packages/client/hmr/src/client/index.ts:31`），以及上游 LLM 与 mock server 中（`packages/llm/llm-deepseek/src/adapter.ts:146`）。它们都不是领域状态的客户端推送路径。

**TestPilot 的 Web UI 是同一个包的 `./client` 半边。**它是一个 client module，不是第二个独立包，也不是独立前端应用，因为 boot 图由 Host 合成，一个包只能通过其 `dsh.client` 声明与 `./client` 导出进入该图（`packages/client/modules/src/index.ts:905`、`packages/client/modules/src/index.ts:906-909`）。

**浏览器刷新后的状态恢复不需要新机制。**现有机制已经提供了 Host 权威的基线加增量。

| 机制 | 规则 | 证据 |
|---|---|---|
| generation 基线 | Remote 流以当前完整快照作为其 generation 的首帧开启 | `packages/api/workspace-controller/src/feed.ts:88-99`、`packages/api/job-controller/src/index.ts:90-96` |
| 恰好一个开场快照 | 协议层拒绝发出多于一个开场快照的流，也拒绝在开场快照之前发出更新 | `packages/api/gateway/src/client/snapshot-stream.ts:76-88` |
| 游标续读 | 流客户端把游标作为 `from` 传回，Host 从该绝对偏移续读 | `packages/api/job-controller/src/types.ts:56-60` |
| 丢失被标记 | 当环形缓冲已淘汰请求偏移与所交付块之间的字节时，帧携带 `lossy`，而不是静默丢弃数据 | `packages/api/job-controller/src/types.ts:84-85` |

浏览器本地存储不是替代方案。客户端 projection store 在内存中，刷新即丢失（`packages/api/session-controller/src/client/sessions/projection-store.ts:92-97`）。因此 TestRun 必须是 Host 持久化的域记录，客户端通过同一套「基线 + 增量」协议读回。

**新的 TestPilot Remote API 必须由 Typert 生成器产出 strict 定义。**SRC 标记兜底确实存在，但它从 JavaScript 签名推导参数，并给每个边界 `src-json` codec，因此被擦除的对象约束已经消失（`packages/api/gateway/src/index.ts:954-961`），而且客户端无论如何都会拒绝挂载缺少 strict codec 的描述符（`packages/api/gateway/src/client/index.ts:803-818`）。

## TestPilot 不可假定的事项

| 假定 | 状态 |
|---|---|
| Host web server 提供应用文件 | 否；它只注册路由，dist 服务由组合方应用负责（`packages/host/webserver/src/index.ts:4-6`） |
| 通配绑定地址可以接受 | 否；它在加载期被拒，因为绑定所有网卡会把远程代码执行暴露到网络（`packages/host/webserver/src/index.ts:358-366`） |
| 缺失的 TLS 文件会让监听器降级为 HTTP | 否；初始化直接拒绝（`packages/host/webserver/src/index.ts:278-289`） |
| 一元调用可以在流载体上打开 | 否；两个载体互相拒绝对方的 method mode（`packages/api/gateway/src/index.ts:463-470`） |
| 被拒绝的调用仍可能解析 lookup | 否；访问先于 lookup 解析（`packages/api/gateway/src/index.ts:802-826`） |
| 非 owner 会收到被裁剪的事件 payload | 否；它收到整条通知或什么都没有（`packages/api/gateway/src/index.ts:615-637`） |
| 独立前端包可以加入 boot 图 | 否；只有导出 `./client` 的 `dsh.client` 包才能进入（`packages/client/modules/src/index.ts:906-909`） |
| 浏览器本地存储可以在刷新后恢复状态 | 否；客户端 projection store 在内存中（`packages/api/session-controller/src/client/sessions/projection-store.ts:92-97`） |
| 仅带源码标记的 Remote 方法保留其对象约束 | 否；兜底路径给每个边界 `src-json` codec（`packages/api/gateway/src/index.ts:1010`） |

## 进一步探索

- [项目归属审计](project-ownership-audit.zh.md) —— 测试项目应归属何处，以及远程调用者如何抵达它。
- [证据与可观测性审计](evidence-observability-audit.zh.md) —— 测试运行的证据如何存储与取回。
- [阶段 0 验收](phase-0-acceptance.zh.md) —— 验收标准与未决阻塞项。
