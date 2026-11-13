# TestPilot 阶段 0 —— 后台执行：jobs、workflow、PTC 与 subagent

[English](background-execution-audit.md) | 中文

本审计记录 harness 已经提供的四个后台设施、每个设施各自的要求，以及一个确定性测试执行器可以复用其中哪一个。内容覆盖 Jobs 注册表、Workflow 引擎、PTC 运行时与 subagent 树。每条结论都带有文件路径与行号。

## 范围与结论

| 问题 | 答案 |
|---|---|
| 确定性测试执行器可以复用哪个设施？ | `ctx.subprocess`，因为它是唯一拥有受管范围静止性契约的接缝。 |
| 它不能复用哪个设施？ | PTC、Jobs、Workflow 与 Subagent，理由各不相同且都已写明。 |
| 后台执行单元需要实时 Agent 吗？ | 不需要。`ctx.subprocess` 根本没有 Agent 概念。 |
| 审批必须在哪里发生？ | 在工作进入后台之前，由发起方 Agent 在它自己的轮次内完成。 |
| 确定性的审批策略是什么？ | `ApprovalPolicy = 'never'`，在任何派发之前由服务内部决定。 |
| 崩溃的 worker 仍可回收吗？ | 可以，而且该保证来自 `ctx.subprocess`，而不是来自 PTC。 |

## 四个后台设施

| 问题 | Jobs | Workflow | PTC | Subagent |
|---|---|---|---|---|
| 它是什么 | 在一个 owner 名下管理后台生产者的注册表 | 运行模型编写脚本的引擎 | 在隔离基质中求值程序的运行时 | 创建另一个 Agent 的机制 |
| 它执行什么 | 生产者自己的工作 | `agent()` 调用与脚本的组合器 | 程序及其绑定 | 一整个模型轮次 |
| 需要实时 Agent | 归属 job 需要 | 需要；`parent: Agent` 是必填字段 | 不需要 | 需要；必须是确切的实时父 agent |
| 并发上限 | 每个 owner 10 个活跃 job | `min(16, 核数 - 2)` 个并发 agent，合计 1000 | 每个 state owner 同一时刻一次运行 | 每棵 subagent 树 8 个存活子代 |
| 取消语义 | 生产者的 `cancel` 钩子，然后进入 `stopping` 状态 | `cancel()` 中止该运行及其子代 | 中止信号使运行以 `abort` 落定 | `interrupt()` 是发出即返回 |
| 资源所有权 | 注册表拥有身份、状态与输出环；生产者拥有执行资源 | 持有者拥有该运行，且必须调用 `dispose()` | 运行时拥有基质，且必须终止并等待在途运行 | 管理器拥有该 activation 及其容量槽位 |
| 失败表达 | 带状态与详情的已结算记录 | `result` 永不 reject；结论在 `stopReason` 里 | 已解析结果上的 `error.kind` | 带 stop reason 的子代结果 |

失败那一行把这几个设施彼此区分开，也把它们与测试运行器的需求区分开。测试失败必须与基础设施失败、取消以及超时互相可辨。只有 PTC 明确做出这种区分，而它这样做的目的另有其人。

## Jobs

### 抽象接缝

`packages/jobs/jobs/src/index.ts:89` 是抽象注册表。它的语义以一份实现必须遵守的规则清单给出。

| 规则 | 陈述 | 证据 |
|---|---|---|
| owner 与服务释放 | 取消存活工作并等待守规的生产者；抛错的拆卸取消只强制失败那一条记录，而这类结算会以 `cause: 'teardown'` 宣告 | `packages/jobs/jobs/src/index.ts:58` |
| owner 隔离 | 归属 job 的访问以其 owner 的 session id 为界；id 是可预测的，因此边界是授权而非保密 | `packages/jobs/jobs/src/index.ts:63` |
| 结算 | 先到先得：一条终态记录、释放等待者，然后一轮受控的事件投递，即使面对迟到的生产者结果 | `packages/jobs/jobs/src/index.ts:65` |
| `start` 准入 | 当没有已挂载的 job controller 服务该 spec 的 owner 时拒绝工作，因此生产者无法启动该 owner 既不能收集也不能停止的工作 | `packages/jobs/jobs/src/index.ts:73` |
| 保留 | 有界；超出活动上限的追加丢弃最旧的保留字节，而落在保留窗口之下的读取者得到有损读取而不是错误 | `packages/jobs/jobs/src/index.ts:84` |

