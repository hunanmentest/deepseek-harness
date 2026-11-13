# TestPilot 阶段 1 — 查监控

本文给出 TestPilot 查监控的入口、三平面字段、指标口径、本地记录路径、告警建议与事故响应最小步骤。指标名与公式以 `src/observability.ts` 的 `METRIC_DEFINITIONS`、`deriveRates()`、`percentile()` 和 `src/types.ts:125-153` 的 `MetricSnapshot` 与 `HealthStatus` 为准；[SPEC.md](SPEC.md) 第 8 节那组 Prometheus 风格指标名是冻结时的设计推断，本文不照抄，差异见 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录 I。发布门禁与环境限制见 [RELEASE.md](RELEASE.md)。

## 能力归属

下表先分清「插件自带」「需要宿主或外部系统」「阶段 1 不提供」三类，不把计划写成已提供的能力。

| 平面 | 插件自带 | 宿主／外部系统 | 阶段 1 不提供 |
| --- | --- | --- | --- |
| 日志 | 进程内结构化 `LogLine` 数组，上限 1000 行（`src/observability.ts:82-87`）；`testpilot_status` 返回 `logs` 计数 | 日志持久化、检索、脱敏审计；启动诊断日志落在 `$DSH_HOME/logs/startup-<timestamp>-<uuid>.log`（`apps/cli/reference/README.zh.md:77`），只在必需插件激活失败时生成且不脱敏 | `*.log` 落盘、跨进程 `traceId` 透传、采样、日志留存不少于 6 个月 |
| 指标 | `MetricSnapshot` 的计数器与 `durationsMs`、`METRIC_DEFINITIONS` 七项定义、`deriveRates()` 五项比率、`percentile(95)` 的 `runDurationP95Ms`；入口是 `testpilot_metrics` | 指标持久化、Prometheus／Grafana、看板、告警通道与静默窗口 | Prometheus 风格指标名、exporter、`gateDurationP95Ms` 的分位返回值、worker 崩溃率、flaky 比例 |
| 审计 | `AuditEntry` 追加到本次激活实例的内存数组，没有按 id 更新或删除审计的工具入参（`src/observability.ts:89-99`、`src/tools.ts:71,117,203-207`）；`testpilot_status` 返回 `auditEntries` 计数 | 跨重启审计对账、审批服务自身的 session 日志 | 审计落盘：`TestPilotStore.appendAudit()`／`listAudit()` 存在，十二个工具没有接通，`README.zh.md:79` 自认重载后不持久 |
| 健康检查 | `testpilot_status` 的 `HealthStatus`（`src/types.ts:141-153`）；`store.ready()` | Loader 的启动诊断与必需插件失败报告 | HTTP `/health` 端点（`apps/` 内未找到 `health`／`healthz`／`healthcheck` 路由，待核实）、容器编排探针 |
| 报告与门禁 | `testpilot_gate_evaluate`、`testpilot_report_get`、`testpilot_evidence_list`、`testpilot_run_get`；四种报告落在 `dataDir` 的 `reports/` 键空间 | CI 消费 JUnit、客户端渲染 HTML | 远程流、Web UI 卡片、失败分析（[SPEC.md](SPEC.md) 第 10 节） |
| 告警 | 无 | 阈值判定、收敛、通知、值班表 | `alerts.yml`／alertmanager／oncall 配置（全树检索未找到，待核实） |

## 三平面

### 结构化日志

