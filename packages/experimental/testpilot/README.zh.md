---
description: "可选的 Web 质量平台 bundle：隔离证据、运行级授权、来源与连接策略、质量门禁、报告与健康指标。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-testpilot

[English](README.md) | 中文

## 概要

TestPilot 是一个可选 bundle，只贡献一行插件。它拥有测试项目、计划、运行、用例与结果，带版本的快照注册表，定位器校验器，风险分类，运行级授权闸门，来源与连接主机策略，证据引用，确定性质量门禁，四种报告格式与健康指标。已发布的 bundle 都不插入这一行，因此在加入该 bundle 之前，默认 profile 不含它的任何工具。

## 使用

```sh
dsh plugin --profile web add @deepseek-ai/dsh-testpilot
dsh --profile web --dump-config
```

patch 插入一行，id 为 `testpilot`。可以在 Plugins 页面或 profile 的 `cordis.patch.yml` 中启用、禁用或重配这一行；patch 会替换该行的整个 `config`。

| 配置 | 默认值 | 契约 |
| --- | --- | --- |
| `dataDir` | `''` | 持久存储根目录。空值选择 `<cwd>/.testpilot`。JSON 文档先写唯一临时文件再重命名落盘。 |
| `allowedOrigins` | `[]` | 浏览器可触达的来源。空数组拒绝一切导航（fail closed）。重定向由 TestPilot 逐跳检查。 |
| `policyVersion` | `'1'` | 写入运行与授权。变更会使旧策略下签发的授权失效。 |
| `approvalTtlMs` | `900000` | 单份运行级授权的有效期。 |
| `snapshotTtlMs` | `300000` | 单个快照引用的有效期。 |
| `workerPoolSize` | `2` | 有界的用例 worker 池大小。在 worker 池落地之前仅为声明。 |
| `retentionDays` | `30` | `purgeExpiredRuns` 使用的保留窗口。 |
| `metricsEnabled` | `true` | 采集计数器、结构化日志行与审计条目。 |

模型可见工具为 `testpilot_project_create`、`testpilot_project_list`、`testpilot_run_start`、`testpilot_run_get`、`testpilot_run_list`、`testpilot_snapshot_capture`、`testpilot_locator_check`、`testpilot_gate_evaluate`、`testpilot_report_get`、`testpilot_evidence_list`、`testpilot_metrics` 与 `testpilot_status`。长任务立即返回排队中的运行，进度通过 `testpilot_run_get` 读回。

## 实现结构

`src/types.ts` 只放类型。`src/domain.ts` 拥有身份、规范化摘要与只进不退的运行状态机。`src/snapshot-registry.ts` 与 `src/locator-validator.ts` 把引用绑定到存活快照与 agent 身份。`src/risk.ts`、`src/approval-gate.ts`、`src/origin-allowlist.ts` 与 `src/attach-guard.ts` 是不导入宿主的纯策略模块。`src/store.ts` 是持久化边界；`src/observability.ts`、`src/quality-gate.ts`、`src/reporting.ts` 与 `src/retention.ts` 是领域记录的纯消费者。`src/index.ts` 是唯一导入 Cordis 与工具注册表的模块，且是具名导出的函数插件，没有 default export。

授权模型解决 [ADR-011](../../docs/testpilot/phase-0/architecture-decisions.zh.md#adr-011--approval-credentials-and-high-risk-operations)：授权在运行开始时签发，绑定 `runId`、`projectId`、`policyVersion` 与参数 SHA-256 摘要，会过期、在结算时撤销、不可重放。worker 是 `ctx.subprocess` 子进程，不需要 agent 轮次。

## Model Experience

### 工具 schema

#### What the model sees

十二个 `testpilot_*` schema 从生成的[工具目录](../../docs/tool-catalog.md)进入 prompt 组装，每个都有简短的操作描述、带类型的参数，以及一个规范 JSON 字符串返回值。长任务立即返回 `{ "ok": true, "data": { "runId": "...", "status": "queued" } }`，不等待整个套件结束。

#### Token effect

条件性：只有启用 bundle 时这些 schema 才存在。每次调用贡献一个结果字符串；`testpilot_report_get` 可以返回整份报告，因此由调用方选择格式，报告存在运行之下而不是在历史里重复。

#### KV Cache effect

bundle 保持启用时为追加式：schema 块是稳定前缀，结果追加。启用、禁用 bundle 或变更 `policyVersion` 会替换该前缀，并使变更之前组装的请求无法复用。

### 门禁理由与证据缺失

#### What the model sees

`testpilot_gate_evaluate` 与 `testpilot_report_get` 逐条陈述 `warn` 或 `fail` 的理由，并在证据采集未成功时显式说明。任何报告都不把概率性的根因说成已确认事实。

#### Token effect

条件性：取决于运行是否被评估，并受用例结果与理由条数约束。

#### KV Cache effect

独立：每份报告都是新的请求结果，不改写较早的前缀。

## Known Limitations and Deferred Work

- **领域存储** —— 记录使用 `dataDir` 下的原子 JSON 存储，而非 `dsh-storage` 域。[ADR-007](../../docs/testpilot/phase-0/architecture-decisions.zh.md) 选定域形式；迁移到两个域（其中一个采用 `per-record`）属于阶段 2。`upgradeRunRecord` 提供当前存储所需的一次性 v1 到 v2 升级。
- **worker 与执行** —— 未交付浏览器 worker 池、Playwright 适配器、fixture 管理器、重试策略或探索器。`workerPoolSize` 只是声明。阶段 1 在审批决策确定之前刻意不实现它们。
- **来源边界** —— 白名单由 TestPilot 逐跳检查重定向，但上游提供方自带的 allowed-origins 选项不覆盖重定向；在重定向测试记录下实际行为之前，两者都不构成安全边界。连接守卫拒绝私有主机与云元数据地址。
- **证据** —— 二进制证据由 `EvidenceLink` 引用、不进入领域记录；外部附件存储与其配额在本阶段未接线。报告列出缺失的证据种类，而不暗示采集成功。
- **覆盖率与无障碍** —— 需求到测试的追踪只产生链接，不是代码覆盖率。未交付 axe 扫描、视觉基线或 flaky 检测。
- **治理** —— 没有 RBAC、远程流、客户端模块或 Web UI 卡片。审计条目在单次激活内只追加，重载后尚不持久。
- **运行时** —— 开发树运行 Node v22.22.2，而根清单声明 `>=24.9.0`；发布门禁必须在声明的运行时上重跑。
