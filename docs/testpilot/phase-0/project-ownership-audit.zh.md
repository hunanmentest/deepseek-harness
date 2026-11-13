# TestPilot 阶段 0 — 项目归属审计

[English](project-ownership-audit.md) | 中文

本审计回答 TestPilot 的一个问题：测试项目应归属何处，安装身份是什么，远程调用者如何被允许访问某个项目。它覆盖阶段 0 计划的 A10 工作包，且只读取本仓库中的代码。每条结论都带文件路径与行号。

## Workspace 身份

Workspace 是一个已存在目录之上的稳定 id。该 id 是生成的 uuid，绝不是路径，因为路径规范化会改写路径，而引用锚点必须保持稳定（`packages/workspace/workspace/src/types.ts:16`）。

| 属性 | 规则 | 证据 |
|---|---|---|
| 身份 | 生成的 uuid，绝不是路径 | `packages/workspace/workspace/src/types.ts:16` |
| 路径 | 创建时给定路径的 `fs.realpath` 规范形式；尾部斜杠、`..` 与符号链接均被解析 | `packages/workspace/workspace/src/types.ts:73-78` |
| 路径生命周期 | 此后永不重写，即使该目录消失 | `packages/workspace/workspace/src/types.ts:73-78` |
| 标题 | 默认为路径最后一段；允许重复 | `packages/workspace/workspace/src/types.ts:80` |
| Session 账本 | `SessionId` 的有序候选账本，读取时同步过滤 | `packages/workspace/workspace/src/types.ts:89-100` |

路径校验分三层，同一套规范形式服务全部三层。

| 规则 | 细节 | 证据 |
|---|---|---|
| 仅接受全限定路径 | 相对路径在 `realpath` 得以按 Host cwd 或当前 Windows 盘符解析之前即被拒绝 | `packages/workspace/workspace/src/paths.ts:16-23` |
| 唯一规范判据 | 唯一性是规范化路径字符串相等，因此指向既有 Workspace 目录的符号链接会冲突 | `packages/workspace/workspace/src/paths.ts:39-51` |
| 规范化 | `realpathNormalize` 是唯一实现，挂载时的 session `cwd` 校验也走它 | `packages/workspace/workspace/src/paths.ts:52-57` |

## 注册表

持久化注册表是 storage domain 记录，而不是文件树。

| 元素 | 内容 | 证据 |
|---|---|---|
| 记录 schema | `path`、`title`、`sessionIds` 与两个 ISO-8601 时间戳；`path` 是创建时打下的规范形式 | `packages/workspace/workspace/src/spec.ts:24-30` |
| 全局状态 | `workspaceIds` 是权威显示顺序；`archivedSessionIds` 与 `pinnedSessionIds` 是叠加在 Workspace 记账之上的注册表全局集合 | `packages/workspace/workspace/src/spec.ts:57-65` |
| domain spec | `defineDomain`，一张 `workspaces` 表加引导/顺序单例，版本为 2 | `packages/workspace/workspace/src/spec.ts:76-84` |
| 必需依赖 | 注册表注入 `storageDomain` 与 `sessionPersistence`；持久化依赖是强制的，因此不可用的对端绝不会被误判为空历史 | `packages/workspace/workspace/src/index.ts:186-187` |

创建流程是规范化、校验、再复用。

| 步骤 | 规则 | 证据 |
|---|---|---|
| 规范化 | 给定路径先经过 `realpathNormalize` | `packages/workspace/workspace/src/index.ts:254-255` |
| 必须已存在 | 不是已存在目录的路径被拒绝 | `packages/workspace/workspace/src/index.ts:256-258` |
| 幂等复用 | 对同一规范路径的重复调用返回既有实体，且不改变其标题 | `packages/workspace/workspace/src/index.ts:238-244` |

启动期从持久化 session header 反向重建注册表。

| 步骤 | 规则 | 证据 |
|---|---|---|
| 反向分组 | 持久化 header 按规范路径分组，每组成为一个 Workspace，最新的 session 在前 | `packages/workspace/workspace/src/index.ts:672-764` |
| 回收 | 路径匹配某一分组的既有 Workspace 吸收其中尚未记账的历史 session | `packages/workspace/workspace/src/index.ts:719-735` |
| 顺序 | 全局顺序按分组最新活动时间重建，并以先前顺序作为次级判据 | `packages/workspace/workspace/src/index.ts:737-757` |

