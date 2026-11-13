# TestPilot 阶段 0 — 测试基线

[English](testing-baseline.md) | 中文

本记录列出针对被审计树执行过的每一条命令及其观察结果。未执行的命令标记为 `NOT RUN`，未被覆盖的测试套件列为阶段 1 的缺口。

## 执行环境

| 事实 | 值 |
|---|---|
| 操作系统 | `win32 x64` |
| Node | `v22.22.2`（仓库声明 `>=24.9.0`） |
| pnpm | `11.28.5` |
| Vitest | `4.1.11` |
| Git commit | 无法确定；该树不含 `.git` 目录 |
| Chromium | 本地 Playwright 浏览器缓存中的 `chromium-1228` |

## 依赖恢复

该树到达时 `node_modules/.pnpm` 已填充，但顶层 `node_modules` 与 `node_modules/.bin` 为空，因此没有测试命令可以解析。

| 命令 | 退出码 | 结果 | 说明 |
|---|---|---|---|
| `pnpm install --offline --ignore-scripts --frozen-lockfile` | 0 | PASS | `resolved 1436, reused 1429, downloaded 0, added 1436`；无版本变化，无网络下载 |

使用 `--ignore-scripts` 是为了不运行由 `pnpm-workspace.yaml` 的 `allowBuilds` 管控的安装脚本。锁文件被冻结，因此依赖图就是已提交的那一份。

## 单元基线

一条命令运行了整个相关面：

```sh
node_modules/.bin/vitest run \
  packages/experimental/browser-use-playwright-mcp/tests/provider.spec.ts \
  packages/experimental/browser-use-runtime/tests/ \
  packages/mcp/mcp-client/tests/ \
  packages/interaction/user-approval/tests/ \
  packages/guard/timeout-policy/tests/ \
  packages/browser-use/browser-use/tests/
```

| 字段 | 值 |
|---|---|
| 开始 | `2026-11-13T11:09:11+08:00` |
| 结束 | `2026-11-13T11:09:21+08:00` |
| 退出码 | 0 |
| 测试文件 | 24 通过，0 失败 |
| 测试用例 | 290 通过，0 失败，0 跳过 |
| 耗时 | 8.60s |

| 套件 | 用例数 | 结果 |
|---|---|---|
| `packages/experimental/browser-use-playwright-mcp/tests/provider.spec.ts` | 3 | PASS |
| `packages/experimental/browser-use-runtime/tests/` | 41 | PASS |
| `packages/mcp/mcp-client/tests/` | 194 | PASS |
| `packages/interaction/user-approval/tests/` | 41 | PASS |
| `packages/guard/timeout-policy/tests/` | 12 | PASS |
| `packages/browser-use/browser-use/tests/` | 2 | PASS |

在覆盖 TestPilot 将要构建其上的能力的每个套件上，基线都是绿的。

## 上游浏览器基线

提供方的真实 Chromium 套件以 `DSH_BROWSER_EXECUTABLE` 为条件，缺少它时自跳过。本地 Playwright 浏览器缓存提供了一个 Chromium 构建，因此该套件运行而非跳过。

```sh
DSH_BROWSER_EXECUTABLE="C:/Users/hunan/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe" \
  node_modules/.bin/vitest run --config vitest.e2e.config.ts \
  packages/experimental/browser-use-playwright-mcp/tests/upstream.e2e.ts
```

| 字段 | 值 |
|---|---|
| 退出码 | 0 |
| 测试文件 | 1 通过 |
| 测试用例 | 2 通过 |
| 耗时 | 5.85s |

两个用例都在真实浏览器上通过：提供方启动 Chromium 并导航到 loopback 夹具页面；它也附加到外部启动的 Chromium 并通过调试端点导航到同一页面。该套件断言夹具观察到了请求、工具结果不是错误，并且工具 schema 在释放之后被移除。

## 既有套件已经证明的行为

