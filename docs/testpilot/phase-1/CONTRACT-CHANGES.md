# TestPilot 阶段 1 — 契约变更记录（裁决 C 与裁决 A 收口）

交付总监裁决采用 C（折中）：工程骨架口径为准，不返工已落地代码，由架构师签发契约变更。理由是骨架已是可编译、可测试、可打包的实现，且比冻结契约多覆盖用户明确要的「发布 + 查监控」链路（`dataDir` 真实落盘、`metricsEnabled`、`testpilot_status`、`testpilot_metrics`、四种报告）；方案 A 的半天返工会换掉已验证能力，方案 B 在阶段 1 内制造契约变更并重新论证已核实约束。授权语义随后由交付总监单独裁决 A 收口，裁决 C 的保护对象明确限定为 Config 八项、十二个工具、原子 JSON 存储、函数插件形态、报告与监控链路，`assertAllowed` 不在保护范围内。本记录登记八项变更，以及骨架与 [SPEC.md](SPEC.md) 的只读差异清单。[ADR-011-resolution.md](ADR-011-resolution.md) 的结论不变。本记录只写文档，不动 `packages/` 下任何文件，不重跑门禁。

## 变更登记

| # | 契约项 | 冻结时口径 | 变更后口径 | 理由 | 改的代价 |
|---|---|---|---|---|---|
| 1 | Config | 九个字段：`runAuthorizationTtlMs`、`originAllowlist`、`attachHostAllowlist`、`evidenceQuotaBytes`、`evidenceRetentionDays`、`workerPoolSize`、`caseTimeoutMs`、`reportFormats`、`logLevel` | 骨架八项：`dataDir`、`allowedOrigins`、`policyVersion`、`approvalTtlMs`、`snapshotTtlMs`、`workerPoolSize`、`retentionDays`、`metricsEnabled` | 八项全部落在可编译的 schema 与真实落盘路径上；`policyVersion` 保留可配，因为它同时进入 `configDigest()`（`src/config.ts:44-52`）与授权校验（`src/policy.ts:83`），比 `src/risk.ts` 的模块常量更适合一个可发布 bundle：部署改策略版本即让旧授权失效，无需改代码重新发版 | 低：字段改名与默认值调整集中在 schema，调用方由 Loader 一次校验 |
| 2 | 模型可见工具 | 十个：`project_list`、`plan_create`、`case_record`、`case_list`、`run_start`、`run_status`、`run_cancel`、`result_get`、`report_render`、`evidence_get` | 十二个，见附录 B | 方案 12.1 把工具目录分成 Project、Planning、Execution、Exploration、Quality、Intelligence、Evidence 七组并给出 8–12 上限；骨架收敛的是 Execution、Quality、Evidence 与可观测性，Project 只保留两个最薄入口。Planning、Exploration、Intelligence 未实现，一律不进 schema，因为方案禁止「把未实现功能放进工具 Schema 后返回成功」 | 中：冻结清单里七个工具名移入阶段 2 候选，门禁断言与 Model Experience 文档已按十二个工具成文 |
| 3 | 重定向边界 | 「来源白名单不覆盖跨来源重定向」，跨越白名单的重定向按「会被跟随」处理 | 上游 allowed-origins 选项不覆盖重定向、不是安全边界；TestPilot 通过 `checkRedirect()` 逐跳检查重定向目标，但该检查在真实浏览器测试记录观察结果之前也不构成安全边界；阶段 4 不得放宽 | 冻结措辞与骨架的逐跳检查互相矛盾，README 与 DETAIL 已按更精确的口径成文（`README.md:76`、`docs/DETAIL.md:13`） | 低：只改契约措辞，代码与 README 不动 |
| 4 | RPO / RTO | 两个候选，留待业务方确认 | 单机本地原子 JSON 档：RPO = 0，每次写入原子落盘；RTO = 一次进程重启加一次 `store.ready()`。[假设] 以单机单进程、无并发写入者为前提，可由业务方推翻 | 交付总监裁定；`src/store.ts:61-73` 的唯一临时文件加 `rename` 支撑 RPO，`src/store.ts:48-51` 与 `src/index.ts:39` 支撑 RTO | 中：多进程写入同一 `dataDir` 需补跨进程锁，ADR-007:129 已核实存储层没有该锁 |
| 5 | 依赖 | 阶段 0 冻结八个工作区依赖，「阶段 1 不新增任何第三方依赖」成立 | 规则保持成立；交付总监决定移除 `js-yaml` 等新增第三方，组合测试改用纯文本断言 | 组合测试读 patch 不必引入 YAML 解析器，纯文本断言覆盖同一条组合行为 | 低：改测试读取方式，不触碰运行时依赖面 |
| 6 | 持久化与插件形态 | ADR-007 的两个 `dsh-storage` 域；单数 `ctx.testpilot` 与 `TestPilotService` | 阶段 1 以骨架为准：`src/store.ts` 的原子 JSON 文件适配器；`src/index.ts` 的具名导出函数插件（`name`、`inject`、`apply`）。双域与单数 Service 键移入阶段 2 候选，论证不删除 | 裁决 C 的连带修正。骨架 README 的 Known Limitations 已自认「不用 `dsh-storage` 域、双域迁移归阶段 2」（`README.md:74`）；若只改 RPO/RTO 而不改这两节，契约会一边声称双域与 `ctx.testpilot`、一边声称单机原子 JSON，自相矛盾 | 低：改的是契约描述，工程侧零改动 |
| 7 | 授权记录实现补充 | ADR-011-resolution.md 要求绑定 `workspace_id` 与一次性 `nonce` 消费 | `workspace_id` 通过运行参数摘要绑定，`ApprovalGrant` 接口不变；`nonce` 由 `consume()` 提供一次性 compare-and-mark | `grantParameters(run, workspaceId)` 已把 workspace_id 写进运行参数摘要并在 `src/tools.ts:112,200` 用于签发与校验，当前没有按 workspace 查授权的消费者，接口层字段追加已撤回 | 低：`assertAllowed` 改为非消费式、`consume()` 承担 nonce compare-and-mark，导出签名与六个拒绝码不变；ADR 结论不变 |
| 8 | 授权语义收口 | 后端 `src/approval-gate.ts:59` 的「一次 grant 只授权一次高风险调用」，`assertAllowed()` 对高风险调用内部原子消费 | 裁决 A：`assertAllowed` 为非消费式逐次校验；`consume()` 提供 `nonce` 一次性 compare-and-mark；`consumed` 拒绝码只用于第二次 `consume`、不用于第二次派发；`active` 包含已消费但未过期未撤销的 grant；ADR-011-resolution.md 结论不变 | 交付总监明确裁决 C 的保护对象不含 `assertAllowed`，安全语义以冻结契约为准；一次一消费会让 `ctx.subprocess` worker 在无 agent 与开启轮次时无法补批准，整次运行的第二个高风险动作被拒 | 中：改 `approval-gate.ts` 的实现语义，导出签名与六个稳定拒绝码不变，验收用例不踩坑 |