## one-owner 不变量

两条规则在启动期被强制执行，这也是测试项目不能只是另一种 session 条目的原因。

| 规则 | 失败后果 | 证据 |
|---|---|---|
| 一个路径一个 Workspace | 同一规范路径被两个 Workspace 认领即视为 domain 不一致，中止启动 | `packages/workspace/workspace/src/index.ts:785-795` |
| 一个 session 一个 Workspace | 同一 session 被两个 Workspace 记账即视为 domain 不一致，中止启动 | `packages/workspace/workspace/src/index.ts:796-805` |

Session 成员资格由 session 自身的 header 决定，而不是由 Workspace 的意愿决定。

| 规则 | 细节 | 证据 |
|---|---|---|
| 候选过滤 | 读取 `sessionIds` 时按 canonical-cwd 索引同步过滤；被过滤的候选永不返回，且该改动不持久化 | `packages/workspace/workspace/src/entity.ts:102-104` |
| 挂载校验 | 新 session 的 header `cwd` 必须解析为已存在目录，且其 realpath 等于 Workspace 路径，否则挂载拒绝且不写入 | `packages/workspace/workspace/src/entity.ts:110-150` |
| 拒绝原因 | header 缺 `cwd`、`cwd` 无法解析、`cwd` 不是目录，是三种彼此不同的拒绝 | `packages/workspace/workspace/src/entity.ts:116-144` |

## 归档准入

归档 session 前先询问组合出的 provider，因此正在运行的 turn 不会因归档而变成孤儿。

| 事件 | 模式与用途 | 证据 |
|---|---|---|
| `workspace/session-activity` | waterfall。监听器把自己的活动条目前置；注册表最内层回调返回空列表，任何非空结果都拒绝归档且不写入 | `packages/workspace/workspace/src/index.ts:129-132` |
| `workspace/session-stop` | parallel。通过用户自己停止所用的同一取消路径，取消该 session 正在运行的工作 | `packages/workspace/workspace/src/index.ts:147` |
| `workspace/session-archived` | parallel。在持久化归档与停止请求之后准入后续工作 | `packages/workspace/workspace/src/index.ts:156` |
| `workspace/session-unarchiving` | parallel。在 session 重新可用之前取消或了结归档后续工作 | `packages/workspace/workspace/src/index.ts:163` |

活动词汇表是一个空的可扩展联合。本包不声明任何族；每个 provider 从其 Host 面与 Client 面共同导入的模块中合并自己的 key，因此消费者看到的恰好是它所编译出的 key（`packages/workspace/workspace/src/types.ts:30-42`）。

## 匿名安装身份

匿名 user id 是一个随机 uuid，以裸行形式持久化在由 `resolveDshHome`（`$DSH_HOME` > `~/.dsh`）解析出的 harness home 中的 `.anonymous-user-id` 里。

| 属性 | 规则 | 证据 |
|---|---|---|
| 作用域 | 作用域是 harness home 而非机器：共享同一个 `$DSH_HOME` 的每个进程都上报同一个 id，删除该文件会在下次启动时铸出一个全新身份 | `packages/identity/anonymous-user-id/src/index.ts:5-9` |
| 派生方式 | 绝不从主机名、网络地址、git remote 或任何其他可识别来源派生 | `packages/identity/anonymous-user-id/src/index.ts:5-9` |
| 文件格式 | 一个名为 `.anonymous-user-id` 的文件，保存一行裸 UUID，无包装格式 | `packages/identity/anonymous-user-id/src/index.ts:29`、`packages/identity/anonymous-user-id/src/index.ts:31` |
| 记忆化 | 结果按解析后的文件路径记忆化，因此一个进程只触碰磁盘一次 | `packages/identity/anonymous-user-id/src/index.ts:42`、`packages/identity/anonymous-user-id/src/index.ts:98` |
| 并发首次启动 | 文件以独占 `wx` 标志创建；失败方重读胜出方的 id | `packages/identity/anonymous-user-id/src/index.ts:68-99` |
| 写入失败 | 持久化是尽力而为：写入失败仍返回可用 id，因此 feedback 与 telemetry 永不被阻塞 | `packages/identity/anonymous-user-id/src/index.ts:81-96` |

