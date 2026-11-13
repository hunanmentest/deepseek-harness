# TestPilot 阶段 0 — 源码审计与技术基线

[English](README.md) | 中文

TestPilot 是将在 DeepSeek Harness 内构建的 Web 质量平台。阶段 0 是只读审计：它确立 harness 已经提供什么、TestPilot 必须新增什么，以及在开始实现之前还有哪些问题未决。它不开发任何 TestPilot 功能，也不改动任何生产代码。

## 结论

阶段 0 **未通过验收**。审计已经完成，但方案中的七项阻塞条件仍有三项开放，其中一个决策——后台 worker 如何获得审批上下文——阻塞了阶段 1 设计的其余部分。推理过程见[阶段 0 验收](phase-0-acceptance.zh.md)。

## 审计确立的结论

| 发现 | 对 TestPilot 的影响 |
|---|---|
| 浏览器栈已经存在且覆盖良好 | TestPilot 新增的是测试领域，而不是浏览器栈 |
| 上游 MCP server 通告 24 个工具，其中 16 个会改变远端状态 | 工具契约是实测的，不是假设的 |
| 上游为每个工具发布了风险标签，而 harness 桥接层把它丢弃 | 风险分类必须自建，而被丢弃的标签值得找回 |
| 测试运行不等于 session | 领域模型应归属存储域 |
| 审批接口要求开启的轮次 | 后台 worker 无法直接使用它，这正是阻塞性问题 |
| 来源白名单在上游已实现但在此处被禁用，且不覆盖重定向 | 机制已知，保证未知 |
| 单元基线与真实 Chromium 基线都是绿的 | 290 个单元用例与 2 个浏览器用例通过 |

## 审计文档

| 文档 | 内容 |
|---|---|
| [仓库审计](repository-audit.zh.md) | 工作区状态、环境、包放置 |
| [Profile、bundle 与 loader 审计](profile-bundle-integration-audit.zh.md) | profile 分层、bundle 形态、loader 替换、产品隔离 |
| [浏览器提供方审计](browser-provider-audit.zh.md) | 注册、运行时所有权、提供方生命周期 |
| [MCP 契约审计](mcp-contract-audit.zh.md) | 实测的 24 工具契约与 annotations 缺口 |
| [agent、session 与工具生命周期审计](session-tool-lifecycle-audit.zh.md) | agent、session 与工具的所有权，以及 worker 生命周期 |
| [审批与安全审计](approval-security-audit.zh.md) | 审批接缝、轮次前置条件与凭据边界 |
| [执行隔离审计](execution-isolation-audit.zh.md) | 网络、进程、文件与 attach 边界 |
| [包发布审计](package-release-audit.zh.md) | 分类、发布、版本与文档义务 |
| [测试基线](testing-baseline.zh.md) | 执行过的每条命令与每个结果 |
| [架构决策](architecture-decisions.zh.md) | ADR-001 至 ADR-010 与开放问题 |
| [阶段 0 验收](phase-0-acceptance.zh.md) | 验收表、阻塞项与阶段 1 边界 |

## 证据约定

这些文档中的每条主张都带有方案定义的四个来源级别之一：

| 级别 | 含义 |
|---|---|
| 已核实 | 从本树中的源码、配置或文档读出，或通过运行实测 |
| 待核实 | 存在相关代码，但未读完整调用链 |
| 设计推断 | 根据既有架构提出的建议 |
| 新增设计 | TestPilot 自身必须增加的能力 |

标记为"已核实"的主张已对照本树中存在的文件确认。撰写该审计时该树没有可解析的 Git commit，因此方案中声明的 commit 基准无法确认；见[仓库审计](repository-audit.zh.md)。

## 阶段 1 边界

阶段 1 交付浏览器基础与安全机制：测试项目与用例领域、快照注册表、定位器校验器、风险分类、审批门禁、带重定向测试的来源白名单、attach endpoint 主机检查，以及通过附件存储保存的证据。

阶段 1 不交付 worker 池、测试报告或失败分析。在审批决策被记录之前，它不得开始 worker 的实现。

## 延伸阅读

- [架构决策](architecture-decisions.zh.md) — 本审计所确定的决策。
- [阶段 0 验收](phase-0-acceptance.zh.md) — 验收标准与三项开放阻塞项。
- [测试基线](testing-baseline.zh.md) — 每个结果背后的命令。
