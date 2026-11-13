# TestPilot 阶段 0 — MCP 契约审计

[English](mcp-contract-audit.md) | 中文

本审计记录固定版本上游 server 实际通告的工具契约。该清单的获取方式是：用提供方所用的相同参数在 stdio 上启动 `@playwright/mcp@0.0.80`，调用 `initialize` 与 `tools/list`，并读取响应。本文档中的工具名称、参数与结果形态均非抄自文档，而是实测所得。

## 测量方式

探测程序以 `--browser chromium --isolated --headless --executable-path <本地 Chromium>` 启动上游 server，通过 stdio 连接 MCP client，并调用 `tools/list`。该 server 通告了 24 个工具。

| 事实 | 值 |
|---|---|
| Server 包 | `@playwright/mcp@0.0.80` |
| 底层运行时 | `playwright@1.63.0-alpha-2026-08-31` |
| MCP SDK | `@modelcontextprotocol/client@2.2.0` |
| 通告的工具数 | 24 |
| Server 能力 | 仅 `tools`；无 `resources`、`prompts`、`logging`、`completions` |

该 server 在此配置下未通告任何 resource 或 prompt，这与浏览器提供方 README 中"MCP client 为浏览器 server 暴露资源助手与归属的 server instructions"的表述不符。资源助手存在于 harness 中；本次测量的上游 server 没有可供其寻址的对象。

## 通告的工具清单

每个工具都带有 `additionalProperties: false` 与来自上游 server 的 JSON Schema。

| 工具 | 必填参数 | 可选参数 | `readOnlyHint` | `destructiveHint` |
|---|---|---|---|---|
| `browser_close` | — | — | false | true |
| `browser_resize` | `width`、`height` | — | false | true |
| `browser_console_messages` | `level` | `all`、`filename` | true | false |
| `browser_handle_dialog` | `accept` | `promptText` | false | true |
| `browser_evaluate` | `function` | `element`、`target`、`filename` | false | true |
| `browser_file_upload` | — | `paths` | false | true |
| `browser_drop` | `target` | `element`、`paths`、`data` | false | true |
| `browser_find` | — | `text`、`regex` | true | false |
| `browser_fill_form` | `fields` | — | false | true |
| `browser_press_key` | `key` | — | false | true |
| `browser_type` | `target`、`text` | `element`、`submit`、`slowly` | false | true |
| `browser_navigate` | `url` | — | false | true |
| `browser_navigate_back` | — | — | false | true |
| `browser_network_requests` | `static` | `filter`、`filename` | true | false |
| `browser_network_request` | `index` | `part`、`filename` | true | false |
| `browser_run_code_unsafe` | — | `code`、`filename` | false | true |
| `browser_take_screenshot` | `scale` | `element`、`target`、`type`、`filename`、`fullPage` | true | false |
| `browser_snapshot` | — | `target`、`filename`、`depth`、`boxes` | true | false |
| `browser_click` | `target` | `element`、`doubleClick`、`button`、`modifiers` | false | true |
| `browser_drag` | `startTarget`、`endTarget` | `startElement`、`endElement` | false | true |
| `browser_hover` | `target` | `element` | false | true |
| `browser_select_option` | `target`、`values` | `element` | false | true |
| `browser_tabs` | `action` | `index`、`url` | false | true |
| `browser_wait_for` | — | `time`、`text`、`textGone` | true | false |

两个 schema 细节对确定性测试引擎有影响。`browser_console_messages` 要求 `level`，`browser_network_requests` 要求 `static`，尽管两者在语义上都是可选的；`browser_take_screenshot` 要求 `scale`，尽管上游默认值已经够用。点名这些工具的测试计划必须提供这些字段，否则上游 server 会拒绝该次调用。

## 方案假设与实测的差距

方案称工具目录"不是 TestPilot 自定义的八个 API"，且上游集合可能随固定依赖变化。实测确认了第二点，并修正了第一点：上游 server 通告 24 个工具，这些工具的风险范围明显大于一个"点击加读取"的面。