## 被否决的两个方案（裁决 C 阶段）

本节的 A 与 B 是裁决 C 的候选选项，与授权语义收口的方案 A / 方案 B 不是同一组选项。

**方案 A：工程按冻结契约对齐。** 代价是约半天返工，并换掉骨架已验证的 `dataDir` 落盘、`testpilot_status` / `testpilot_metrics` 查监控链路与四种报告生产。交付总监判定这些能力正是用户明确要的，返工方向不成立。

**方案 B：保留骨架口径，改 SPEC 与 ADR。** 代价是在阶段 1 内制造契约变更，重跑端到端验证，并重新论证 `ctx` 单复数、ADR-007 域形态等已核实的约束。裁决 C 只改 SPEC 措辞、不动 ADR-011 结论，规避了这段重论证。

## SPEC.md 同步点

第 1 节约束数字、第 2 节 patch 配置与依赖段、第 3 节整节、第 4 节 Config 表与阶段 2 候选段、第 5 节整节（含 RPO/RTO 收口）、第 6 节来源白名单行与表后说明、第 7 节整节、第 8 至 10 节的字段口径、第 11 节保留与升级、第 12 节七条成文结论、第 13 节决策表、第 14 节能力缝表、第 15 节断言序列、第 16 节证据约定。冻结表中被骨架吸收或推迟的字段一律移入「阶段 2 候选」，论证保留。授权语义收口不改 SPEC.md 的结论：第 13 节「一次批准覆盖整次运行」与裁决 A 一致。

## 附录：只读契约对账

对账只报差异与结论，核查时点以本次 `Read` 与 `Glob` 的结果为准；并发补齐中的文件按「核查时点未在树中出现」登记，不推断其最终内容。所有路径相对 `packages/experimental/testpilot/`。

### A. Config 八项（`src/config.ts:6-36`，已核实）

