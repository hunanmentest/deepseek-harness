# TestPilot 阶段 0 — 执行隔离审计

[English](execution-isolation-audit.md) | 中文

本审计记录 TestPilot 运行浏览器时 harness 约束了什么，以及约束在哪里终止。方案要求测试 worker 能触达任意被测应用。下文每一条隔离边界都读自本仓库的源码；决定性的发现是关于什么缺席，而非关于什么存在。

## 进程 containment

本地 subprocess provider 每次启动时选取三档 containment 之一（`packages/subprocess/subprocess-local/src/index.ts:250`）。

| 档位 | 平台 | 机制 | 证据 |
|---|---|---|---|
| `linux-scope` | Linux | 一个 user-systemd scope；终止使用 `systemctl --user kill --kill-who=all` | `packages/subprocess/subprocess-local/src/index.ts:255`、`packages/subprocess/subprocess-local/src/linux-scope.ts:321` |
| `windows-job` | Windows | 一个 Job Object，仅在该 runner 可被探测时 | `packages/subprocess/subprocess-local/src/index.ts:265` |
| `fallback` | 任意 | 更弱的 containment，由明确警告公告 | `packages/subprocess/subprocess-local/src/index.ts:269` |

systemd 档位的终止是成员全体终止，而非仅终止组长。`packages/subprocess/subprocess-local/src/linux-scope.ts:62` 把该参数定义为 `--kill-who=all`，`packages/subprocess/subprocess-local/src/linux-scope.ts:313` 执行 `systemctl --user kill --kill-who=all --signal=<sig> <unit>`。

fallback 档位用自己的话陈述了它的限度。`packages/subprocess/subprocess-local/src/index.ts:288` 警告该 provider"正在使用更弱的进程树 containment"，并且"逃出进程组或直接父子树的子孙不被保证终止，也不被保证延迟 waitForExit()"。在 macOS 上，陈述的理由是该平台没有受支持的持久进程范围所有者（`packages/subprocess/subprocess-local/src/index.ts:280`）；在 Windows 上，理由取决于该进程是否为终端（`packages/subprocess/subprocess-local/src/index.ts:283`）。

该警告每个 provider 实例只发出一次（`packages/subprocess/subprocess-local/src/index.ts:278`），因此只记录首次警告的 TestPilot 运行不会为每次 spawn 重复该提示。

## 子进程树管理

`packages/subprocess/subprocess-local/src/spawn.ts:132` 的 `signalTree` 以平台正确的语义投递信号。在 Windows 上它通过 `taskkill` 终止该树（`packages/subprocess/subprocess-local/src/spawn.ts:141`）；在 POSIX 上它向负进程组 id 发送信号，并在组已消失时回落到直接子进程（`packages/subprocess/subprocess-local/src/spawn.ts:146`）。

Windows 实现是 `packages/subprocess/subprocess-local/src/spawn.ts:120` 的 `taskkill /PID <pid> /T /F`。`/T` 标志是树的部分，`/F` 是强制的部分。

POSIX 子进程在自己的进程组中启动。`packages/subprocess/subprocess-local/src/spawn.ts:479` 向 spawn 选项传入 `detached: platform !== 'win32'`，这正是使 `packages/subprocess/subprocess-local/src/spawn.ts:146` 的负 pid 组信号有意义的原因。

所有权只在整个受管范围消失之后释放，而不是在直接子进程落定时释放。`packages/subprocess/subprocess-local/src/index.ts:233` 陈述了原因：捕获 TERM 而比领导者活得更久的辅助进程必须保持被持有，以便 teardown 仍能升级处置它。

## 文件读写限制

本仓库中的 sandbox 策略是文件效果策略。`packages/sandbox/sandbox/src/index.ts:38` 声明它的三个模式，同一声明还说网络与进程可见性不在这一词汇之内。

| 模式 | 允许的文件效果 | 证据 |
|---|---|---|
| `read-only` | 仅允许必需的汇点，例如 `/dev/null` | `packages/sandbox/sandbox/src/index.ts:33` |
| `workspace-write` | 工作区、显式额外根（若受支持）以及后端定义的临时区域 | `packages/sandbox/sandbox/src/index.ts:35` |
| `danger-full-access` | 绕过 confinement | `packages/sandbox/sandbox/src/index.ts:35` |

工作区边界是 session 不可变的 cwd，以 `workspaceRoot` 携带（`packages/sandbox/sandbox-policy/src/index.ts:150`）。额外根是被校验而非被信任的：`packages/sandbox/sandbox-policy/src/index.ts:50` 的 `resolveAdditionalWritableRoots` 要求每个条目都是绝对路径且不含 NUL 字节，否则抛出（`packages/sandbox/sandbox-policy/src/index.ts:53`）。该列表被去重并冻结（`packages/sandbox/sandbox-policy/src/index.ts:57`）。

