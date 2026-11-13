# TestPilot 阶段 0 — 审批、权限与凭据审计

[English](approval-security-audit.md) | 中文

本审计记录当一个动作需要决定时，harness 强制了什么，以及它对机密信息没有强制什么。方案要求高风险的浏览器动作在发生之前获得审批，也要求表单密码能抵达页面却不抵达模型。这两项要求落在形态各异的既有接缝上。

## 审批服务

`packages/interaction/user-approval/src/index.ts:242` 是 `request(req: ApprovalRequest)`。该请求携带 agent、工具名、可选的 call id、可选的理由与可选的信号。

`request` 所做的第一件事是检查轮次前置条件。`packages/interaction/user-approval/src/index.ts:244` 在 session 的投影状态没有开启轮次时抛出，而且抛出发生在任何内容被追加到日志之前。该消息给出了原因：`approval/asked` 与 `approval/decided` 审计对必须被轮次包裹，而轮次之间的裸事件在重载后是崩溃尾巴垃圾（`packages/interaction/user-approval/src/index.ts:245`）。

| 顺序 | 步骤 | 证据 |
|---|---|---|
| 1 | 检查轮次前置条件，违反时在追加任何内容之前抛出 | `packages/interaction/user-approval/src/index.ts:244` |
| 2 | 铸造请求 id | `packages/interaction/user-approval/src/index.ts:251` |
| 3 | 追加 `approval/asked` | `packages/interaction/user-approval/src/index.ts:252` |
| 4 | 达成决定 | `packages/interaction/user-approval/src/index.ts:258` |
| 5 | 追加 `approval/decided` | `packages/interaction/user-approval/src/index.ts:259` |

结果词汇是封闭的（`packages/interaction/user-approval/src/types.ts:32`）：`'allowed-once'`、`'rejected'`、`'cancelled'` 与 `'unavailable'`。只有 `allowed-once` 授予执行。

`'never'` 策略在服务内部决定，而不是在监听器内部决定。`packages/interaction/user-approval/src/index.ts:296` 给出了原因：在本服务挂载之后以 `prepend: true` 注册的监听器会排在任何闸门监听器之前，因此监听器形态的闸门无法守住"`'never'` 无论注册顺序如何都确定性地拒绝"这一承诺。该检查位于 `packages/interaction/user-approval/src/index.ts:301`。

每一种失败模式都关闭问题，而不是打开调用方的工具调用。`packages/interaction/user-approval/src/index.ts:306` 在派发之前进入 promise 链，因此同步抛出的监听器与异步抛出的监听器落在同一条拒绝路径上。缺失或抛错的应答者得到 `'unavailable'`（`packages/interaction/user-approval/src/index.ts:317`），落在封闭词汇之外的返回值被归一化为 `'unavailable'`（`packages/interaction/user-approval/src/index.ts:314`）。

## 审批应答者 waterfall

`approval/request` 事件是一个 waterfall（`packages/interaction/user-approval/src/types.ts:87`）。服务以请求自身的 agent 为作用域派发它：`packages/interaction/user-approval/src/index.ts:307` 调用 `this.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req, …)`。因此 agent 作用域的应答者只看到它所拥有的 agent 的请求。

`displayReason` 仅用于呈现。`packages/interaction/user-approval/src/types.ts:73` 陈述它永不在审批审计事件中被持久化，而 `reason` 是询问方自己的、被审计的解释。

审计对是两个仅日志的 session 事件。它们声明在 `packages/interaction/user-approval/src/types.ts:44` 与 `packages/interaction/user-approval/src/types.ts:55`。

| 事件 | 字段 | 性质 |
|---|---|---|
| `approval/asked` | `id`、`toolName`、可选 `callId`、可选 `reason` | 仅日志审计；不是 surface 事件 |
| `approval/decided` | `id`、`outcome` | 仅日志审计；每次询问恰好一个 |

## ask 与 never 策略

`packages/interaction/user-approval/src/index.ts:68` 声明策略并集 `'ask' | 'never'`，`packages/interaction/user-approval/src/index.ts:71` 列出两个取值供校验与通告使用。

| 策略 | 行为 | 证据 |
|---|---|---|
| `ask` | 委派给已组合的应答者；没有组合任何应答者时，链路落到 `'unavailable'` | `packages/interaction/user-approval/src/index.ts:62` |
| `never` | 永不询问任何人；每次询问都确定性地解析为 `'rejected'`，在服务内部决定 | `packages/interaction/user-approval/src/index.ts:64`、`packages/interaction/user-approval/src/index.ts:301` |

