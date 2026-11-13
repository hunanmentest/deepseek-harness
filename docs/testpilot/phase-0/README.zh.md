# TestPilot 阶段 0 — 源码审计与技术基线

[English](README.md) | 中文

TestPilot 是将在 DeepSeek Harness 内部构建的 Web 质量平台。阶段 0 是一次只读审计：它确立 harness 已经提供什么、TestPilot 必须新增什么，以及在实现开始之前还有哪些问题悬而未决。它不开发任何 TestPilot 功能，也不改动任何生产代码。

## 结论

阶段 0 **未通过验收**。审计覆盖了全部十四个工作包，并记录了十四条架构决策，但其中两条处于阻塞状态，方案自身的验收清单也尚未满足。推理过程见[阶段 0 验收](phase-0-acceptance.zh.md)。

那一条决定其余部分的决策——后台 worker 如何获得审批上下文——在 [ADR-011](architecture-decisions.zh.md#adr-011--approval-credentials-and-high-risk-operations)中被记为阻塞，因为仓库的审批服务会拒绝任何 session 没有开启轮次的请求。

## 审计确立的结论

| 发现 | 对 TestPilot 的影响 |
|---|---|
| 浏览器栈已经存在且覆盖良好 | TestPilot 新增的是测试领域，而不是浏览器栈 |
| 上游 MCP server 通告 24 个工具，其中 16 个会改变远端状态 | 工具契约是实测的，不是假定的 |
| 上游为每个工具发布了风险标签，而 harness 桥接层把它丢弃 | 风险分类必须自建，而被丢弃的标签值得找回 |
| 测试运行不是 session | 领域模型应归属存储域 |
| 审批接缝要求有一个开启的轮次 | 后台 worker 无法直接使用它，这正是那个阻塞性问题 |
| 来源白名单在上游已实现，但在此处被禁用，且不覆盖重定向 | 机制已知；保证未知 |
| `ctx.subprocess` 是唯一拥有受管范围完全停稳契约的接缝 | worker 是一个子进程，不是 subagent、job 或 workflow 步骤 |
| 仓库没有报告、trace 或视频设施 | 证据是附件引用加上域记录 |
| 单元基线与真实 Chromium 基线都是绿的 | 290 个单元用例与 2 个浏览器用例通过 |

## 审计文档

| 工作包 | 文档 | 内容 |
|---|---|---|
| A01 | [仓库审计](repository-audit.zh.md) | 工作区状态、环境、包放置、命名规则 |
| A02 | [Profile、bundle 与 loader 审计](profile-bundle-integration-audit.zh.md) | profile 分层、bundle 格式、loader 替换、产品隔离 |
| A03 | [浏览器提供方审计](browser-provider-audit.zh.md) | 注册、运行时所有权、提供方生命周期 |
| A04 | [MCP 契约审计](mcp-contract-audit.zh.md) | 实测的 24 工具契约与 annotations 缺口 |
| A05 | [agent、session 与工具生命周期审计](session-tool-lifecycle-audit.zh.md) | agent、session 与工具的所有权，以及 worker 生命周期 |
| A06 | [审批与凭据审计](approval-security-audit.zh.md) | 审批接缝、它的轮次前置条件与凭据边界 |
| A07 | [执行隔离审计](execution-isolation-audit.zh.md) | 网络、进程、文件与 attach 边界，以及威胁模型 |
| A08 | [存储与持久化审计](storage-persistence-audit.zh.md) | domain 层、两个后端与版本链 |
| A09 | [后台执行审计](background-execution-audit.zh.md) | jobs、workflow、PTC、subagent 与 subprocess 的对比 |
| A10 | [项目归属审计](project-ownership-audit.zh.md) | 工作区身份、单一所有者规则与远程访问 |
| A11 | [Web 平台集成审计](web-platform-integration-audit.zh.md) | 宿主服务、网关、controller 与客户端模块体系 |
| A12 | [证据与可观测性审计](evidence-observability-audit.zh.md) | 附件、交付物、遥测，以及不存在的部分 |
| A13 | [测试基线](testing-baseline.zh.md) | 执行过的每一条命令与每一个结果 |
| A14 | [包发布审计](package-release-audit.zh.md) | 分类、发布、版本与文档义务 |

有两份文档位于工作包之上：[架构决策](architecture-decisions.zh.md)记录 ADR-001 至 ADR-014，[阶段 0 验收](phase-0-acceptance.zh.md)把方案的清单应用到证据上。

## 证据约定

这些文档中的每一条主张都带有方案定义的四个来源级别之一：

| 级别 | 含义 |
|---|---|
| 已核实 | 从本树中的源码、配置或文档读出，或通过运行实测 |
| 待核实 | 存在相关代码，但未读完整调用链 |
| 设计推断 | 从既有架构推导出的提议 |
| 新增设计 | TestPilot 自身必须增加的能力 |

一条"已核实"的主张已对照本树中存在的文件确认；对于行为类主张，还对照了一条真正执行过的命令，其结果记录在[测试基线](testing-baseline.zh.md)中。

## 阶段 1 边界

阶段 1 交付浏览器基础与安全机制：测试项目与用例领域、快照注册表、定位器校验器、风险分类、审批门禁、带重定向测试的来源白名单、attach endpoint 主机检查，以及通过附件存储保存的证据。

阶段 1 不交付 worker 池、测试报告或失败分析。在 ADR-011 的审批决策被确定之前，它不得开始 worker 的实现。

## 延伸阅读

- [架构决策](architecture-decisions.zh.md) — 本审计所确定的十四条记录。
- [阶段 0 验收](phase-0-acceptance.zh.md) — 验收标准与尚未解除的阻塞项。
- [测试基线](testing-baseline.zh.md) — 每个结果背后的命令。