**结论。** 匿名 id 是用于 telemetry 与 feedback 的标识。它不是授权凭据：它不携带密钥，能读取 harness home 的任何一方都能读到它，且 Remote 访问路径中没有任何环节查询它。

## Remote 访问

访问判定同时是方法级与资源级的。

| 元素 | 规则 | 证据 |
|---|---|---|
| 动作形态 | 方法级动作是规范化的 `<namespace>/<method>` 端点 | `packages/api/remote-access/src/types.ts:22-26` |
| 资源形态 | 资源级判定给出一个 kind 与一个 id | `packages/api/remote-access/src/types.ts:59-67` |
| owner | owner principal 永远被允许，`remoteAccess/follow` 动作同样被允许，每个 Peer 用它读取自己的快照 | `packages/api/remote-access/src/index.ts:202` |
| 无策略 | 未注册策略的 principal kind 被拒绝，理由为 `no-allow` | `packages/api/remote-access/src/index.ts:203-204` |
| 策略失败 | 当 `bindings()`、某个条件或 `explain()` 抛错时，判定为 `policy-failed`，每条策略只记录一次，直到下一次 `invalidate()` | `packages/api/remote-access/src/index.ts:205-206`、`packages/api/remote-access/src/index.ts:379-385` |
| 注册 | 每个非 owner principal kind 恰好一条策略；为同一 kind 二次注册会抛错 | `packages/api/remote-access/src/index.ts:153-166` |
| 列表过滤 | Remote 方法通过 `allows()` 过滤自身结果项，每次检查都重新读取策略的绑定 | `packages/api/remote-access/src/index.ts:235-244` |
| 快照 | 页面基线加上每次失效后的 `upsert` 与 `remove` 帧流 | `packages/api/remote-access/src/index.ts:269-299` |
| 页面注入 | 页面所对话的 Peer 的访问快照被注入每一个渲染出的 index | `packages/api/remote-access/src/index.ts:138-142` |
| 策略约定 | 业务侧策略的每个成员都同步作答，来源是业务包在内存中持有的状态 | `packages/api/remote-access/src/types.ts:89-104` |
| 帧类型 | 一个 generation 以一个基线开启；owner 基线是其 generation 的唯一帧 | `packages/api/remote-access/src/types.ts:138-143` |

Gateway 强制这两步检查的顺序。访问先于 lookup 解析，因此被拒绝的调用不会激活任何东西：receiver context 不被解析，参数不被解码以分发，service 不被触碰（`packages/api/gateway/src/index.ts:802-826`）。

## TestProject 应归属何处

**TestProject 应挂在 Workspace 之下，以 `workspaceId` 作为归属外键。**它不应是新的顶层容器。

| 理由 | 细节 | 证据 |
|---|---|---|
| Workspace 已经是目录容器 | Workspace 是已存在目录之上的稳定 id，该目录路径是此目录的唯一规范形式 | `packages/workspace/workspace/src/types.ts:62-78` |
| 仓库的归属模型是「资源种类 + id」 | Workspace controller 注册 `workspace` 作为 Typert 资源种类并带 `workspaceId` 线上字段，其他 controller 对各自种类亦然 | `packages/api/workspace-controller/src/index.ts:73` |
| 嵌套由外键表达 | 注册表自身的 schema 把 `sessionIds` 放在 Workspace 记录内部，而不是把 Workspace 记录嵌套进 Session 记录 | `packages/workspace/workspace/src/spec.ts:24-30` |

**TestProject 不是 Session，不得塞进 `workspace.sessionIds`。**