两个策略都会以运行时上下文条目的形式发布给模型，各带一句不同的陈述（`packages/interaction/user-approval/src/index.ts:74`、`packages/interaction/user-approval/src/index.ts:76`）。

## UI 与 ACP 应答

ACP 桥只应答审批，别无其他。`packages/acp/acp/src/index.ts:158` 注册一个 `approval/request` 监听器，恰好给出两个选项：`allow-once` 与 `reject-once`（`packages/acp/acp/src/index.ts:166`）。该桥绝不从未知的客户端响应中推断出持久授权（`packages/acp/acp/src/index.ts:156`），并把除 `allow-once` 之外的一切映射为 `'rejected'`（`packages/acp/acp/src/index.ts:174`）。

自由形式的问题走另一条路径。`packages/interaction/user-questions/src/index.ts:169` 是 `answer` 远端端点：它解析待答问题，校验该批次恰好各点名每个问题一次，然后把回复 steer 进 agent。有两项限制。调用方必须是确切的实时调用 agent（`packages/interaction/user-questions/src/index.ts:139`），而 session origin 为 `subagent` 的调用方被以 `DELEGATED_CALLER` 拒绝（`packages/interaction/user-questions/src/index.ts:144`）。

## 凭据引用

凭据接缝有两套键空间，且不会相撞。`packages/credentials/credentials/src/types.ts:14` 声明 `CredentialRef` 是对一个凭据的标称引用：POSIX 风格的环境变量名。`packages/credentials/credentials/src/types.ts:29` 声明 `CredentialKey` 是一条已存记录的地址，`<scope>/<id>`。那个 `/` 让两套语法保持不相交（`packages/credentials/credentials/src/types.ts:26`）。

本地 provider 明文落盘。`packages/credentials/credentials-local/src/index.ts:61` 把该文件命名为 harness home 下的 `.credentials.yaml`，`packages/credentials/credentials-local/src/index.ts:717` 以 `0600` 模式写入它、目录模式 `0700`。没有加密；保护仅来自文件模式。`packages/credentials/credentials-local/src/index.ts:450` 把引用值直接渲染进该文档。

读回是掩码的。`packages/credentials/credentials-local/src/index.ts:522` 保留 provider 标识与一小段前缀和后缀，并掩掉其间的全部内容——前提是至少八个码位仍被隐藏；否则整串都被掩掉。`packages/credentials/credentials-local/src/index.ts:650` 是只返回掩码形态的 `describe()` 路径。

解析优先级是文件、然后环境、然后 dotenv。`packages/credentials/credentials-local/src/index.ts:638` 先读已存值，`packages/credentials/credentials-local/src/index.ts:641` 回落到继承的环境，`packages/credentials/credentials-local/src/index.ts:643` 再回落到 `.env` 文件。dotenv 回落被明确置于受管存储之下，绝不在其之上（`packages/credentials/credentials-local/src/index.ts:578`）。

## 机密处理的边界

`${credential:REF}` 模板只存在于一处。`packages/mcp/mcp-client/src/templates.ts:14` 定义该记号模式，`packages/mcp/mcp-client/src/credentials.ts:83` 解析它——但只在 MCP 传输字符串上：stdio 的 command、args、env 与 cwd，或 HTTP 的 url 与 headers（`packages/mcp/mcp-client/src/credentials.ts:83`、`packages/mcp/mcp-client/src/credentials.ts:94`）。

不存在通用的非 MCP 注入通道。凭据引用是一种面向 MCP 服务器的传输字符串机制，而不是工具体或表单填写器可以使用的通用机密替换设施。

脱敏比注入更窄。MCP 客户端的 redact 覆盖错误诊断（`packages/mcp/mcp-client/src/tools.ts:163`）与 `isError` 结果的文本（`packages/mcp/mcp-client/src/tools.ts:160`）。它不覆盖成功结果、`structuredContent` 载荷，也不覆盖 `resources/read` 的返回值（`packages/mcp/mcp-client/src/connection.ts:375`）。

模板展开默认关闭。`packages/mcp/mcp-client/src/index.ts:172` 与 `packages/mcp/mcp-client/src/index.ts:185` 对两种传输都把 `expandTemplates` 默认为 `false`。MCP manager 强制把它对每个由它管理的服务器设为 `true`（`packages/mcp/mcp-manager/src/index.ts:578`）。