该策略不做的一件事，是治理浏览器自身的文件访问。它治理的是 harness 执行操作的文件效果。在 Chromium 中加载的页面按浏览器自己的规则读文件，而不是按 sandbox 策略。

## 浏览器自身的文件边界

那条边界在上游，位于 `@playwright/mcp@0.0.80`。相关代码在上游 `playwright-core` bundle 的 `outputDir` 与 `checkFile` 函数中。

输出目录默认是服务器工作目录下的 `.playwright-mcp` 子目录（`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65039`）；若工作目录不可写，则回落到带同名基名的临时目录（`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65043`）。

`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65054` 的 `checkFile` 拒绝既不在输出目录内、也不在工作区内的路径：

```text
if (flags.origin === "code" || options.config.allowUnrestrictedFileAccess || options.config.skillMode)
  return;
const output = outputDir(options);
const workspace = options.cwd;
if (!isPathInside(output, resolvedFilename) && !isPathInside(workspace, resolvedFilename))
  throw new Error(`File access denied: ${resolvedFilename} is outside allowed roots. Allowed roots: ${output}, ${workspace}`);
```

三项豁免让该检查比看上去更窄。`code` 来源完全跳过该检查（`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65055`），而这正是上游用于自身生成产物的来源——session 目录、trace、下载与日志都以 `{ origin: "code" }` 传入。`allowUnrestrictedFileAccess` 标志跳过它，`skillMode` 标志也跳过它。

`code` 来源正是 `browser_run_code_unsafe` 所用的来源，因为该工具在页面中执行任意代码，因而按任意路径写文件。

## 网络出口

上游服务器具备来源控制手段，但此处未启用。

`@playwright/mcp@0.0.80` 接受 `--allowed-origins` 与 `--blocked-origins`。其实现是上游 `playwright-core` bundle 中的 `_setupRequestInterception`（`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65292`）：允许列表先安装一条兜底的 abort 路由，再为每个被允许的来源安装一条 continue 路由；阻止列表则为每个被阻止的来源安装一条 abort 路由。

```text
async _setupRequestInterception(context) {
  if (this.config.network?.allowedOrigins?.length) {
    this._disposables.push(await context.route("**", (route2) => route2.abort("blockedbyclient")));
    for (const origin of this.config.network.allowedOrigins) {
      const glob = originOrHostGlob(origin);
      this._disposables.push(await context.route(glob, (route2) => route2.continue()));
    }
  }
  if (this.config.network?.blockedOrigins?.length) {
    for (const origin of this.config.network.blockedOrigins)
      this._disposables.push(await context.route(originOrHostGlob(origin), (route2) => route2.abort("blockedbyclient")));
  }
}
```

同一上游的命令行帮助在选项自身的描述中陈述了该机制的限度（`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:73489`）：

```text
--allowed-origins <origins>   semicolon-separated list of TRUSTED origins to allow the browser to request.
                              Default is to allow all.
                              Important: does not serve as a security boundary and does not affect redirects.
```

harness provider 两个选项都没有传。`packages/experimental/browser-use-playwright-mcp/src/index.ts:35` 构造参数列表，而它能追加的参数只有浏览器选择、attach endpoint，以及 headless 与 executable-path 标志（`packages/experimental/browser-use-playwright-mcp/src/index.ts:36`、`packages/experimental/browser-use-playwright-mcp/src/index.ts:39`）。没有任何来源参数被传入。

本仓库中不存在私网地址或云元数据地址的阻断实现。在 `packages/` 中检索链路本地元数据地址与云元数据主机，均无实现。harness 自身的网络层中同样没有任何地址段过滤，因为它在浏览器与网络之间没有一层。

由此得到一个决定性的事实：**浏览器能抵达这台机器能抵达的任何主机。**来源允许列表在上游存在、实现良好，但在此处是关闭的——而且即使开启，上游自己也拒绝把它称为安全边界。

## DNS 重绑定、重定向与 WebSocket

这三者在本仓库中都没有实现。

| 向量 | 在本仓库中的状态 | 说明 |
|---|---|---|
| DNS 重绑定 | 无实现 | harness 的 Host 栅栏覆盖它自己的本地 HTTP API（`packages/client/connection/src/api-request-trust.ts:3`），而不是浏览器的出站解析 |
| 跨源重定向 | 无实现 | 按上游自己的陈述，上游的路由拦截不影响重定向 |
| WebSocket 出口 | 无实现 | 浏览器路径中不存在 WebSocket 拦截 |

这三者都是 TestPilot 的设计项，而不是配置项。

## 浏览器 attach endpoint

`packages/experimental/browser-use-runtime/src/mcp.ts:60` 的 `validateBrowserMcpConfig` 检查 attach endpoint 的协议与空白，仅此而已。

