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

## 门禁证据（Node 24.18.0，nvm4w 环境，2026-11-14 重跑）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 聚焦单测 | `vitest run packages/experimental/testpilot/tests` | **8 文件 / 70 用例全过** |
| 覆盖率门禁（CI 同款阈值） | `vitest run … --coverage --coverage.include='packages/experimental/testpilot/src/**'` | **per-file 100% / 100% / 100% / 100%**（statements/branches/functions/lines，零 ERROR；含 `src/types.ts` 按仓库惯例豁免） |
| 包级类型检查 | `tsc --noEmit -p packages/experimental/testpilot/tsconfig.json` | **EXIT=0** |
| 聚焦 lint | `tsx scripts/run-oxlint.ts packages/experimental/testpilot` | **0 warnings / 0 errors** |
| 仓库约束 | `pnpm run constraints` | **EXIT=0** |

Node 24.9+ 重跑要求已满足（本机 nvm4w 的 `C:\nvm4w\nodejs` = v24.18.0）。剩余仅 CI 拥有的信号：全仓覆盖率矩阵与平台矩阵（见 `docs/testing.md`）。

### 安装验证（2026-11-14，本地 bundle 安装链路打通）

未发布的包不能用 registry 名安装（`dsh plugin add @deepseek-ai/dsh-testpilot` 会 404）。正确路径是构建 + 打包 + 本地 tarball 安装：

1. **构建产物**：`tsc -b packages/experimental/testpilot` → 产出 `lib/types/`（JS+d.ts）；仓库 tsdown 配置（`--env.DSH_BUILD_FACE host --filter dsh-testpilot`）→ 产出 `lib/index.js`（60.6 kB bundle）。
2. **打包**：`pnpm pack` → `deepseek-ai-dsh-testpilot-0.2.2-rc.2.tgz`（74.95 kB），含 `lib/index.js` + `lib/types/**` + `locale/*.json` + `cordis.patch.yml` + `icon.svg` + `docs` + `src`。
3. **本地安装**：`dsh plugin --profile web add <绝对路径>/deepseek-ai-dsh-testpilot-0.2.2-rc.2.tgz` → **EXIT=0**，包进入 profile `node_modules`，并同时登记进 `package.json` 的 `dependencies`（`file:` 绝对路径 spec）与 `dsh.profile.bundles`。
4. **激活机制确认**：插件声明 `dsh.bundle.patch: "./cordis.patch.yml"`，plugin-manager 在 add 成功后将包的 patch 作为 overlay 加载；`dsh.profile.bundles` 含该包后，宿主启动时 compose 其 `insert` 条目（`id: testpilot` / `name: '@deepseek-ai/dsh-testpilot'` / 8 项 config）挂载插件，注册 12 个 `testpilot_*` 工具。兼容性检查通过（仅有 benign 的 peer-dep 告警，不影响加载）。

**注意**：当前是本地 `file:` 安装（仅本机可用、依赖磁盘上 tarball 存在）。正式「打包发布」仍需把包推到 registry（见 `RELEASE.md`），之后任意机器可 `dsh plugin --profile web add @deepseek-ai/dsh-testpilot` 安装。

### 本次重跑带出的三项实质修复（覆盖率门禁的真实产出）

1. **新增 `tests/tools-execution.spec.ts`**：真实 cordis `Context` + `ToolRuntime` + `NativeToolExecutor` 挂载插件，`executeToolFixture` 驱动 12 个工具的成功与全部拒绝路径（origin/attach/高风险无 grant/grant 无效/项目记录消失/审计写失败隔离/降级健康）。
2. **锁文件同步**：`pnpm-lock.yaml` 此前**从未包含 testpilot importer**（每次安装被沙箱网络阻断）——CI `--frozen-lockfile` 本会失败。经 npmmirror 镜像源完成 `pnpm install --lockfile-only`，diff 纯新增 67 行（importer + 根链接），真实 install 亦完成依赖链接。
3. **lint 清零（40→0）**：含两个真实类型缺陷——`RiskVerdict`/`EvidenceRef` 在 spec 里从错误模块导入（tsc 不查 tests 故未暴露，type-aware lint 现场抓获）；另修 store.ts `parse<T>` 单用途泛型、async-无-await ×7、类型字面量分隔符等。

环境注意事项：
- vitest v8 覆盖采集在 git-bash（MSYS）下全量报 0%（对任何包复现，包括 CI 成熟的 tool-todo），**覆盖率命令必须走 PowerShell**；原生 `NODE_V8_COVERAGE` 在两个 shell 下均正常。
- `registry.npmjs.org` 在本机不可达，pnpm 需要 `--registry=https://registry.npmmirror.com`。
- `.git/dsh-lefthook-install.lock` 过期锁已按 lefthook 提示清除。

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
- 全仓覆盖率矩阵与平台矩阵为 CI 专属信号，本机只重跑了按包聚焦覆盖（阈值与 CI 相同）。

## 下一步（≤3 条）

1. **正式发布到 registry**：按 `RELEASE.md` 把包推到 `@deepseek-ai` 作用域（当前仅本地 `file:` 安装，非可分发）。推送前经用户明示授权生成 `pnpm pack --dry-run` 载荷清单复核。
2. 推送提交前按 `.agents/skills/dsh-pre-push-checks` 跑聚焦检查（build:artifacts + build:check 需另跑）。
3. 阶段 2 候选（worker 池、Playwright 适配器、dsh-storage 域迁移）按 SPEC 优先级另起。

## 安装验证结论（本次收尾）

- 本地 bundle 安装链路已打通：构建 → 打包 → `dsh plugin add <tarball>` → 注册进 `dependencies` + `dsh.profile.bundles` → 宿主启动时 compose overlay patch 挂载插件。
- 命令证据：`dsh plugin --profile web add …/deepseek-ai-dsh-testpilot-0.2.2-rc.2.tgz` EXIT=0；`dsh plugin --profile web list` 含 `@deepseek-ai/dsh-testpilot@0.2.2-rc.2`；profile `package.json` 第 159 行（依赖）与第 237 行（`dsh.profile.bundles`）均已登记。
- 下一步用户可重启 host 验证 12 个 `testpilot_*` 工具实际可用；需正式发布再推 registry。