| 理由 | 细节 | 证据 |
|---|---|---|
| 该字段的类型面向 session | `sessionIds` 是 `readonly SessionId[]` | `packages/workspace/workspace/src/types.ts:100` |
| 该字段是候选账本 | 它是 session 的有序候选账本，读取时同步过滤 | `packages/workspace/workspace/src/types.ts:89-100` |
| 成员资格读取 session header | 挂载校验比较 session header 的 `cwd` realpath 与 Workspace 路径，因此非 session 记录永远无法满足它 | `packages/workspace/workspace/src/entity.ts:110-150` |
| 该不变量在启动期强制 | 同一 session 被两个 Workspace 记账会中止启动，因此同一 id 的第二个所有者是硬失败，而非可容忍的状态 | `packages/workspace/workspace/src/index.ts:796-805` |

**建议形态。** TestProject 是自己的域记录，自带表，每条记录携带 `workspaceId: WorkspaceId` 外键。

```ts
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

interface TestProjectRecord {
  workspaceId: WorkspaceId
  path: string
  title: string
  createdAt: string
}
```

归属校验是一条用 Workspace 已经使用的同一套规范形式表达的路径包含规则：项目目录必须规范化为位于所属 Workspace 规范路径之下的路径。比较双方使用同一个 `realpathNormalize`，因此从 Workspace 目录逃逸的符号链接，会以与 Workspace 唯一性校验相同的方式失败（`packages/workspace/workspace/src/paths.ts:52-57`）。

## 项目之间的访问隔离

项目之间的隔离不是项目记录的属性，而是由两个已经存在的机制强制执行。

| 机制 | 隔离方式 | 证据 |
|---|---|---|
| 资源级判定 | 仅当在列出的每个资源上，该 principal 策略的某个绑定都指名该资源、其 role 列出该动作、且无条件或条件允许时，非 owner 调用才被允许 | `packages/api/remote-access/src/index.ts:186-222` |
| 先授权后解析 | Gateway 在解析任何 lookup 参数或 receiver context 之前先判定访问，因此针对某个项目被拒绝的调用不会激活任何能触及另一个项目的东西 | `packages/api/gateway/src/index.ts:802-826` |

因此 TestPilot 有一项具体义务：它必须注册自己的资源种类与自己的策略，因为没有策略的种类对每个非 owner principal 都会被以 `no-allow` 拒绝（`packages/api/remote-access/src/index.ts:203-204`）。Workspace controller 自己的 `follow` 流展示了形态：它通过 `access.allows()` 过滤所交付 Workspace 内的 Workspace 与 Session（`packages/api/workspace-controller/src/index.ts:205-260`）。

## TestPilot 不可假定的事项

| 假定 | 状态 |
|---|---|
| Workspace id 就是它的路径 | 否；id 是生成的 uuid，路径是另一个不可变的规范形式（`packages/workspace/workspace/src/types.ts:16`） |
| 项目可以存在于其 Workspace 目录之外 | 在建议规则下否；包含关系以同一套规范形式校验（`packages/workspace/workspace/src/paths.ts:52-57`） |
| 项目可以被加入 `workspace.sessionIds` | 否；该字段是类型为 `SessionId[]` 的 session 候选账本（`packages/workspace/workspace/src/types.ts:100`） |
| 匿名 user id 为访问控制标识安装实例 | 否；它是 telemetry 与 feedback 的标签，既无密钥也不承担访问角色（`packages/identity/anonymous-user-id/src/index.ts:5-9`） |
| 新资源种类在没有策略时也能工作 | 否；没有策略时每个非 owner 对它的调用都以 `no-allow` 被拒（`packages/api/remote-access/src/index.ts:203-204`） |
| 归档 session 总是成功 | 否；非空的活动结果拒绝归档且不写入（`packages/workspace/workspace/src/index.ts:129-132`） |
| 同一 session id 的第二个所有者可被容忍 | 否；该不一致会中止启动（`packages/workspace/workspace/src/index.ts:796-805`） |

## 进一步探索

- [阶段 0 验收](phase-0-acceptance.zh.md) —— 验收标准与未决阻塞项。
- [存储与持久化审计](storage-persistence-audit.zh.md) —— TestProject 记录将落入的 storage domain 层。
- [Web 平台集成审计](web-platform-integration-audit.zh.md) —— 项目如何抵达远程调用者。