| 属性 | 是否检查 | 证据 |
|---|---|---|
| endpoint 可被解析为 URL | 是 | `packages/experimental/browser-use-runtime/src/mcp.ts:64` |
| 协议是 `http`、`https`、`ws` 或 `wss` | 是 | `packages/experimental/browser-use-runtime/src/mcp.ts:68` |
| endpoint 含空白 | 是 | `packages/experimental/browser-use-runtime/src/mcp.ts:68` |
| 主机是回环地址或预期地址 | **否** | `packages/experimental/browser-use-runtime/src/mcp.ts:60` |

因此 attach endpoint 可以命名进程能抵达的任何主机。provider 将其原样作为 `--cdp-endpoint` 传入（`packages/experimental/browser-use-playwright-mcp/src/index.ts:37`）。

attach 独占性比看上去更窄。`packages/experimental/browser-use-runtime/README.md:83` 陈述独占所有权适用于一个资源管理器，"而不适用于独立的 provider、进程或外部浏览器客户端"。第二个 TestPilot worker，或任何附加到同一浏览器的其他客户端，都在该排除之外。

## Worker 超时、终止与静默

宽限期有两项职责，契约也这么陈述。`packages/subprocess/subprocess/src/types.ts:86` 描述 `graceMs` 可供 provider 的终止流程使用，并"用于在进程退出后排空仍然打开的收集管道"，因为被存活者持有的继承描述符不能无限期地撑住结果。

终止职责是本地 provider 中分阶段的 TERM 再 KILL 阶梯（`packages/subprocess/subprocess-local/src/spawn.ts:365`）。排空职责是 `packages/subprocess/subprocess-local/src/spawn.ts:417`：直接子进程落定之后，结果要么在输出流关闭时落定，要么在 `spec.graceMs` 之后落定，取先到者（`packages/subprocess/subprocess-local/src/spawn.ts:422`）。

静默是范围的属性，而非命令的属性。`packages/subprocess/subprocess/src/types.ts:195` 声明 `waitForExit(signal?)` 等待"直到同一受管范围变空——而不只是直到被启动的命令报告其结果，因此存活下来的工作仍然可被观察"。

## 威胁模型

| 资产 | 攻击面 | 现有控制 | 缺口 | TestPilot 义务 |
|---|---|---|---|---|
| 被测应用 | 导航到这台机器能抵达的任何 URL | harness 中无；上游允许列表可用但未使用 | 浏览器请求没有来源限制 | TestPilot 必须自行执行导航策略，并把上游允许列表视为便利手段而非控制手段 |
| session 完整性 | 从被允许来源出发的跨源重定向 | 无 | 上游路由拦截明确不覆盖重定向 | TestPilot 必须决定越出策略的重定向是否中止该步骤，并自行检测它 |
| 这台机器的网络位置 | 页面脚本打开的 WebSocket 连接 | 无 | `context.route` 不拦截 WebSocket 握手 | TestPilot 必须在自有层阻断 WebSocket，或接受并记录该暴露 |
| 名称解析 | 被允许主机的 DNS 重绑定到私网地址 | 无 | 不存在地址段检查或解析时检查 | 若主机允许列表要有意义，TestPilot 必须自行解析并检查地址 |
| 云元数据与私有服务 | 指向 `169.254.169.254` 或私网段地址的请求 | 无 | 仓库中不存在元数据地址或私网段阻断 | TestPilot 必须自行阻断链路本地与私网段 |
| 宿主文件系统 | `browser_run_code_unsafe` 按任意路径写入或读取 | 上游 `checkFile` 的根检查，带 `code` 来源豁免 | 该豁免覆盖了任意代码路径 | TestPilot 不得把上游文件边界当作对抗 `browser_run_code_unsafe` 的控制手段 |
| 工作区文件系统 | 浏览器页面读取或写入工作区文件 | sandbox 策略只治理 harness 执行的文件效果 | 浏览器自身的文件访问在该策略之外 | TestPilot 必须限定浏览器的工作目录，并单独核算 `outputDir` |
| session 日志与其他 session | 代另一个 session 发起的工具调用 | 按作用域键过滤派发 | 作用域标签由派发过滤器强制，而非按 session 的能力强制 | TestPilot 不得仅依赖作用域来阻止一次运行触达另一次运行的 session |
| 被测浏览器 | 命名非预期主机的 attach endpoint | 只校验协议与空白 | 主机未被检查 | TestPilot 必须在获取浏览器之前自行校验 attach 主机 |
| 机密 | 凭据进入日志或模型上下文 | 客户端中的掩码显示；MCP 错误诊断上的脱敏 | 掩码只影响显示，脱敏不覆盖成功结果 | TestPilot 必须从构造上把机密挡在模型转录之外，而不是靠掩码 |

## 延伸阅读

- [审批与安全审计](approval-security-audit.zh.md) — 凭据边界与审批接缝。
- [agent、session 与工具生命周期审计](session-tool-lifecycle-audit.zh.md) — worker 生命周期及其所有权。
- [浏览器提供方审计](browser-provider-audit.zh.md) — 浏览器如何被获取与释放。
- [MCP 契约审计](mcp-contract-audit.zh.md) — 浏览器暴露的实测工具列表。
