# ADR-011 解除 — 审批上下文与 run-scoped 授权记录

**状态：已解除。** 本记录取代 [ADR-011 的阻塞结论](../phase-0/architecture-decisions.zh.md#adr-011--approval-credentials-and-high-risk-operations)，随阶段 1 契约冻结生效。[阶段 0 验收](../phase-0/phase-0-acceptance.zh.md#阻塞条件)的阻塞条件 4 与条件 3 的剩余部分由此关闭。

## 背景

一次测试运行比启动它的 agent 活得更久，而 worker 是 `ctx.subprocess` 下的受管子进程，既不是 agent 也不是 subagent（ADR-005、ADR-006，已核实）。后台 worker 因此没有 `Agent`、没有 `Session`、没有 `turn/start` 与 `turn/end` 围出的开启轮次，无法成为审批服务的合法请求方。阶段 0 把这一分叉记为 ADR-011 阻塞，并要求阶段 1 在实现 worker 之前定下审批设计，连同「一次批准永不授予永久授权」这条规则一起成文。本记录做这件事，冻结结论进入 [SPEC.md](SPEC.md)。

## 仓库事实（已核实）

- `ApprovalService.request()` 在 `packages/interaction/user-approval/src/index.ts:242-250` 读取 `req.agent.session`，第一件事是检查 `approvalStateOf(session).turnOpen`；为 false 时抛错，发生在 `session.append('approval/asked', …)` 之前，也就是在任何应答者被咨询之前。
- `turnOpen` 只由 `turn/start` 置真、`turn/end` 置假（`packages/interaction/user-approval/src/index.ts:97-107`）。
- `ApprovalRequest` 的 `agent: Agent` 是必填只读字段（`packages/interaction/user-approval/src/index.ts:128-149`），`request()` 从它取 session（同文件 `:243`）。
- `ApprovalOutcome` 是 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`，`allowed-once` 是唯一授予执行权的结果（`packages/interaction/user-approval/src/types.ts:28-32`，`src/index.ts:238-239`）。
- `never` 策略在服务的 `decide()` 内先行决定，注册顺序不影响它（`packages/interaction/user-approval/src/index.ts:293-301`）；策略默认 `ask`（同文件 `:170-172`）。
- 审批审计是成对的 `approval/asked` 与 `approval/decided`，由服务追加到请求方 session 的日志（`src/index.ts:252-259`、`src/types.ts:44-58`）；配对必须被轮次包围，否则重载时成为崩溃尾部垃圾（`src/index.ts:227-235`）。
- 审批检查运行在工具执行路径、浏览器调用之前，因为那条路径正是抛异常的监听器阻止派发的位置（`packages/core/tools/src/pipeline.ts:307`，见 ADR-011:203）。
- session 日志是模型可见的对话历史，session 作用域的产物随 session 释放而消失（ADR-005、ADR-012，已核实）。
- 存储域在一条先持久化再改内存的单一写入链之后维护权威状态（`packages/storage/storage-domain/src/domain.ts:1-9`），域 spec 带版本与兼容版本（`packages/storage/storage-domain/src/spec.ts:39,56`）。

## 可选方案与代价

| 方案 | 得到什么 | 代价 |
|---|---|---|
| 在 agent 的轮次内逐次批准 | 原样复用审批服务 | 风险闸门与 loop 轮次耦合；运行比 agent 活得久，agent 释放后运行仍在执行高风险浏览器动作却无轮次可问；要保住轮次就得让运行依附 session 生命周期，与 ADR-005、ADR-007 的「运行是一条域记录」冲突；后台运行变成每次高风险调用都要回到界面的交互式流程 |
| 整次运行开始前批准整次运行 | 一个轮次内取得一次决定，运行期间不再依赖轮次 | 需要一个带过期时间的自有授权记录；一次 `allowed-once` 被放大到覆盖整次运行的多次调用，放大靠绑定项与逐调用校验补偿 |
| 给 worker 一个带轮次语义的 session | worker 变成合法请求方 | 给后台进程强加它本不需要的概念；session 日志是模型可见历史，测试结果与凭据进入模型上下文；还要为 worker 造一个 `Agent` 并合成 `turn/start` 与 `turn/end`，等于伪造审计配对的提交与重放边界 |
| worker 直接调用 `ctx.approval.request()` | 无 | 轮次前置条件在应答者被咨询之前就抛错，零功能可得；绕过它要改共享审批服务，波及每一个消费者（ADR-011:205） |

## 采用方案

整次运行开始前批准整次运行，并把批准落成一条带过期时间的自有 run-scoped 授权记录。批准发生在启动运行的那个 agent 的开启轮次内，调用 `ctx.approval.request()`；服务返回 `allowed-once` 之后，TestPilot 在运行域追加授权记录，随后才启动运行。运行期间 worker 不接触审批服务，只校验这条记录。

worker 是 `ctx.subprocess` 子进程，没有 agent、没有 turn，而审批服务会拒绝无开启轮次的 session 所发起的请求（前节已核实），所以后台分支不能走审批服务。把批准前移到运行开始前，是唯一同时满足「运行在 agent 之后存活」「后台执行无需交互」「危险操作的审批发生在操作之前」的分支。审批检查点仍在工具执行路径、浏览器调用之前，改变的是它的断言依据：从 `ApprovalService.request()` 的应答换成 run-scoped 授权记录的校验。

### 授权记录（设计推断）

授权记录存放在第二个存储域，采用逐记录布局，与 `TestRun`、`TestResult`、`AuditEvent` 并列。

| 字段 | 绑定 | 作用 |
|---|---|---|
| `run_id` | 运行 ID | 授权只对这一次运行成立；把记录复制到另一次运行因 ID 不符被拒 |
| `workspace_id`、`project_id` | 项目 ID 与归属维度 | 授权不能跨项目挪用；两个字段在每条业务记录上都存在，查询由域访问层统一注入 |
| `spec_digest` | 参数摘要 | 对运行参数——项目、base URL、来源白名单、用例清单版本、并发上限、超时预算——规范化序列化后的摘要；运行时任一项不符即让运行失败 |
| `policy_version` | 策略版本 | 批准时快照 `src/risk.ts` 的策略版本；策略变更后旧授权立即失效 |
| `nonce` | 一次性 nonce | 批准时生成的随机值，运行启动时消费一次（compare-and-mark）；消费后不可再用于第二次启动 |
| `issued_at`、`expires_at` | 过期时间 | TTL 由 Config 的 `runAuthorizationTtlMs` 决定；超过 `expires_at` 后拒绝后续高风险调用，正在结算的用例不被打断，授权不续期 |
| `consumed_at`、`revoked_at` | 撤销与消费 | 两者都是追加状态，不改写原记录；校验读最新状态 |
| `approval_request_id` | 审计关联 | 指向启动 agent session 日志里的 `approval/asked` 与 `approval/decided` 配对 |

授权记录不暴露给任何工具入参，任何工具都不能按 id 更新或删除它；`AuditEvent` 逐条追加，写入方是 TestPilot 的域写入链，不是 agent，也不写进模型可见的 session 日志。审批服务自身的审计仍由它在轮次内成对追加到启动 agent 的 session 日志（已核实），两套审计靠 `approval_request_id` 与 `run_id` 关联，不做跨层合并。域的写入链与版本链是已核实事实（`packages/storage/storage-domain/src/domain.ts:1-9`、`src/spec.ts:39,56`）。

### 审批检查点

`src/approval-gate.ts` 在浏览器调用之前运行（`packages/core/tools/src/pipeline.ts:307`，已核实）。它读授权记录并逐次校验：`run_id` 一致、`workspace_id` 与 `project_id` 一致、`spec_digest` 一致、`policy_version` 一致、`nonce` 已消费且未重放、未过 `expires_at`、无 `revoked_at`。任一项不成立就抛异常阻止派发，并向运行域追加一条 `AuditEvent`。没有可用批准时同样拒绝：headless 与 CI 部署把 `ctx.approval` 的 policy 设为 `never`，服务在内部把每次 ask 判为 `rejected`（`packages/interaction/user-approval/src/index.ts:293-301`，已核实），因此不产生授权记录，高风险调用在派发前被拒。

### 一次批准永不授予永久授权

批准的作用域是一次运行，不是一次会话、一个用户、一个工具名或一个项目。`allowed-once` 在审批服务里是一次请求一次授予（已核实）；TestPilot 把它解释为「一次运行」，这是授权范围的放大，补偿是上表的绑定项、逐调用校验、过期、撤销与不可改审计。授权不写入用户级配置，不写入 session 的 `approval/policy` 覆盖，不因用户重复批准而累积，不跨运行复用。运行结束、过期或撤销之后，后续高风险调用重新要求一次新的批准。审批界面展示完整的运行参数摘要，用户批准的是那一份摘要，不是一句抽象允许；`displayReason` 只做本地化展示、不进审计（`packages/interaction/user-approval/src/types.ts:72-73`，已核实）。

## 不采用方案及代价

**在 agent 轮次内逐次批准。** 它把风险闸门钉在 loop 的轮次上，而 ADR-005 已定下运行比启动它的 agent 活得更久；agent 释放之后运行仍持有浏览器，授权却随轮次消失。要让它成立就得把运行塞进 session 生命周期，那会推翻 ADR-005 与 ADR-007 的数据模型。

**给 worker 一个带轮次语义的 session。** 它为一个后台进程引入它本不需要的对话概念，并把测试结果写进模型可见历史（ADR-012:223）。`ApprovalRequest.agent` 是必填（`src/index.ts:134`），因此还要为 worker 造一个 `Agent`；`turn/start` 与 `turn/end` 也得合成，而审批审计配对恰恰依赖这两个事件界定提交与重放边界（`src/index.ts:227-235`）。合成它们等于伪造审计的完整性前提。

**worker 直接调用审批服务。** 轮次检查在追加任何内容之前抛错（ADR-011:205），这条分支连一次应答都拿不到。

**用户级或会话级永久授权。** 它直接违反「一次批准永不授予永久授权」：一次批准的授权被后续运行、后续参数与后续策略复用，语义与 `allowed-once` 相反。这不是 ADR-011 列出的三分支，而是授权记录缺少任一绑定项后退化的形态，因此单独否决。

## 风险

授权范围被放大：一次 `allowed-once` 覆盖整次运行的多次高风险调用，摘要算法或校验漏项会让未批准的动作通过。

时长与暴露窗口：套件时长不可预知，TTL 过短让长套件中途失败，过长拉大暴露窗口；撤销与过期只阻止后续调用，已经投递给浏览器的动作不可撤销（ADR-013:243）。

跨进程：授权记录在运行域，worker 以只读投影获得；投影被复制或缓存陈旧时撤销不能即时生效；存储域没有跨进程锁（ADR-007:129），两个进程写同一域需自带锁。

凭据：本地凭据静态明文，MCP 之外不存在把机密注入浏览器表单又留在模型上下文之外的通道（ADR-011:207）。本决策不解开这条，也不因授权记录的存在而放宽它。

审计分层：审批服务审计在 session 日志、TestPilot 审计在运行域，靠 ID 关联，不做原子合并；任一层的保留策略先到期都会留下半边证据。

containment：无原生受管范围的平台上，存活的后代进程不保证被终止（ADR-006:111）。

## 验证方式

阶段 1 承接 ADR-011:209 的验收标准，并把授权记录的绑定项逐条变成用例。

1. 无可用批准时高风险浏览器调用被拒，拒绝发生在派发之前，审计被写入运行域。
2. 过期、撤销、nonce 重放、`spec_digest` 不符、`policy_version` 变更、`run_id` 错配各有独立拒绝用例。
3. 一次运行的授权不能启动第二次运行；重复批准不累积成跨运行授权。
4. 审批审计在启动 agent 的 session 日志里成对出现；TestPilot 的授权与审计记录不出现在模型可见的 session 日志里，且没有任何工具能改写它们。
5. 端到端：在开启轮次内批准，运行域出现授权记录，高风险调用通过，撤销，后续调用被拒，两层审计可按 ID 对账。
6. `never` 策略下的 headless 启动不产生授权记录，运行启动本身被拒。

## 对阶段 2 的影响

worker 继承的是授权记录的只读投影与校验器，不是 `ApprovalService` 句柄；worker 不得调用 `ctx.approval`。ADR-011:211 的「阶段 2 为其 worker 继承审批上下文」在此收窄为只读上下文。

worker 池在派生子进程之前完成授权校验；授权不可用时拒绝启动运行，而不是启动后再失败。

阶段 5 只读取证据，从不需要批准（ADR-011:211）。

阶段 0 阻塞条件 4「无法证明危险操作的审批发生在操作之前」与条件 3 的剩余部分由此关闭。阶段 1 得以开始 worker 之前的工作；worker 池本身仍归阶段 2 的边界（[阶段 0 验收](../phase-0/phase-0-acceptance.zh.md#阶段-1-边界)）。

授权记录的字段、TTL、nonce 消费与撤销语义进入 [SPEC.md](SPEC.md)，阶段 2 不得另造一套授权结构。

## 关联决策

| 决策 | 本记录与它的关系 |
|---|---|
| ADR-005 | worker 是子进程、不是 subagent，构成本决策的前提 |
| ADR-006 | 运行生命周期由 TestPilot 自己拥有，`ctx.subprocess` 是进程原语 |
| ADR-007 | 授权记录落在逐记录布局的第二个域；存储层无保留机制，TestPilot 自建 |
| ADR-008 | `workspace_id` 与 `project_id` 是授权记录的归属维度 |
| ADR-010 | 白名单与审批同为派发前检查，互不替代；两者都不构成安全边界 |
| ADR-012 | 结构化证据在域、二进制证据在附件；session 日志不承载 TestPilot 审计 |
| ADR-013 | 取消不可撤销已投递动作，撤销授权同样不追溯 |
| ADR-014 | 本记录的六组断言进入包自身的门禁 |

## 证据约定

标注「已核实」的主张附本树文件路径与行号；标注「设计推断」的主张是 TestPilot 新增契约，仓库内不存在对应 API。这与 [阶段 0 的证据约定](../phase-0/README.zh.md#证据约定) 一致，本记录把「待核实」与「新增设计」都归到「设计推断」下，不为未读完整调用链的推断挂「已核实」。未使用用户知识库（连接器不可用），技术判断以本树源码与阶段 0 审计为准。