生产者契约很小，而且很严格。

| 成员 | 规则 | 证据 |
|---|---|---|
| `owner` | owner 的实时 Agent 必须是当前在该 id 下注册的那一个；它的释放会取消并等待该 job，而省略 owner 则创建一个归属 job，在服务释放之前对任何调用方开放 | `packages/jobs/jobs/src/types.ts:186` |
| `cancel(reason?)` | 必须同步、幂等，并最终让 `done` 落定；抛出的异常向外传播 | `packages/jobs/jobs/src/types.ts:160` |
| `done` | 在生产者释放其资源之后解析，而不仅仅在工作结束时解析，并且不得 reject | `packages/jobs/jobs/src/types.ts:165` |
| `run(job)` | 在预检之后以该 job 的生产者面被调用一次；抛错则不留下任何注册，而生产者必须清理任何已部分启动的资源 | `packages/jobs/jobs/src/types.ts:206` |

### 本地实现

`packages/jobs/jobs-local/src/index.ts` 是随包发布的实现，它的限额就是一个测试运行器会真正撞到的具体数字。

| 属性 | 取值 | 证据 |
|---|---|---|
| 活跃 job 上限 | 每个确切 owner 10 个 | `packages/jobs/jobs-local/src/index.ts:34` |
| 活动环保留 | 每个 job 256 KiB | `packages/jobs/jobs-local/src/index.ts:37` |
| 结算后环保留 | 16 KiB | `packages/jobs/jobs-local/src/index.ts:40` |
| `start` 准入 | 先做 controller 检查，再做每个 owner 的活跃计数，然后分配 id | `packages/jobs/jobs-local/src/index.ts:214` |
| 生产者启动 | `run` 在 job 注册之前被同步调用 | `packages/jobs/jobs-local/src/index.ts:252` |
| owner 解析 | owner session 当前必须有一个实时 agent，否则抛出 `JOB_OWNER_NOT_LIVE` | `packages/jobs/jobs-local/src/index.ts:372` |
| 终止 | 先 cancel，这样抛错不会改变生命周期状态，然后才置 `stopping` | `packages/jobs/jobs-local/src/index.ts:495` |
| 结算 | 先到先得；等待者在 `settled` 事件发出之前被释放 | `packages/jobs/jobs-local/src/index.ts:614` |
| owner 释放 | 取消并等待该 owner 的每一个 job，然后丢弃这些记录 | `packages/jobs/jobs-local/src/index.ts:666` |
| 服务释放 | 取消全部、等待结算、丢弃每条记录，然后卸载 owner 的 effect | `packages/jobs/jobs-local/src/index.ts:685` |

状态词汇恰好有五个取值：`running`、`stopping`、`completed`、`killed` 与 `failed`（`packages/jobs/jobs/src/view.ts:19`）。而生产者只报告其中三个（`packages/jobs/jobs/src/types.ts:71`）。

### 模型可见工具与完成通知

| 工具 | 用途 | 证据 |
|---|---|---|
| `job_output` | 读取某个后台 job 的输出，可选择等待它结束 | `packages/jobs/tool-jobs/src/index.ts:433` |
| `job_list` | 列出调用方可见的 job | `packages/jobs/tool-jobs/src/index.ts:548` |
| `job_kill` | 请求取消一个后台 job | `packages/jobs/tool-jobs/src/index.ts:570` |

完成通知的投递是值得借鉴的模式。`packages/jobs/tool-jobs/src/index.ts:370` 是投递函数：`cause: 'teardown'` 的结算与没有 owner 的结算都完全不投递，而目的地是当前为该 owner session 注册的 agent。当 owner 处于 idle 且唤醒预算允许时，通知是一次 `followup`，会唤醒驱动；否则它降级为一次 `inject`，只把面向模型的上下文入队而不唤醒（`packages/jobs/tool-jobs/src/index.ts:398`）。模型已经收集过的结算不会被投递两次（`packages/jobs/tool-jobs/src/index.ts:424`）。