| 骨架字段 | 默认值 | 冻结契约对应 | 差异 |
|---|---|---|---|
| `dataDir` | `''` | 无 | 新增，落盘根目录，空选 `<cwd>/.testpilot` |
| `allowedOrigins` | `[]` | `originAllowlist` | 改名；空值语义从「只放行项目 base URL 主机」变为「拒绝一切导航，fail closed」，更严格 |
| `policyVersion` | `'1'` | 原定为 `src/risk.ts` 模块常量 | 新增且可配，见变更 1 的理由 |
| `approvalTtlMs` | `900000` | `runAuthorizationTtlMs` | 改名，默认值相同 |
| `snapshotTtlMs` | `300000` | 无 | 新增，快照引用 TTL |
| `workerPoolSize` | `2` | `workerPoolSize` | 默认值相同；取值范围 `1`–`8` 变为 `1`–`16` |
| `retentionDays` | `30` | `evidenceRetentionDays`（14） | 改名，默认值 14 变 30 |
| `metricsEnabled` | `true` | 无 | 新增 |

冻结契约独有、移入阶段 2 候选的五项：`attachHostAllowlist`、`evidenceQuotaBytes`、`caseTimeoutMs`、`reportFormats`、`logLevel`。`cordis.patch.yml:4-13` 与 `README.md:23-32` 的八项取值和 `src/config.ts:27-36` 一致。结论：以骨架八项为准，论证不删除。

### B. 十二个模型可见工具（`src/tools.ts:45-308`，已核实）

| 分组 | 工具 | 相对冻结清单 |
|---|---|---|
| Project | `testpilot_project_create` | 新增 |
| Project | `testpilot_project_list` | 同名保留 |
| Execution | `testpilot_run_start` | 同名保留 |
| Execution | `testpilot_run_get` | 新增，取代 `testpilot_run_status` |
| Execution | `testpilot_run_list` | 新增 |
| Quality | `testpilot_snapshot_capture` | 新增 |
| Quality | `testpilot_locator_check` | 新增 |
| Quality | `testpilot_gate_evaluate` | 新增 |
| Evidence | `testpilot_report_get` | 新增，取代 `testpilot_report_render` |
| Evidence | `testpilot_evidence_list` | 新增，取代 `testpilot_evidence_get` |
| 可观测性 | `testpilot_metrics` | 新增 |
| 可观测性 | `testpilot_status` | 新增 |

交集只有 `testpilot_project_list` 与 `testpilot_run_start`。冻结清单移入阶段 2 候选的七个：`testpilot_plan_create`、`testpilot_case_record`、`testpilot_case_list`、`testpilot_result_get`、`testpilot_run_cancel`、`testpilot_report_render`、`testpilot_evidence_get`，分别属于 Planning、Intelligence 与未实现的撤销路径。`README.md:34`、`README.zh.md:34` 与 `README.md:48` 的三处清单都是这十二个，彼此一致。结论：十二个落在方案 12.1 的 8–12 上限，未实现的 Planning / Exploration / Intelligence 不进 schema。

### C. 授权记录字段

`src/approval-gate.ts` 在首次只读核查时未出现在 `src/*.ts` 清单中，后端随后补齐。已核实代码里的绑定：`src/policy.ts:12-21` 的 `grantParameters(run, workspaceId)` 给出 runId、workspaceId、projectId、planId、mode、commitSha、configDigest；`src/policy.ts:84-90` 的校验读取 grantId、runId、projectId、policyVersion、parameterDigest、revokedAtMs，`active(nowMs)` 隐含过期判定；`src/tools.ts:108-118` 的 `issue()` 传 runId、projectId、policyVersion、parameters、ttlMs、nowMs，返回 grantId 与 expiresAtMs。`README.md:40`、`README.zh.md:40` 写成「绑定 runId、projectId、policyVersion 与参数 SHA-256 摘要，会过期、在结算时撤销、不可重放」。

`workspace_id` 通过运行参数摘要绑定，`ApprovalGrant` 接口不变；`nonce` 由 `consume()` 提供一次性 compare-and-mark；`assertAllowed` 为非消费式逐次校验；`consumed` 拒绝码只用于第二次 `consume`，不用于第二次派发。相对 [ADR-011-resolution.md](ADR-011-resolution.md)，`approval_request_id` 的两套审计关联仍属阶段 2 范围。交付总监那条「直接向后端追加 workspaceId 绑定与 nonce 一次性消费要求」的消息未传达到后端，属协作断链而非需求；交付总监已两次直接向后端重发裁决 A 的完整指令并撤回接口层字段追加。收口见变更 8 与附录 C.2；ADR 结论不变。

### C.2 授权实现的二次对账与裁决 A 收口