`LogLine`（`src/observability.ts:13-23`）的字段固定为九个，写入时由 `observability.log()` 补 `ts` 与 `detail` 截断。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ts` | number | `Date.now()`（`src/observability.ts:83`） |
| `level` | `debug`／`info`／`warn`／`error` | `LogLevel`（`:11`）；`src/tools.ts:210` 的 `policy.decision` 按放行与否写 `info` 或 `warn` |
| `event` | string | 事件名，例如 `policy.decision` |
| `correlationId` | string | 承担关联 id，由 `src/domain.ts` 的 `correlationId()` 生成 |
| `runId` | string／null | 任务口径里的 `runcId` 在骨架里叫 `runId` |
| `caseId` | string／null | 逐用例标识 |
| `policyVersion` | string | Config 的 `policyVersion` |
| `durationMs` | number／null | 耗时；`src/tools.ts:210` 写 `null` |
| `detail` | string | 换行折叠、截断到 512 字符（`src/observability.ts:83`） |

`evidenceRef` 不是日志字段；证据引用落在 `EvidenceLink`（`src/types.ts`）与 `dataDir` 的 `evidence/` 键空间，由 `testpilot_evidence_list` 与四种报告列出（`src/store.ts:129-130`）。`workspace_id`、`project_id`、`trace_id` 不在 `LogLine` 里，[SPEC.md](SPEC.md) 第 8 节列出的那组字段名是冻结时的设计推断。采集口径按 [SPEC.md](SPEC.md) 第 1 节与第 8 节：`nonce` 原值、凭据、cookie、token、完整请求体不进日志，日志不写 session 对话历史，脱敏口径是字段白名单而不是事后过滤。`observability.log()` 本身不做值级过滤，`detail` 由调用方给字符串，`src/tools.ts:210` 只写 `decision.reason`；新增日志点时由调用方保证不把敏感值放进 `detail`。日志没有落盘文件，进程结束即消失。

### Metrics

计数器与保留的日志行属于一次激活实例（`src/observability.ts:46`）；`metricsEnabled: false` 时 `record()` 直接返回（`:60`），`testpilot_status.health.reasons` 给出 `metrics collection is disabled`（`src/tools.ts:296`），不静默降级。`MetricSnapshot`（`src/types.ts:125-139`）字段为 `atMs`、`runsStarted`、`runsCompleted`、`runsFailed`、`casesTotal`、`casesFailed`、`evidenceCollected`、`evidenceMissing`、`approvalDenials`、`originDenials`、`gateEvaluations`、`gateDurationMsTotal`、`durationsMs`。`MetricEvent`（`src/observability.ts:6-9`）共十二个计数器：`run_started`、`run_completed`、`run_failed`、`case_total`、`case_failed`、`evidence_collected`、`evidence_missing`、`approval_denied`、`origin_denied`、`gate_evaluated`、`duration`、`gate_duration`。

`METRIC_DEFINITIONS`（`src/observability.ts:36-44`）给出七项原文定义：`runSuccessRate`、`evidenceRate`、`caseFailureRate`、`gateDurationP95Ms`、`runDurationP95Ms`、`approvalDenialRate`、`originDenialRate`。`deriveRates()`（`:110-120`）只返回五项比率，`testpilot_metrics` 另返回 `runDurationP95Ms` 与 `definitions`。

| 查什么 | 实现口径 | 公式／来源 | 状态 |
| --- | --- | --- | --- |
| test run 成功率 | `runSuccessRate` | `runsCompleted / (runsCompleted + runsFailed)`，没有结算运行时为 0（`deriveRates()`） | 自带 |
| worker 崩溃率 | 无 | 阶段 1 不交付 worker 池，`workerPoolSize` 只是声明（`packages/experimental/testpilot/README.zh.md:75`） | 不提供 |
| flaky 比例 | 无 | 包 README 的 Known Limitations 记录未交付 flaky 检测（`README.zh.md:78`） | 不提供 |
| P95 耗时 | `runDurationP95Ms` | `percentile(95)` 对 `durations` 排序取 `ceil(p/100 * n) - 1` 位，空样本返回 0（`src/observability.ts:100-105`） | 自带 |
| 失败证据采集成功率 | `evidenceRate` | `evidenceCollected / (evidenceCollected + evidenceMissing)`，无请求时为 0；`evidence_missing` 在 `testpilot_gate_evaluate` 中于证据为空时埋点（`src/tools.ts:239`）；`testpilot_evidence_list` 列出 `missing` 的四类 | 自带 |
| 质量门禁耗时 | `gateDurationMsTotal` 与 `gateEvaluations` | `gate_duration` 在 `testpilot_gate_evaluate` 中埋点（`src/tools.ts:238`），两者相除得平均耗时。`METRIC_DEFINITIONS` 有 `gateDurationP95Ms` 定义，`testpilot_metrics` 不返回该分位数，`gateDurations` 数组不被 `percentile()` 读取 | 定义存在、分位口径未接通 |
| 审批拒绝数 | `approvalDenials`／`approvalDenialRate` | `approvalDenials / runsStarted`；`approval_denied` 在 grant 类拒绝与 attach 拒绝时埋点（`src/tools.ts:208-209`） | 自带，口径见下 |
| 白名单拒绝数 | `originDenials`／`originDenialRate` | `originDenials / runsStarted`；`origin_denied` 只在 `decision.code === 'origin-denied'` 时埋点（`src/tools.ts:208`） | 自带，口径见下 |

两处口径必须写明：`src/tools.ts:208` 把 `attach-denied` 计入 `approval_denied` 而不是 `origin_denied`，`approvalDenials` 因此混有 attach 主机拒绝，当作纯审批拒绝数会高估，对账时回读 `--dump-config` 的 `allowedOrigins` 与 `policyVersion`。`src/` 全包检索到的 `observability.record()` 调用只有 `src/tools.ts:116,208-209,237-239` 六处，`run_completed`、`run_failed`、`case_total`、`case_failed`、`evidence_collected`、`duration` 六个计数器没有埋点，恒为 0；`deriveRates()` 在分母为 0 时返回 0（`:114-118`），0 表示未采集，不表示达标。本节只给定义与公式，不给已达成数值；数值以现场调用 `testpilot_metrics` 的输出为准。

### 审计

`AuditEntry`（`src/types.ts:115-123`）字段为 `id`、`atMs`、`actor`、`action`、`outcome`（`allowed` 或 `denied`）、`correlationId`、`detail`。`observability.audit()` 追加到本次激活实例的内存数组，`id` 由 `newId('audit')` 生成，`detail` 换行折叠并截断到 512 字符（`src/observability.ts:89-99`）。十二个工具都不接收审计 id 作为入参，没有按 id 更新或删除审计的工具，因此审计不由 agent 修改。写入点记录 `project.create`、`run.start` 与 `action.<tool>` 的放行／拒绝，`detail` 是决策理由（`src/tools.ts:71,117,203-207`）。排除 `nonce` 原值、凭据、cookie、token、完整请求体与 session 对话历史；审批服务自身的 `approval/asked` 与 `approval/decided` 留在启动 session 的日志，TestPilot 审计不承接它们（[SPEC.md](SPEC.md) 第 8 节、`packages/interaction/user-approval/src/index.ts:252-259`）。`TestPilotStore` 提供 `appendAudit()` 与 `listAudit()` 写 `audit/<id>.json`（`src/store.ts:30-31,131-132`），阶段 1 的十二个工具没有调用它们；`testpilot_status` 报的 `auditEntries` 是内存 `auditTrail().length`，`packages/experimental/testpilot/README.zh.md:79` 自认审计条目在单次激活内只追加、重载后不持久。跨重启审计对账不提供。

## 查监控的路径

### 在 Harness 对话里

`testpilot_status` 返回 `HealthStatus` 与 `{ projects, logs, auditEntries }`（`src/tools.ts:285-311`）。`ok` 为 `reasons.length === 0`；`reasons` 显式给出 `origin allowlist is empty: every navigation is refused` 与 `metrics collection is disabled`（`:295-296`）；`storeReady` 来自 `await store.ready()`，`activeRuns` 数 `queued` 与 `running`，`activeGrants` 来自 `approvals.active()`，`snapshots` 来自 `snapshots.size()`，`configDigest` 与 `policyVersion` 用于比对升级前后配置。`HealthStatus` 的字段是 `ok`、`plugin`、`policyVersion`、`configDigest`、`dataDir`、`storeReady`、`activeRuns`、`activeGrants`、`snapshots`、`checkedAtMs`、`reasons`（`src/types.ts:141-153`）。

`testpilot_metrics` 返回 `{ snapshot, rates, runDurationP95Ms, definitions }`（`src/tools.ts:275-283`），`definitions` 是 `METRIC_DEFINITIONS` 的原文，查口径不必另找文档。

质量门禁结论由 `testpilot_gate_evaluate` 给出 `{ gate, exitCode, formats }`：`gate.verdict` 取 `pass`／`warn`／`fail`，`gate.reasons` 逐条给出产生结论的理由（`src/quality-gate.ts:19-57`），`gateExitCode()` 返回 0 或 1（`:60-65`）。`testpilot_report_get` 读 JSON、JUnit、HTML 或 Markdown；JSON 报告带 `evidenceMissing` 布尔（`src/reporting.ts:37`），JUnit 的 `<testsuites>` 带 `tests` 与 `failures`、`<failure>` 承载失败分类（`src/reporting.ts:43-54`），HTML 与 Markdown 在证据为空时写 `Evidence collection did not succeed; this report does not claim otherwise.`（`src/reporting.ts:63,98`）。`testpilot_evidence_list` 列出 `missing` 的 `screenshot`、`console`、`network`、`trace`（`src/tools.ts:268-270`）；`testpilot_run_get` 读持久化运行及其逐用例结果。报告不把概率性根因说成已确认事实（`packages/experimental/testpilot/README.zh.md:62`）。

### 在本地

`dataDir` 为空时解析到 `<cwd>/.testpilot`（`src/config.ts:39-41`）；实际根目录从 `testpilot_status.health.dataDir` 读，或从 `dsh --profile <name> --dump-config` 的 `id: testpilot` 行 `config.dataDir` 读。键空间是 `projects/`、`runs/`、`gates/`、`evidence/`、`audit/`、`reports/`，每条记录为 `<prefix>/<id>.json`，报告键为 `reports/<runId>_<format>.json`，四种格式 `json`／`junit`／`html`／`markdown`（`src/store.ts:121-141`）；写入先落 `<target>.<uuid>.tmp` 再 `rename`（`src/store.ts:61-73`）。

结构化日志没有落盘文件，`observability.logs()` 的 1000 行上限只在进程内。启动诊断日志位于 `$DSH_HOME/logs/startup-<timestamp>-<uuid>.log`，只在必需插件激活失败时生成，含 DSH 与 Node 版本、平台、profile、每个未激活插件的模块与状态、原始错误，不脱敏，分享前检查内容（`apps/cli/reference/README.zh.md:74-81`）。组合层来源用 `dsh --profile <name> --dump-config` 与 `--dump-default-config` 查（同文件 `:48-60`）。仓库侧门禁结论从 `pnpm run ...` 的 stdout 与退出码读，`scripts/run-gates.ts` 不写报告文件，`coverage/` 是 Vitest 产物且被 `.gitignore` 忽略。

### 三条最短入口

| 入口 | 一次调用／一条命令 | 读到什么 |
| --- | --- | --- |
| 1 | 在 Harness 对话里调用 `testpilot_status` | 健康、配置摘要、存活授权、快照、活跃运行、采集关闭理由、实际 `dataDir` |
| 2 | 在 Harness 对话里调用 `testpilot_metrics` | 十二个计数器、五项比率、`runDurationP95Ms`、每项指标的原文定义 |
| 3 | 本地 `dsh --profile <name> --dump-config`，再读 `dataDir` 下 `reports/<runId>_json.json` | 层来源与八项 `config`、门禁 `verdict` 与 `reasons`、`evidenceMissing` |

## 证据缺失的显式标注

- `deriveRates()` 在分母为 0 时返回 0（`src/observability.ts:110-120`）；读比率必须同时读 `snapshot` 的分母，0 标为「未采集」而不是「达标」。
- `METRIC_DEFINITIONS` 有 `gateDurationP95Ms` 定义，`testpilot_metrics` 不返回该值；标注「定义存在、分位口径未接通」，不拿 `gateDurationMsTotal / gateEvaluations` 冒充 P95。
- `run_completed`、`run_failed`、`case_total`、`case_failed`、`evidence_collected`、`duration` 在 `src/tools.ts` 内无埋点，对应计数器恒为 0；标注「未采集」。
- `testpilot_gate_evaluate` 在证据为空时记 `evidence_missing`（`src/tools.ts:239`），`testpilot_evidence_list` 的 `missing` 点名未采集种类；报告写 `evidenceMissing: true` 与「采集未成功」文案，不暗示采集成功。
- `metricsEnabled: false` 时 `record()` 不计数，`testpilot_status.health.reasons` 含 `metrics collection is disabled`，`ok` 因此为 false；不静默降级。
- `attach-denied` 计入 `approval_denied`（`src/tools.ts:208`），`approvalDenialRate` 混有 attach 主机拒绝，对账时回读 `allowedOrigins` 与 `--dump-config`。
- 不把 [SPEC.md](SPEC.md) 第 8 节的 Prometheus 风格指标名写成已提供的指标；差异以 [CONTRACT-CHANGES.md](CONTRACT-CHANGES.md) 附录 I 为准。

## 告警阈值建议与升级路径

本树没有 `alerts.yml`、alertmanager 与 oncall 配置（全树检索未找到，待核实）。下列阈值是建议，不是已配置的规则；只按用户受影响的症状设定，每条都必须写得出收到后的动作，落地由宿主／外部系统承担。不编造已达成数值，基线值需现场取。

| 建议告警 | 触发条件（读自） | 级别 | 收到后做什么 |
| --- | --- | --- | --- |
| 插件不可用 | `testpilot_status.health.ok === false` 或 `storeReady === false` 连续 3 次 | P1 | 停写入、备份 `dataDir`、按 [RELEASE.md](RELEASE.md) 的恢复步骤重启并等待 `store.ready()` |
| 运行成功率下降 | `runSuccessRate < 0.95` 且 `runsCompleted + runsFailed >= 20`，小样本不判 | P1 | 读 `testpilot_gate_evaluate` 的 `gate.reasons` 与 JUnit 的 `failures` |
| 门禁失败 | `gate.verdict === 'fail'`，`exitCode === 1` | P1 | 读四种报告；刚发版后异常立即回滚，不先看代码 |
| 证据缺失 | `evidenceRate < 1` 或 `testpilot_evidence_list.missing` 非空 | P2 | 读 `evidence/` 键空间，报告标注缺失，不补写成功 |
| 策略拒绝突增 | `approvalDenialRate` 或 `originDenialRate` 相对现场基线突增 | P2 | 用 `--dump-config` 核对 `policyVersion` 与 `allowedOrigins` 是否刚改，注意 `attach-denied` 混入口径 |
| 采集被关闭 | `metricsEnabled: false`，`health.reasons` 含 `metrics collection is disabled` | P2 | 确认是否为部署有意为之，否则恢复 `metricsEnabled: true` 并重启 profile |
| 延迟劣化 | `runDurationP95Ms` 连续 3 次超过现场基线 | P2 | 读 `durationsMs` 样本与 `dataDir` 记录；阶段 1 没有 worker 驱动，不按 worker 崩溃处置 |
| 数据不可恢复 | 记录大面积失效、版本被拒、`dataDir` 损坏 | P0 | 立即按恢复步骤止损，全员与负责人通报 |

分级与响应时限取自 `references/70-delivery/incident-response.md`：P0 为 5 分钟内有人并通报全员与负责人，P1 为 15 分钟并通报团队与负责人，P2 为 1 小时并通报团队，P3 为次工作日、记录即可；判级就高不就低，事后可下调。同一根因只发一条，配静默窗口；写不出处置动作的告警删掉（`references/70-delivery/observability.md` 的按症状告警与最小告警集）。值班表与联系人本树未给出（待核实），交付时填入真实 owner 与联系方式，不写占位。

## 保留期与删除流程

`retentionDays` 默认 30 天（`src/config.ts:34`）；`purgeExpiredRuns()` 按 `finishedAtMs ?? updatedAtMs <= nowMs - retentionDays * 86_400_000` 调 `store.deleteRun()`（`src/retention.ts:14-29`）。`store.deleteRun()` 移除 `runs/<id>`、`gates/<id>` 与 `reports/<id>_{json,junit,html,markdown}`（`src/store.ts:135-141`），`evidence/` 与 `audit/` 键不受影响；[SPEC.md](SPEC.md) 第 11 节的逐层墓碑记录属设计推断，阶段 1 骨架不写墓碑。`purgeExpiredRuns` 在 `src/` 内只有定义、没有调用点，十二个工具没有触发保留清理的入口（待核实：包外脚本是否调用）；清理由部署维护者在本地脚本里调用。删除流程：停写入 → 备份 `dataDir` → 运行清理 → 核对 `runs/` 记录数 → 重启并等待 `store.ready()` → 用 `testpilot_status` 确认 `storeReady: true`。网络日志留存不少于 6 个月与删除全链路由宿主／外部系统承担；TestPilot 阶段 1 不采集网络日志、不提供日志留存（`packages/experimental/testpilot/README.zh.md:79`）。

## 事故响应最小步骤

七步按顺序，不跳步（`references/70-delivery/incident-response.md`）：确认影响面 → 通报并指定 IC 指挥、操作者、记录者 → 止损 → 定位 → 最小改动修复 → 验证 → 收尾记录时间线并约复盘。止损优先于定位；刚发版后异常立即回滚，止损阶段不做重构、不查根因。

| 症状 | 确认 | 止血 | 升级 | owner |
| --- | --- | --- | --- | --- |
| 组合里没有 `testpilot` 行或十二个工具 | `dsh --profile <name> --dump-config` 无 `# == @deepseek-ai/dsh-testpilot` 层 | `dsh plugin --profile <name> add @deepseek-ai/dsh-testpilot` 后重启 profile（`apps/cli/reference/README.zh.md:99`） | 重启后仍缺失升 P1 | 部署维护者，姓名与联系方式交付时填入 |
| `storeReady: false` 或写入抛错 | `testpilot_status.health.storeReady`；`dataDir` 下 `<prefix>/<id>.json` 与 `.<uuid>.tmp` 残留 | 停写入、备份 `dataDir`、核对目录权限与磁盘、清理临时文件、重启等待 `store.ready()` | 记录版本被拒或引用大面积失效升 P0 | 部署维护者 |
| 授权／白名单拒绝暴涨 | `testpilot_metrics` 的 `approvalDenials`／`originDenials`；`--dump-config` 的 `policyVersion`／`allowedOrigins` | 回滚配置到上一份 profile patch，重启 profile | 伴随高风险调用被拒升 P1 | 部署维护者 |
| 报告证据缺失 | `testpilot_evidence_list.missing`；JSON 报告 `evidenceMissing: true` | 显式标注未采集，不补写成功；读 `evidence/` 键空间 | 门禁因此 `warn` 升 P2 | 部署维护者 |
| 记录版本被拒绝 | `assertRunVersion()` 的 `future-version`／`incompatible-version`（`src/retention.ts:35-45`） | 停写入、备份、按 `upgradeRunRecord()` 一次性重放、重启、核对记录数与证据引用可解析率 | 重放失败升 P0 | 部署维护者 |
| 采集静默 | `testpilot_status.health.ok === false` 且 `reasons` 含 `metrics collection is disabled` | 恢复 `metricsEnabled: true` 并重启 profile | 恢复后仍无计数升 P2 | 部署维护者 |

验证走一遍核心流程：`testpilot_status.health.ok === true` → `testpilot_gate_evaluate` 生成四种报告 → `testpilot_report_get` 逐格式读回 → `testpilot_metrics` 的 `snapshot` 变化。收尾写时间线、根因与行动项表，行动项带负责人、截止与验收标准；复盘对事不对人，结论落到机制而不是「下次注意」。

## 引用与未核实项

知识库基线只用了两篇：`references/70-delivery/observability.md`（结构化日志、按症状告警、最小告警集、最小看板）与 `references/70-delivery/incident-response.md`（P0–P3 分级、止损优先、Runbook、复盘模板）。待核实项：`alerts.yml`／alertmanager／oncall 配置、HTTP `/health` 端点、包外是否调用 `purgeExpiredRuns`、值班表与联系人。本文只记录当前树可读到的入口与字段，数值以 Node 24.9+ 上实际调用 `testpilot_metrics` 的输出为准（[RELEASE.md](RELEASE.md) 的环境限制）。