## Workflow

### 引擎接缝

`packages/workflow/workflow/src/index.ts:157` 是抽象引擎。它的契约陈述了三件消费方可以依赖的事：一个存活的运行由持有者拥有，其结果永不 reject，而释放会等待脚本与子代的清理。生命周期监听器的失败被容纳并记录，而不是向外传播（`packages/workflow/workflow/src/index.ts:175`）。

启动请求把父 agent 携带为必填字段。`packages/workflow/workflow/src/runtime-types.ts:31` 声明 `parent: Agent`，而 `packages/workflow/workflow/src/runtime-types.ts:17` 给出理由：脚本派生出的每一个 `agent()` 都归属于那个实时 Agent。运行句柄本身在 `packages/workflow/workflow/src/runtime-types.ts:40`。

### 基于 PTC 的实现

`packages/workflow/workflow-ptc/src/index.ts:134` 是随包发布的引擎。脚本被编译为 PTC 程序并运行在它自己的 Node 进程里，而宿主在发布该运行之前解析出各项限额。

| 限额 | 取值 | 证据 |
|---|---|---|
| 并发 agent | 配置值为零时取 `min(16, 核数 - 2)` | `packages/workflow/workflow-ptc/src/index.ts:142` |
| agent 调用总数 | 1000 | `packages/workflow/workflow-ptc/src/index.ts:109` |
| 每次组合器调用的条目数 | 4096 | `packages/workflow/workflow-ptc/src/index.ts:110` |
| 宿主侧预检 | 脚本体只被解析然后丢弃；什么都不执行 | `packages/workflow/workflow-ptc/src/index.ts:55` |
| 时限 | `timeoutMs: null`，因此程序自身没有时间上限 | `packages/workflow/workflow-ptc/src/host.ts:298` |

### 宿主绑定与失败分层

`packages/workflow/workflow-ptc/src/host.ts:178` 定义了 guest 可以调用的五个 JSON 绑定：`begin`、`startChild`、`childResult`、`disposeChild` 与 `progress`。`startChild` 是 subagent 而不是进程：它带着 `parent: this.parent` 调用 `this.subagents.startActivation`（`packages/workflow/workflow-ptc/src/host.ts:200`），因此一个 workflow 子代是一个完整的 Agent。

取消是先到先得：第一次调用记录原因并中止控制器，之后的调用直接返回而不改变任何东西（`packages/workflow/workflow-ptc/src/host.ts:151`）。

脚本运行在 PTC 进程自己的 `vm` context 里（`packages/workflow/workflow-ptc/src/runtime.ts:83`），而 `agent()` 钩子区分两类对测试运行器很重要的失败。

| 失败 | 层次 | 行为 | 证据 |
|---|---|---|---|
| 子代 agent 自身失败 | 可恢复 | 钩子返回 `null`，脚本继续运行 | `packages/workflow/workflow-ptc/src/runtime.ts:221` |
| 提供方损坏 | 致命 | 钩子抛出，运行停止 | `packages/workflow/workflow-ptc/src/runtime.ts:196` |
| `parallel()` 的某个 thunk 抛出 | 可恢复 | 该条目变成 `null` | `packages/workflow/workflow-ptc/src/runtime.ts:285` |
| `pipeline()` 的某个 stage 抛出 | 可恢复 | 该条目变成 `null`，其余 stage 被跳过 | `packages/workflow/workflow-ptc/src/runtime.ts:311` |
| 组合器内部的致命错误 | 致命 | 它向外传播并终止整个脚本 | `packages/workflow/workflow-ptc/src/runtime.ts:304` |

可恢复那一类正是 TestPilot 的问题。单个子代失败会塌缩为 `null`，因此脚本无法区分失败的子代与产出空结果的子代。

## PTC

### 抽象接缝