后端补齐的 `src/approval-gate.ts` 把 `ApprovalGrant` 定义为带 `grantId`、`runId`、`projectId`、`policyVersion`、`parameterDigest`、`issuedAtMs`、`expiresAtMs`、`nonce`、`consumedAtMs`、`revokedAtMs` 的记录（`:8-19`），`ApprovalGate` 五个方法是 `issue`、`consume`、`revoke`、`assertAllowed`、`active`（`:32-54`），六个稳定拒绝码是 `missing-grant`、`revoked`、`expired`、`consumed`、`mismatch`、`high-risk-requires-grant`（`:120-137,196-199`），摘要复用 `stableDigest`（`:80-86`），并新增 `ApprovalAuditEvent` 与可选 `onAudit` 回调（`:21-30,60-66`）。`src/tools.ts:112,200` 已把 `grantParameters(run, project.workspaceId)` 用于签发与校验（`src/policy.ts:12-21`），`workspace_id` 绑定由此成立，`ApprovalGrant` 接口不变。`package.json` 已无 `js-yaml`，变更 5 的落地已完成。

裁决前的差异事实（首次核查时点）：`src/approval-gate.ts:59` 声明「一次 grant 只授权一次高风险调用」，`assertAllowed()` 在 `:187-203` 经 `consumeInternal()` 把 `consumedAtMs` 写回（`:138-139`），`active()` 在 `:208` 过滤已消费 grant。该口径与 [ADR-011-resolution.md](ADR-011-resolution.md) 的「整次运行开始前批准整次运行」、[SPEC.md](SPEC.md) 第 13 节、`src/policy.ts:54-55` 的「The check never consumes the grant」以及 `README.md:40` 相反。核查时点 `assertAllowed`、`consume`、`revoke` 在 `src/` 内没有消费者，生效路径是 `src/policy.ts:84-90` 的 `active()` 加 `grants.find()`；`src/index.ts:47` 以无参调用 `createApprovalGate()`，`onAudit` 未接到 `store.appendAudit`；`nonce` 字段在 `:16,159` 生成后没有读取处。这些是裁决 A 排除前的状态，不是收口后的实现描述。

被否决的接线方式：把 `tools.ts` 改接 `assertAllowed({ args })` 会出现两处故障。`issue()` 的 `parameters` 是运行参数 `grantParameters(run, workspaceId)`（`src/tools.ts:112`），`assertAllowed()` 用浏览器调用 `args` 做摘要（`src/approval-gate.ts:200` 传 `call.args`），两者摘要必然不等，高风险调用全部落到 `mismatch`；worker 是 `ctx.subprocess` 子进程、没有 agent 与开启轮次，一次一消费之后无法补批准，整次运行的第二个高风险动作会被 `consumed` 拒绝。

收口结论：交付总监裁决 A，裁决 C 的保护对象限定为 Config 八项、十二个工具、原子 JSON 存储、函数插件形态、报告与监控链路，`assertAllowed` 不在保护范围；安全语义以冻结契约为准，[ADR-011-resolution.md](ADR-011-resolution.md) 结论不改。收口口径是 `nonce` 由 `consume()` 提供一次性 compare-and-mark、`assertAllowed` 为非消费式逐次校验、`consumed` 拒绝码只用于第二次 `consume` 而不用于第二次派发。`workspaceId` 不加 `ApprovalGrant` 独立字段。三处包级 tsc 编译修复（`src/tools.ts:150,279` 改 `async execute`、`src/observability.ts:47` 的 `policyVersion`）由交付总监在工程侧承担，不指派给后端或架构师。本记录据此收口，[SPEC.md](SPEC.md) 与 [ADR-011-resolution.md](ADR-011-resolution.md) 的结论未改动。

### D. README 与 DETAIL 的重定向措辞

`README.md:26,76`、`README.zh.md:26,76`、`docs/DETAIL.md:13`、`docs/DETAIL.zh.md:13` 四处的口径一致：允许列表由 TestPilot 逐跳检查重定向，上游 allowed-origins 选项不覆盖重定向，在重定向测试记录观察行为之前两者都不构成安全边界，attach 守卫拒绝私有主机与云元数据地址。DETAIL 两处还写明「授权永不变成永久许可」。结论：措辞已符合裁决 3，无需改动；SPEC §12 按同一口径修正。另有两处文档差异：`docs/DETAIL.md:9` 与 `docs/DETAIL.zh.md:9` 提到 `testpilot_gate_get`，该工具不在 `src/tools.ts` 的十二个注册项内，属于文档措辞差异，登记不改代码。