| 方案预期 | 实测结果 |
|---|---|
| 一组固定的少量工具 | 24 个工具：7 个只读、16 个改变状态、1 个任意代码执行 |
| 工具 schema 不由提供方固定 | 属实；schema 由上游 server 逐工具提供 |
| 风险分类是 TestPilot 的新增职责 | 属实且更精确：上游已为每个工具标注 `readOnlyHint` 与 `destructiveHint`，而这些标注在模型看到工具之前就被丢弃 |

## annotations 缺口

上游 server 发布 MCP 工具标注：`title`、`readOnlyHint`、`destructiveHint` 与 `openWorldHint`。`packages/mcp/mcp-client/src/tools.ts` 不读取它们。`createMcpToolDefinition` 复制 `name`、`description`、`inputSchema`、`outputSchema` 与 `execution.taskSupport`，此外一概不取。在 `packages/mcp/mcp-client/src` 与 `packages/core/tools/src` 中检索 `annotations`、`readOnlyHint`、`destructiveHint`、`openWorldHint`，没有任何读取它们的代码。

因此这些信息在上游可得，却在 harness 的工具注册表中缺失。这是 TestPilot 风险分类最有价值的一条发现：上游已经为每个浏览器工具算出了风险标签，而桥接层把它丢掉了。

由此产生两个后果。TestPilot 无法仅凭 `ctx.tools` 分类风险，因为注册表中没有这样的字段。而且由于 `packages/core/tools/src/contracts.ts` 中的 `ToolDefinition` 没有标注或风险字段，需要该字段的分类器要么直接读取上游 schema，要么由 harness 为共享契约增加一个字段。

| 选项 | 后果 |
|---|---|
| TestPilot 按工具名分类 | 依赖一个由上游包拥有的 24 条清单；提供方自身的 README 已声明工具 schema 不作稳定性承诺 |
| TestPilot 按工具参数分类 | 能看到模型意图的实际作用，包括 `browser_navigate` 中的 URL 与 `browser_file_upload` 中的路径 |
| 由 harness 把上游 annotations 承载到 `ToolDefinition` | 变更 `packages/core/tools` 中的共享公共契约，仓库规则要求为其编写升级指南与类型确认 |

## 结果投影

`packages/mcp/mcp-client/src/tools.ts` 把 MCP 结果转换为 harness 的内容词汇。文本块以换行连接。`image` 块被解码并通过附件存储保存，模型收到的是附件引用；拒绝时投影为形如 `[image unavailable: <mime>; <reason>; raw image data remains available to programmatic callers]` 的文本。

带 `isError: true` 的 MCP 结果会被抛出而非返回，因此工具运行时记录一次失败。图像准入要求存在附件存储、可解析的模型路由，且模型声明的 `inputModalities` 包含 `image`；任一缺失都会产生文本诊断而非图像。

`projectContent` 仅在规范值与回退内容都与记录的执行完全一致时才返回预备投影，因此改变了结果的策略替换会被保留。

## TestPilot 不得假设的事项

| 假设 | 状态 |
|---|---|
| 存在一组固定的八个浏览器 API | 不成立；通告了 24 个工具 |
| 上游工具名称稳定 | 不成立；提供方 README 声明 schema 不稳定 |
| 工具注册表携带风险信息 | 不成立；上游 annotations 在桥接层被丢弃 |
| 工具调用是幂等的 | 24 个中有 16 个不成立；`browser_navigate`、`browser_click`、`browser_type` 与 `browser_fill_form` 会改变远端状态 |
| 被取消的调用不留痕迹 | 不成立；上游 server 保持浏览器存活，浏览器保持状态 |
| 资源助手能触达浏览器 server | 此配置下不成立；该 server 未通告任何 resource |

## 延伸阅读

- [浏览器提供方审计](browser-provider-audit.zh.md) — 提供方在何处启动 server。
- [执行隔离审计](execution-isolation-audit.zh.md) — 通告的工具能触达什么。
- [架构决策](architecture-decisions.zh.md) — 本次测量所确定的决策。