`packages/ptc-runtime/ptc-runtime/src/index.ts:109` 是抽象运行时。它的契约要求实现把程序当作敌意对等者、隔离不同的 state owner，并在释放时终止并等待在途运行（`packages/ptc-runtime/ptc-runtime/src/index.ts:102`）。`isolation` 成员是执行基质的小写描述符——`worker-thread`、`process` 或 `container`——它是信息性的，而不是安全声明（`packages/ptc-runtime/ptc-runtime/src/index.ts:122`）。`release(owner)` 释放某个 owner 保留的环境（`packages/ptc-runtime/ptc-runtime/src/index.ts:142`）。

一次运行永不 reject。失败分类是一个封闭的八种取值集合，挂在已解析的结果上。

| 取值 | 含义 | 证据 |
|---|---|---|
| `exception` | 程序抛出，或解析／变换失败 | `packages/ptc-runtime/ptc-runtime/src/types.ts:141` |
| `timeout` | 实现自有的预算耗尽 | `packages/ptc-runtime/ptc-runtime/src/types.ts:142` |
| `abort` | 请求的 `signal` 触发 | `packages/ptc-runtime/ptc-runtime/src/types.ts:143` |
| `worker-exit` | 执行基质死亡而未落定 | `packages/ptc-runtime/ptc-runtime/src/types.ts:144` |
| `invalid-output` | 完成值不是无损 JSON | `packages/ptc-runtime/ptc-runtime/src/types.ts:145` |
| `output-limit` | 序列化的外层日志、值或诊断超出配置上限 | `packages/ptc-runtime/ptc-runtime/src/types.ts:146` |
| `protocol` | 程序发送了无效或超预算的控制流量 | `packages/ptc-runtime/ptc-runtime/src/types.ts:147` |
| `sandbox-unavailable` | 所需的约束无法建立 | `packages/ptc-runtime/ptc-runtime/src/types.ts:148` |

`packages/ptc-runtime/ptc-runtime/src/types.ts:157` 陈述了让这一切可用的规则：错误是已解析结果上的一个字段，绝不是 `run()` 的 reject。报告一个失败的程序是调用方的职责，而不是异常路径。中止语义在 `packages/ptc-runtime/ptc-runtime/src/types.ts:110`：运行时硬性停止程序，即便是在循环中途，而在途的绑定调用仍由调用方负责落定。

### Node 实现

`packages/ptc-runtime/ptc-runtime-node/src/index.ts:28` 声明 `isolation = 'process'`。