### E. package.json 依赖（`package.json:39-63`，已核实）

`dependencies` 只有 `@deepseek-ai/schemastery`；`peerDependencies` 是 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-tools`；`devDependencies` 已无 `js-yaml`。阶段 0 冻结的八个工作区依赖见 `package-release-audit.zh.md:144`，「阶段 1 不新增任何第三方依赖」见 `:146`。结论：裁决 5 决定移除 `js-yaml` 等新增第三方、组合测试改用纯文本断言，核查时点该移除已落地，冻结规则保持成立；本记录不重跑门禁。

### F. 源文件与测试清单

骨架 `src/` 十三个文件：`types.ts`、`domain.ts`、`config.ts`、`snapshot-registry.ts`、`locator-validator.ts`、`store.ts`、`observability.ts`、`quality-gate.ts`、`retention.ts`、`reporting.ts`、`policy.ts`、`tools.ts`、`index.ts`。冻结清单八个：`domain.ts`、`snapshot-registry.ts`、`locator-validator.ts`、`risk.ts`、`approval-gate.ts`、`origin-allowlist.ts`、`attach-guard.ts`、`evidence.ts`，交集三个。冻结清单里首次核查时点未出现的五个（`risk.ts`、`approval-gate.ts`、`origin-allowlist.ts`、`attach-guard.ts`、`evidence.ts`）都被 `src/index.ts:11-12,20-22` 与 `src/policy.ts:4-7` 引用，后端随后补齐。骨架额外文件对应裁决 C 保留的发布与查监控链路：`store.ts`、`observability.ts`、`quality-gate.ts`、`reporting.ts`、`retention.ts`、`policy.ts`、`tools.ts`、`index.ts`、`config.ts`、`types.ts`。测试方面骨架有 `tests/domain.spec.ts`、`tests/store.spec.ts`、`tests/snapshot-locator.spec.ts`，冻结清单的 `tests/origin-allowlist.spec.ts` 首次核查时点未出现。结论：以骨架实际构成为准，冻结八项保留为阶段 0 边界依据，差异登记不改代码。

### G. 持久化形态

`src/store.ts:44-88` 的 `createFileAdapter()` 写唯一临时文件再 `rename`，`src/store.ts:121-141` 按 `projects` / `runs` / `gates` / `evidence` / `audit` / `reports` 分键空间。`README.md:74`、`README.zh.md:74` 自认「记录使用 `dataDir` 下的原子 JSON 存储，而非 `dsh-storage` 域」，把双域迁移与 `upgradeRunRecord` 的一次性 v1 到 v2 步骤归到阶段 2。结论：裁决 C 的连带修正已把 SPEC §5 改成阶段 1 原子 JSON、阶段 2 双域目标，RPO/RTO 按变更 4 收口。

### H. 插件形态

`src/index.ts:24-36` 导出 `name = 'testpilot'`、`inject = ['tools']` 与 `apply(ctx, config)`，没有 default export，没有 `declare module '@deepseek-ai/cordis'` 的 Context 增强；`README.md:38`、`README.zh.md:38` 写明「具名导出的函数插件」。结论：`ctx.testpilot` 在阶段 1 实现中不存在，SPEC §3 已改为阶段 1 事实，单数 Service 键的命名论证移入阶段 2 候选。

### I. 报告、门禁与指标实现

`src/reporting.ts` 的 `renderAllReports()` 生产四种格式，`src/quality-gate.ts` 的 `DEFAULT_THRESHOLDS`、`evaluateQualityGate()`、`gateExitCode()` 支撑确定性门禁，`src/observability.ts` 的 `METRIC_DEFINITIONS`、`deriveRates()`、`percentile()` 支撑 `testpilot_metrics`，`src/types.ts:125-153` 定义 `MetricSnapshot` 与 `HealthStatus`，`src/retention.ts` 的 `purgeExpiredRuns` 执行保留。SPEC §8、§9、§10、§14 的字段名是冻结时的设计推断。结论：格式契约、门禁断言与能力缝三角闭合保留，实现符号以本附录为准，契约不凭空声称推断符号已存在。

## 证据约定

标注「已核实」的主张附本树文件路径与行号；「核查时点未在树中出现」只描述本次只读核查所见，不断言文件最终形态。本记录与 [SPEC.md](SPEC.md) 第 16 节、[阶段 0 的证据约定](../phase-0/README.zh.md#证据约定) 同源。未使用用户知识库（连接器不可用），技术判断以本树源码、阶段 0 审计与交付总监的裁决为准。
