# TestPilot

TestPilot 是一个可选的 Web 质量平台 bundle。它提供结构化的测试项目、计划、运行与用例，带身份与有效期的快照注册表，拒绝过期引用的定位器校验器，针对实测上游浏览器工具的风险分类，高风险动作的运行级授权闸门，来源与连接主机策略，证据引用，质量门禁，四种报告格式，以及健康指标。

用 `dsh plugin --profile web add @deepseek-ai/dsh-testpilot` 启用，并用 `dsh --profile web --dump-config` 核对组合。已发布的 bundle 都不插入 TestPilot，因此在加入该 bundle 之前，默认 profile 不含它的任何工具。配置只有一行，按 id `testpilot` 寻址。

### 可以查什么

`testpilot_status` 报告健康状态、配置摘要与计数器。`testpilot_metrics` 报告运行成功率、证据采集率、审批拒绝数、来源拒绝数与门禁耗时。`testpilot_run_get` 读取持久化的运行状态，`testpilot_report_get` 读取 JSON、JUnit、HTML 或 Markdown 报告，而 `testpilot_gate_evaluate` 生成并保存这些报告背后的门禁结论。`testpilot_evidence_list` 列出证据引用，并显式给出每一类缺失的证据。

### 边界

来源白名单由 TestPilot 逐跳检查重定向，但上游浏览器提供方自带的 allowed-origins 选项不覆盖重定向；在重定向测试记录下实际行为之前，两者都不构成安全边界。高风险动作需要一份会过期、绑定参数摘要、不可重放的运行级授权；授权永不会变成永久许可。二进制证据由域记录引用、存放在域之外；报告在证据缺失时显式说明，而不暗示采集成功。本阶段不驱动浏览器 worker，也不把场景数量当作代码覆盖率。

发布门禁与指标口径见 `docs/testpilot/phase-1/RELEASE.md` 和 `docs/testpilot/phase-1/MONITORING.md`。