| 属性 | 陈述 | 证据 |
|---|---|---|
| 隔离 | 每个程序环境一个 Node 进程 | `packages/ptc-runtime/ptc-runtime-node/src/index.ts:28` |
| 服务释放 | 服务的 effect 负责排空：每个存活运行被中止并被等待，执行资源被释放 | `packages/ptc-runtime/ptc-runtime-node/src/index.ts:47` |
| 策略变更 | 新的运行在被准入之前要等待上一个策略的进程清理 | `packages/ptc-runtime/ptc-runtime-node/src/index.ts:133` |
| 状态归属 | 一个受管进程持有全部可变程序状态 | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:40` |
| 并发运行 | 同一个 state owner 拒绝并发运行 | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:82` |
| 进程创建 | worker 进程通过 `ctx.subprocess.spawn` 创建 | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:329` |
| 进程死亡 | 运行以 `worker-exit` 失败 | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:416` |
| 终止 | `terminate()` 是幂等的，并复用一个共享 promise | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:251` |
| 管道排空 | 终止同时等待命令的结果与受管范围变空 | `packages/ptc-runtime/ptc-runtime-node/src/output-stream.ts:38` |

最后一行正是 PTC 继承其回收保证的确切原因。`packages/ptc-runtime/ptc-runtime-node/src/output-stream.ts:43` 同时等待 `handle.done` 与 `handle.waitForExit()`，而 `waitForExit` 等待整个受管范围变空，而不只是等到被启动的命令报告其结果（`packages/subprocess/subprocess/src/types.ts:195`）。containment 与静止性来自 subprocess 接缝；PTC 只负责把一次崩溃表达成可判定的 `error.kind === 'worker-exit'`。

## Subagent

`packages/subagent/subagent/src/index.ts:194` 是该运行时，它是最像测试 worker、却不是测试 worker 的那个设施。

| 属性 | 取值 | 证据 |
|---|---|---|
| 存活子代上限 | 默认 8 | `packages/subagent/subagent/src/index.ts:197` |
| 委派深度 | 默认 1 | `packages/subagent/subagent/src/index.ts:196` |
| 启动要求 | 父 agent 必须是当前在该 id 下注册的确切实时 agent，否则调用抛出 `UNAUTHORIZED` | `packages/subagent/subagent/src/index.ts:275` |
| `interrupt()` | 发出即返回：取消信号在调用返回之前发出，但目标可能继续运行直到它观察到该信号 | `packages/subagent/subagent/src/index.ts:392` |
| `drainDescendants()` | 关闭准入并停止所选 subagent 树中的全部实例，然后等待待决的启动与清理 | `packages/subagent/subagent/src/index.ts:404` |

容量是共享的，不是按父级分配的。`packages/subagent/subagent/src/activation.ts:14` 声明该池是 subagent 树每个成员共享的进程内容量，而 `packages/subagent/subagent/src/manager.ts:791` 为每个树根保留一个池。超出它是拒绝而不是排队：`packages/subagent/subagent/src/activation.ts:23` 在池满时抛出 `ACTIVATION_LIMIT_REACHED`。树根拥有这份共享容量（`packages/subagent/subagent/src/activation.ts:51`）。

子代的 stop reason 来自它自己的日志。`packages/subagent/subagent/src/lifecycle.ts:81` 折叠该 epoch 自己的 session 事件来判定它，而 `packages/subagent/subagent/src/lifecycle.ts:104` 对无法命名的原因返回 `error`——因为把无法命名的原因当成成功就会把失败的工作报告成完成。若改为从拆卸路径推导原因，同样的失败就会被报告成完成。

## 确定性测试执行器应当复用什么

### 为什么 PTC 不合适

PTC 是为可能行为失常的模型编写程序而建的。`packages/ptc-runtime/ptc-runtime/src/index.ts:106` 要求实现把程序当作敌意对等者。它的失败语义是自纠错式的：失败消息被写成可以回喂给模型的形式（`packages/ptc-runtime/ptc-runtime/src/types.ts:153`）。而同一个 state owner 拒绝并发运行（`packages/ptc-runtime/ptc-runtime-node/src/worker.ts:82`），这是一个并行用例的测试套件必然要去对抗的约束。确定性执行器需要的恰恰相反：失败是一个可被断言的结果，而不是一条自我纠正的提示。

### 为什么 Jobs 不合适

归属 job 需要一个存活的 owner Agent：`packages/jobs/jobs/src/types.ts:186` 陈述 owner 的实时 Agent 必须是当前在该 id 下注册的那一个，而 `packages/jobs/jobs-local/src/index.ts:372` 在 session 没有存活实例时以 `JOB_OWNER_NOT_LIVE` 拒绝。状态机有五个取值，没有为逐用例结果留出空间（`packages/jobs/jobs/src/view.ts:19`）。并发上限是每个 owner 10 个活跃 job（`packages/jobs/jobs-local/src/index.ts:34`），这把并行套件限制在一个与套件自身方案无关的数字上。而 `start` 在没有已挂载的 job controller 服务该 owner 时拒绝工作（`packages/jobs/jobs/src/index.ts:73`），这把测试运行器的组装与一个面向模型的 controller 绑在一起。

### 为什么 Workflow 不合适

workflow 脚本的每一步都是一次 `agent()` 调用（`packages/workflow/workflow-ptc/src/runtime.ts:86`），因此一次 workflow 运行要为本来确定性的工作付出模型轮次的代价。父 Agent 是强制的（`packages/workflow/workflow/src/runtime-types.ts:31`），而单个子代失败会塌缩为 `null`（`packages/workflow/workflow-ptc/src/runtime.ts:221`）——这与"测试失败必须可区分"的要求直接冲突。

### 为什么 Subagent 不合适

subagent 就是另一个 Agent（`packages/subagent/subagent/src/index.ts:194`）。它跑一整个模型轮次，它需要确切的实时父 agent（`packages/subagent/subagent/src/index.ts:275`），而它的容量是一种共享式的拒绝而不是排程（`packages/subagent/subagent/src/activation.ts:23`）。一个必须产出确定性断言的测试用例不能是一个模型轮次。

### 应当复用什么：`ctx.subprocess`

subprocess 接缝是唯一契约与确定性 worker 匹配的设施。

| 属性 | 陈述 | 证据 |
|---|---|---|
| Agent 概念 | 没有；启动 spec 携带 argv、cwd、stdio、宽限期、信号与环境 | `packages/subprocess/subprocess/src/types.ts:77` |
| 终止 | `terminate()` 是幂等的，在受管范围消失后是空操作，并且也会由 spec 的中止信号触发 | `packages/subprocess/subprocess/src/types.ts:187` |
| 静止性 | `waitForExit()` 等待整个受管范围变空，因此存活下来的工作仍可被观察 | `packages/subprocess/subprocess/src/types.ts:195` |
| containment | 三档，每次启动时选取，最弱的一档会附带明确警告并指明缺口 | `packages/subprocess/subprocess-local/src/index.ts:250` |

containment 分档对"运行结束时浏览器已关闭"这类承诺很重要。在最弱的一档上，逃出进程组或直接父子树的子孙不被保证终止（`packages/subprocess/subprocess-local/src/index.ts:288`）。

## 审批与后台 worker

`ctx.subprocess` 没有 Agent 概念，因此后台执行单元不需要实时 Agent。这既是好消息，也是约束的来源：审批接缝是按 agent 分域的，因此一个不是 agent 的 worker 无法发问。

| 规则 | 对 TestPilot 的推论 | 证据 |
|---|---|---|
| 审批在发起方 Agent 的轮次内授予 | 没有开启的轮次时请求会被拒绝，因此决定必须在工作进入后台之前做出；worker 只执行已获批的动作 | `packages/interaction/user-approval/src/index.ts:244` |
| 需要新审批的 worker 必须回传给实时 Agent | Jobs 的完成通知通道正是这个模式：一条用户消息投递到 owner 的收件箱 | `packages/jobs/tool-jobs/src/index.ts:384` |
| 投递方式 | `followup` 唤醒空闲的驱动；`inject` 只把上下文入队等待下一个 step，不唤醒 | `packages/core/agent/src/runtime-types.ts:252` |
| 确定性策略 | `ApprovalPolicy = 'never'`；每一次询问都以确定性的 `rejected` 落定，不涉及任何 answerer | `packages/interaction/user-approval/src/index.ts:64` |
| 决定的位置 | 在服务内部、任何派发之前，因此监听器无法改变结果顺序 | `packages/interaction/user-approval/src/index.ts:296` |

对一个 CI 形态的运行来说，`never` 策略是正确选择，理由有三条，且都由源码陈述而非暗示。它在服务内部决定，因此结果不依赖于是否组合了任何 answerer。它在任何派发之前决定，因此注册顺序无法改变结果。而且它是确定性的，因此一次测试运行不会因为当时是否有人在场而分支。

worker 仍然需要向上报告的能力。Jobs 的完成通知就是这个模式的范本：生产者的结果变成一条用户消息，被投递到 owner 的收件箱——owner 空闲时作为唤醒（`packages/jobs/tool-jobs/src/index.ts:398`），否则作为入队的注入。

## 延伸阅读

- [Session、工具与 worker 生命周期审计](session-tool-lifecycle-audit.zh.md) —— agent 归属，以及 subprocess 接缝提供的 worker 生命周期。
- [存储、持久化与迁移审计](storage-persistence-audit.zh.md) —— 一次测试运行的记录落在哪里，以及它们如何演进。
- [阶段 0 验收](phase-0-acceptance.zh.md) —— 验收标准与尚未解除的阻塞项。