| 行为 | 套件 |
|---|---|
| 提供方以预期参数启动固定 CLI，并清空环境中的 `PLAYWRIGHT_MCP_*` 变量 | `provider.spec.ts` |
| 畸形的 attach endpoint 在注册任何浏览器资源之前被拒绝 | `provider.spec.ts` |
| 第二次注册被拒绝，disposer 释放槽位 | `registry.spec.ts` |
| 并发获取产生一个资源，失败的获取被释放给另一个 session | `resources.spec.ts` |
| 一个 session 的操作被串行化而另一个继续进行，被取消的排队工作被跳过 | `resources.spec.ts` |
| 关闭失败保留独占所有权 | `resources.spec.ts` |
| 工具发现在首次模型请求之前完成 | `mcp.spec.ts` |
| 属于另一 session 的浏览器工具被拒绝，继承的浏览器指令被扣留 | `mcp.spec.ts` |
| 发现期间的取消会关闭进程并释放附加 | `mcp.spec.ts` |
| 失败的发现会回滚，卸载中断会停止子进程 | `mcp.spec.ts` |
| 已释放的 agent 在 agent 到达空闲之前释放其浏览器 | `agent-disposal.spec.ts` |
| MCP client 跨连接世代注册、注销并重新同步工具 | `mcp-client.spec.ts`、`generation.spec.ts` |
| MCP client 的工具名称带命名空间，其结果被规范化 | `tool-definition.spec.ts`、`protocol.spec.ts` |
| 开启轮次之外的审批请求在追加任何内容之前被拒绝 | `approval.spec.ts` |
| 缺失的应答者失败关闭为 `unavailable`，且审计对被写入 | `approval.spec.ts` |
| 策略 `never` 确定性地拒绝 | `approval.spec.ts` |
| 声明超时的工具被替换为 `TOOL_TIMEOUT` 结果 | `timeout-policy.spec.ts` |

## 阶段 1 必须补齐的缺口

| 缺口 | 为何重要 |
|---|---|
| 没有测试覆盖浏览器出口处的域名白名单 | 强制位置已知，但行为未经验证 |
| 没有测试覆盖跨向被允许来源的重定向 | 上游所有者声明该选项不作用于重定向 |
| 没有测试覆盖指向非预期主机的 attach endpoint | 当前校验接受任何主机 |
| 没有测试覆盖需要审批的 MCP 工具调用 | 审批路径与浏览器路径尚未接通 |
| 没有测试覆盖测试运行比启动它的 agent 活得更久 | 存储域的选择尚未被验证 |
| 没有测试覆盖快照注册表的版本或 TTL 行为 | 该能力尚不存在 |
| 没有测试覆盖被拒绝的失效定位器 | 该能力尚不存在 |
| 没有测试覆盖 worker 崩溃后的恢复 | 该能力尚不存在 |

## 未运行的命令

| 命令 | 状态 | 原因 |
|---|---|---|
| `pnpm run test` | NOT RUN | 完整仓库套件；基线被限定在被审计的能力范围内 |
| `pnpm run test:coverage` | NOT RUN | CI 覆盖率门禁；阶段 1 必须为新包满足它 |
| `pnpm run typecheck` | NOT RUN | 没有改动源码 |
| `pnpm run lint` | NOT RUN | 没有改动源码 |
| `pnpm run build` | NOT RUN | 没有改动源码 |
| `pnpm run doc-sync` | NOT RUN | 在文档写完后运行；其结果报告在验收文档中 |
| `pnpm run constraints` | NOT RUN | 它在新增包之后运行 |
| `pnpm run test:expected`、`test:snapshot`、`test:web` | NOT RUN | 无关的界面 |

Node 版本缺口意味着阶段 1 必须在 Node 24.9 或更高版本上重跑基线，之后才能将其视为发布门禁。

## 延伸阅读

- [浏览器提供方审计](browser-provider-audit.zh.md) — 通过的套件背后的代码。
- [执行隔离审计](execution-isolation-audit.zh.md) — 基线未覆盖的缺口。
- [阶段 0 验收](phase-0-acceptance.zh.md) — 本基线支撑的验收标准。