客户端侧的掩码只改变显示。`packages/client/ui-secret-mask/src/client/index.ts:1` 陈述掩码只改变绘制出的文本；消息文本、复制动作与模型输入保留原始字符。

## 对测试环境的含义

引用形态可用。TestPilot 的配置可以命名 `${credential:REF}`，而配置面只显示掩码形态。

有两项性质并不成立。

| 主张 | 结论 | 证据 |
|---|---|---|
| "机密永不落盘" | 在存储层不成立：本地 provider 明文写入 `.credentials.yaml`，而 `.env` 文件是活的回落来源 | `packages/credentials/credentials-local/src/index.ts:717`、`packages/credentials/credentials-local/src/index.ts:582` |
| "机密永不到达模型" | 按字面不成立：掩码只影响显示，MCP 脱敏不覆盖成功结果与 `resources/read` | `packages/client/ui-secret-mask/src/client/index.ts:1`、`packages/mcp/mcp-client/src/connection.ts:375` |

第三项性质是缺失而非为假。不存在一条能把机密注入浏览器表单、同时让它留在模型上下文之外的通道。若 TestPilot 必须把密码输入页面，它必须自行构建那条通道，位于模型可见的转录之外。

## 高风险审批的先例

仓库中存在两处"判定一个动作需要决定"的先例。二者都不是按工具划分的风险注册表。

第一处把 sandbox 模式与审批策略组合起来。`packages/interaction/permission-presets/src/index.ts:58` 把一个预设声明为 `sandbox` 取值加上 `approval` 取值。默认表把 `workspace-write` 绑定到 `ask`（`packages/interaction/permission-presets/src/index.ts:184`），把 `danger-full-access` 绑定到 `never`（`packages/interaction/permission-presets/src/index.ts:188`）。`auto` 预设是 `danger-full-access` 与 `ask` 的固定组合（`packages/interaction/permission-presets/src/index.ts:83`）。选定预设会通过各自的 setter 写入 sandbox 模式与审批策略（`packages/interaction/permission-presets/src/index.ts:398`）。sandbox 模式词汇是 `read-only`、`workspace-write` 与 `danger-full-access`（`packages/sandbox/sandbox/src/index.ts:38`），升级是一条从 `read-only` 经 `workspace-write` 到 `danger-full-access` 的严格放宽阶梯（`packages/sandbox/sandbox/src/escalation.ts:64`）；升级本身是针对该调用生效模式的执行期检查，而不是 schema 约束（`packages/sandbox/sandbox/src/escalation.ts:212`）。

第二处是语言模型风险审阅。`packages/experimental/auto-review/src/index.ts:67` 定义三个类别，并按待决动作的实际效果分类，绝不按工具名、消息语气或声称的意图分类。medium 需要当前的明确授权；high 必须始终被拒绝，即便用户明确请求了该动作（`packages/experimental/auto-review/src/index.ts:69`）。session 钉住 `never` 策略时被拒的调用成为拒绝（`packages/experimental/auto-review/src/index.ts:770`），而在交互式策略下被拒的调用成为一次询问，表现为 `PreToolDecision{ kind: 'ask' }`（`packages/experimental/auto-review/src/index.ts:712`）。

二者之间的落差正是 TestPilot 必须构建的东西。`packages/core/tools/src/contracts.ts:375` 声明的 `PreToolDecision` 恰好有四个变体——`allow`、`deny`、`cancel` 与 `ask`——既无风险等级，也无工具名，也无策略字段。因此注册表中不存在任何可供读出风险的内容。MCP 桥在注册表看到之前就丢弃了上游注解，正如 MCP 契约审计所记录的那样。

一个指明工具并为其指派风险类别的声明式注册表在本仓库中并不存在。TestPilot 必须新增一个，并且必须决定它位于共享工具契约上，还是位于 TestPilot 自己的组合内部。

## 延伸阅读

- [执行隔离审计](execution-isolation-audit.zh.md) — 已批准的动作仍能触达什么。
- [agent、session 与工具生命周期审计](session-tool-lifecycle-audit.zh.md) — 审批在管线中占据的位置。
- [MCP 契约审计](mcp-contract-audit.zh.md) — 实测的工具列表与被丢弃的标签。
- [架构决策](architecture-decisions.zh.md) — 审批决策及其代价。
