# TestPilot 项目状态

阶段：Phase 1（可发布的 bundle 插件）——**代码与文档已完成，门禁证据已采集**。上一阶段 Phase 0 是只读源码审计，14 份审计文档与 ADR-001~014 已提交；验收未通过的两项阻塞已由 ADR-011 解除记录与逐跳重定向检查关闭。

## 已完成

- `docs/testpilot/phase-1/ADR-011-resolution.md` — 审批上下文决策：整次运行开始前批准，落成带过期时间的 run-scoped 授权记录。
- `docs/testpilot/phase-1/SPEC.md` — Phase 1 冻结契约，含 RPO/RTO 档位与阶段 2 候选。
- `docs/testpilot/phase-1/CONTRACT-CHANGES.md` — 契约变更记录与只读对账附录。
- `docs/testpilot/phase-1/RELEASE.md`、`MONITORING.md` — 发布门禁、载荷核对、安装升级、监控口径与事故响应。
- `packages/experimental/testpilot/` — 可发布 bundle：`package.json`、`tsconfig.json`、`cordis.patch.yml`、`icon.svg`、8 语言 `locale/*.json`、`docs/DETAIL*.md`、`README*.md`、`src/`（18 个模块）、`tests/`（7 个 spec）。
- 仓库级登记（4 处最小改动）：`scripts/experimental-package-policy.ts` 命名例外、`packages/experimental/README.md(.zh.md)` 包表、`tsconfig.host.json` 聚合引用、根 `package.json` devDependency。
- 审批审计接线（ADR-011 收口）：`src/index.ts` 把审批门的 `onAudit` 事件经 `approvalAuditRecord()` 映射进运行域审计——内存轨迹（`testpilot_status` 可见）+ 持久 `store.appendAudit`；持久写失败不阻塞决策。
- 组合测试 `tests/composition.spec.ts`：真实 cordis `Context` + `ToolRuntime` 上挂载/卸载插件，断言 12 个 `testpilot_*` 工具出现且卸载后消失；另含发布契约静态断言（manifest 公开性、patch 只插不改、8 语言 locale、icon、无 default export）。

## 门禁证据

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 聚焦单测 | `./node_modules/.bin/vitest run packages/experimental/testpilot/tests` | **7 文件 / 52 用例全过**（domain、store、snapshot-locator、reporting-gate、observability-retention、security、composition） |
| 包级类型检查 | `./node_modules/.bin/tsc --noEmit -p packages/experimental/testpilot/tsconfig.json` | **EXIT=0** |
| 仓库约束 | `pnpm run constraints` | **EXIT=0**（开发树 Node v22.22.2） |

已知告示：开发树 Node v22.22.2 / pnpm 11.28.5，根清单声明 `engines.node >=24.9.0`——**发布门禁（含 CI 覆盖率 per-file 100%）必须在 Node 24.9+ 环境重跑一次**后才算最终放行。

## 待决策

| 决策 | 推荐项 | 可推翻点 |
| --- | --- | --- |
| 领域存储 | 阶段 1 用 `dataDir` 原子 JSON，阶段 2 迁移到两个 `dsh-storage` 域（ADR-007） | 若要求立即与产品存储一致，需提前迁移并重写 `src/store.ts` |
| 发布渠道 | 保留 `@deepseek-ai/dsh-testpilot` 无前缀实验包、`publishConfig.access=public` | 若要独立仓库发布，需搬出 monorepo 并自建 workspace 门禁 |
| RPO/RTO | 单机原子 JSON：RPO=0，RTO=一次重启加 `store.ready()` | 多进程或远端部署需要跨进程锁与服务化存储 |

## 已知限制（诚实标注）

- 无 worker 池与 Playwright 适配器：`workerPoolSize` 为声明式配置，阶段 2 落地。
- 未接 `dsh-storage` 域：阶段 1 用自管原子 JSON 存储。
- 重定向逐跳检查已实现，但真实浏览器跳转链路的观察性测试未做（ADR-010 口径：上游 allowed-origins 不是安全边界）。
- CI per-file 100% 覆盖率门禁未在本机验证；Node 24.9+ 重跑时一并确认。

## 下一步（≤3 条）

1. 在 Node 24.9+ 环境重跑发布门禁（constraints、typecheck、lint、覆盖率 per-file 100%）。
2. 按 `RELEASE.md` 核对发布载荷，经用户明示授权后生成 `pnpm pack --dry-run` 载荷清单再决定是否发布。
3. 阶段 2 候选（worker 池、Playwright 适配器、dsh-storage 域迁移）按 SPEC 优先级另起。
