# TestPilot 阶段 0 —— 存储、持久化与迁移审计

[English](storage-persistence-audit.md) | 中文

本审计记录 TestPilot 的记录可以落在哪里、harness 对它作出什么保证、以及哪些部分必须由 TestPilot 自己补齐。内容覆盖存储 hub、domain 数据形式、JSON 与 SQLite 两个后端、session 事件日志以及附件存储。每条结论都带有文件路径与行号。

## 范围与结论

| 问题 | 答案 |
|---|---|
| harness 是否已经有 TestProject、TestPlan、TestCase、TestRun、TestResult 的持久归属？ | 有：存储 hub 加 domain 数据形式，并附带两个已发布的后端。 |
| domain record 自身是否带版本字段？ | 不带。domain 携带的是单元级版本戳，而且没有值迁移运行器。 |
| session 日志能否替代 domain？ | 不能。session 日志是追加式事件流，没有权威内存状态，也没有变更事件。 |
| 两个进程能否写同一个 domain？ | 不能安全地写。存储层没有跨进程写所有权；session 层才有。 |
| 存储层会自行回收任何东西吗？ | 不会。保留与回收是 TestPilot 自己的责任。 |
| 一次运行是 session 事件吗？ | 不是。一次运行比启动它的 agent 活得更久，且必须在所有 agent 消失之后仍可被检索。 |

## 存储 hub

`packages/storage/storage/src/index.ts:1` 在第一段陈述了 hub 自身的契约：它是一个具名后端注册表加上已挂载的数据形式设施，hub 自身不做 IO——介质由后端拥有，语义由数据形式拥有。

| 公开成员 | 用途 | 证据 |
|---|---|---|
| `ctx.storage.backend` | 具名后端表；多个后端并排挂载 | `packages/storage/storage/src/index.ts:49` |
| `ctx.storage.mount(form, facility)` | 挂载一个数据形式，并返回卸载它的 disposer | `packages/storage/storage/src/index.ts:64` |
| `ctx.storage.form(form)` | 解析一个已挂载的数据形式；缺失时抛出 `form-not-mounted` | `packages/storage/storage/src/index.ts:82` |
| `ctx.storage.domain` | domain 数据形式，在 domain 层插件加载后出现 | `packages/storage/storage/src/index.ts:90` |

路由不在 hub 里。`packages/storage/storage/src/registry.ts:9` 说明哪个后端服务哪个消费方是消费方自己的配置——domain 层的路由表——绝不是 hub 全局的选择。因此 hub 只持有两张表、没有任何策略：名字到后端，以及形式名到设施。

后端注册是一个 effect，而不是自带生命周期的状态变更。`packages/storage/storage/src/registry.ts:25` 返回移除名字的 disposer，并且该 disposer 带守卫，使得重新注册之后迟到的 disposer 不会移除继任者。释放并不关闭后端；拥有它的插件在注销之后才关闭它。

面向后端的单元描述符承载版本策略。`packages/storage/storage/src/backend.ts:47` 声明了它。

| 字段 | 含义 | 证据 |
|---|---|---|
| `version` | 当前单元格式版本，在初次物化与后续变更时打戳 | `packages/storage/storage/src/backend.ts:51` |
| `compatibleVersions` | 所有者担保其存储记录在当前 schema 下仍可读的较旧单元版本 | `packages/storage/storage/src/backend.ts:75` |
| `layout` | `single` 把整个单元放在一个文档里；`per-record` 把每条记录放在自己的文档里 | `packages/storage/storage/src/backend.ts:64` |

`packages/storage/storage/src/backend.ts:56` 解释了 `per-record` 为何存在：记录很大或很稀疏的单元不会因为一次写入而重写其余部分，并且一份不被接受的文档读作缺失，而不是让整个单元拒绝。

hub 的错误词汇是一组封闭的八个代码（`packages/storage/storage/src/error.ts:7`）：`backend-not-found`、`form-not-mounted`、`duplicate-backend`、`duplicate-mount`、`version-mismatch`、`malformed-medium`、`unknown-state` 与 `closed`。`unknown-state` 是唯一改变控制流的：它意味着单元的可读状态或持久状态已不再可知，因此该单元之后的每个操作都拒绝，直到它被关闭（`packages/storage/storage/src/backend.ts:122`）。

## 存储 domain

### 声明一个 domain

`packages/storage/storage-domain/src/spec.ts:1` 陈述了整个层所依赖的规则：spec 对象是一个 domain 的身份、布局与记录 schema 的唯一来源，而记录 schema 是 zod。`defineDomain` 固定字面量类型并校验字段（`packages/storage/storage-domain/src/spec.ts:107`），因此配置错误的 domain 会在拥有包的模块加载时大声失败，早于任何介质被触碰。

| 字段 | 含义 | 证据 |
|---|---|---|
| `name` | domain 名；必须匹配 `UNIT_NAME_RE`，同时充当后端单元名 | `packages/storage/storage-domain/src/spec.ts:37` |
| `version` | 当前 domain 格式版本；读取按所选布局强制执行它 | `packages/storage/storage-domain/src/spec.ts:39` |
| `layout` | `single` 或 `per-record` | `packages/storage/storage-domain/src/spec.ts:47` |
| `compatibleVersions` | 当前记录 schema 同样接受的较旧 domain 版本 | `packages/storage/storage-domain/src/spec.ts:56` |
| `invalidRecords` | `backup-and-skip`，仅用于记录属于可丢弃派生数据的 domain | `packages/storage/storage-domain/src/spec.ts:67` |
| `global` | 可选的全局单例槽，带其 schema 与首次写入前的取值 | `packages/storage/storage-domain/src/spec.ts:69` |
| `tables` | 以表名为键的表声明 | `packages/storage/storage-domain/src/spec.ts:71` |

`domainTable<K, V>(schema)` 声明一张表，并附带一个幻影编译期键类型（`packages/storage/storage-domain/src/spec.ts:91`）。该键类型在运行时并不存在；键在介质上就是普通字符串。

有四项校验在加载时触发，每一项都有其理由。

| 校验 | 规则 | 证据 |
|---|---|---|
| version | 必须是非负整数 | `packages/storage/storage-domain/src/spec.ts:111` |
| `compatibleVersions` | 每一项都必须是非负整数且严格小于当前 version | `packages/storage/storage-domain/src/spec.ts:114` |
| global schema | 不得接受 `null`，因为 `null` 是介质的"从未写入"哨兵值，存下的 `null` 无法往返 | `packages/storage/storage-domain/src/spec.ts:140` |
| `invalidRecords` | 只接受 `backup-and-skip`，且只用于可丢弃派生数据；默认是整个打开拒绝 | `packages/storage/storage-domain/src/spec.ts:57` |

`backup-and-skip` 路径会把出问题记录的文档挪到一边、带其 cause 记录具体失败，然后以该记录缺失继续（`packages/storage/storage-domain/src/index.ts:131`）。没有文档可挪的后端退回拒绝的默认行为，全局槽始终拒绝。

### 写链及其顺序

`packages/storage/storage-domain/src/domain.ts:1` 陈述了让这一层可作为持久记录存储使用的顺序契约：每次写入都排入该 domain 唯一的链，先等待后端持久化，再修改内存，然后发出 `domain/changed`。被拒绝的后端写入不改变内存，因此读取永远不会与介质不一致。链本身是一个 promise 尾巴（`packages/storage/storage-domain/src/domain.ts:167`）。

| 原语 | 语义 | 证据 |
|---|---|---|
| `put(key, value)` | 覆写；值就是完整的新记录，不做局部合并 | `packages/storage/storage-domain/src/domain.ts:340` |
| `delete(key)` | 记录曾存在时解析为 `true`，本来就不存在时为 `false`；缺失的情形不写入也不发事件 | `packages/storage/storage-domain/src/domain.ts:348` |
| `deleteMany(keys)` | 写链上的一个作业、一次后端调用；解析为确实存在并被移除的键数 | `packages/storage/storage-domain/src/domain.ts:360` |
| `update(key, fn)` | 原子读改写；`fn` 看到的是它所在队列槽位当时的值，键缺失时以 `missing-key` 拒绝 | `packages/storage/storage-domain/src/domain.ts:375` |
| `close()` | 立即拒绝新写入，排空已排队的写入（其事件仍会发出），释放后端单元，然后释放 domain 名字 | `packages/storage/storage-domain/src/domain.ts:251` |

两种失败模式被刻意区分。普通的后端拒绝不改变内存，因此该 domain 仍可用。而报告 `unknown-state` 的后端会隔离整个 domain：读取与后续写入都以该错误拒绝，只有 `close()` 仍然可用（`packages/storage/storage-domain/src/domain.ts:283`、`packages/storage/storage-domain/src/domain.ts:303`）。隔离是按 domain 而非按表生效的。

### 变更事件与错误

`packages/storage/storage-domain/src/events.ts:11` 定义变更载荷，`packages/storage/storage-domain/src/events.ts:34` 以操作判别式把它收敛为联合类型。

| 字段 | 含义 | 证据 |
|---|---|---|
| `domain` | 所属 domain 名 | `packages/storage/storage-domain/src/events.ts:13` |
| `table` | 表名；全局单例写入为 `''` | `packages/storage/storage-domain/src/events.ts:15` |
| `key` | 记录键；全局单例写入为 `''` | `packages/storage/storage-domain/src/events.ts:17` |
| `operation` | `put` 或 `deleted`；没有其他取值 | `packages/storage/storage-domain/src/events.ts:22` |
| `value` | `put` 时为新的快照；删除时不存在 | `packages/storage/storage-domain/src/events.ts:24` |

该事件从不携带旧值。做差分的消费方要自己保留上一份快照，因为载荷是发出时刻的新状态，而不是增量。

domain 错误词汇有五个代码（`packages/storage/storage-domain/src/error.ts:7`）：`already-open`、`facet-unsupported`、`invalid-record`、`missing-key` 与 `closed`。`invalid-record` 是唯一携带位置的错误，而该位置指明出问题的表与键（`packages/storage/storage-domain/src/error.ts:15`）。后端失败原样透传：`packages/storage/storage-domain/src/error.ts:29` 陈述 domain 层不重新包装它们，因此消费方仍可直接对 `version-mismatch` 或 `unknown-state` 做分支。

### 打开一个 domain

`packages/storage/storage-domain/src/index.ts:103` 是打开序列，每一步失败都会让整个调用失败。

| 步骤 | 失败代码 | 证据 |
|---|---|---|
| 名字已被打开或已被保留 | `already-open` | `packages/storage/storage-domain/src/index.ts:104` |
| 解析出的后端名未注册 | `backend-not-found`，由 hub 透传 | `packages/storage/storage-domain/src/index.ts:110` |
| 被路由的后端没有 `kv` facet | `facet-unsupported` | `packages/storage/storage-domain/src/index.ts:112` |
| 单元按存下的版本戳打开 | `version-mismatch` 或 `malformed-medium`，透传 | `packages/storage/storage-domain/src/index.ts:117` |
| 某条存储记录未通过其 zod schema | `invalid-record`，带表名与键；除非 `backup-and-skip` 适用 | `packages/storage/storage-domain/src/index.ts:126` |
| 全局值未通过其 schema | 全局槽的 `invalid-record` | `packages/storage/storage-domain/src/index.ts:151` |

路由按 domain 解析，而不是全局解析：`packages/storage/storage-domain/src/index.ts:109` 读取 `this.config.routes?.[spec.name] ?? this.config.backend`，因此一份插件配置可以把一个 domain 送到 SQLite、把另一个送到 JSON 目录树。

同名 domain 的并发打开会大声失败。设施在 await 之前就保留名字（`packages/storage/storage-domain/src/index.ts:70`），并且任何失败都会无条件释放该保留（`packages/storage/storage-domain/src/index.ts:171`）。

### domain 层不提供什么

| 能力 | 状态 | 证据 |
|---|---|---|
| 跨表事务 | 缺失；每次写入只针对一张表或全局槽 | `packages/storage/storage-domain/README.md:147` |
| 二级索引 | 缺失 | `packages/storage/storage-domain/README.md:147` |
| 多段键 | 缺失 | `packages/storage/storage-domain/README.md:147` |
| 不兼容值的迁移运行器 | 缺失；`compatibleVersions` 为当前解码器接纳较旧数据，消费方在改写被选记录时转换其值 | `packages/storage/storage-domain/README.md:148` |
| 记录级版本字段 | 缺失；单元戳无法区分混合行中同名字段的不同含义 | `docs/subsystems/storage.md:100` |
| 跨进程变更推送 | 缺失；`domain/changed` 是进程内事件 | `packages/storage/storage-domain/README.md:146` |

最后两行决定了演进规程。domain record 没有自己的版本，存储层也不会替消费方重写不兼容的值。

## 两个后端

### JSON 后端是文件，不是内存

`packages/storage/storage-json/src/index.ts:1` 把该后端描述为在配置的根目录下每个单元一份人类可读文档，通过原子重写发布。根目录刻意没有默认值（`packages/storage/storage-json/src/index.ts:22`）：`process.cwd()` 的兜底会把单元文件散落到进程恰好启动的位置，所以组装必须显式声明位置。

| 布局 | 路径形状 | 键规则 | 证据 |
|---|---|---|---|
| `single` | `<root>/<name>.json` | 键保持不透明 | `packages/storage/storage-json/src/single-unit.ts:34` |
| `per-record` | `<root>/<name>/<table>/<key>.json` | 键成为路径段，必须匹配 `[a-zA-Z0-9_-]+` | `packages/storage/storage-json/src/per-record-unit.ts:57` |

发布协议是在同目录写一个临时文件、fsync 它、然后 rename 覆盖目标（`packages/storage/storage-json/src/atomic.ts:24`）。rename 在 POSIX 与 Windows 上都是原子替换，而且这里最后一次写入获胜是正确的，因为单元文件每个进程只有一个写入者。rename 之后在 POSIX 上还会 fsync 父目录，使新条目崩溃后仍然持久。

两种布局在内存里持有什么上并不相同。`single` 单元把整个单元作为权威状态留在内存里，每次写入都重写整个文件，批量删除也一样（`packages/storage/storage-json/src/single-unit.ts:77`）。`per-record` 单元自身不持有任何状态——目录就是状态——而 `loadAll` 会重新读取目录树（`packages/storage/storage-json/src/per-record-unit.ts:1`）。这一差异正是失败的 `single` 发布必须回滚内存的原因：内存是权威的，被拒绝的写入不得留在其中，也不得搭上下一次发布一起写出（`packages/storage/storage-json/src/single-unit.ts:83`、`packages/storage/storage-json/src/single-unit.ts:108`）。

版本戳在两种布局下被区别对待，这一差异是设计选择而非偶然。

| 情形 | `single` 布局 | `per-record` 布局 |
|---|---|---|
| 存下的版本戳不在接受集合内 | 整个打开以 `version-mismatch` 拒绝 | 该文档读作缺失记录 |
| 某份文档格式损坏 | 整个打开以 `malformed-medium` 拒绝 | 该文档读作缺失记录 |
| 运行期间某份文档损坏 | 不适用 | `backupRecord` 把它挪为 `<key>.json.bak.<时间戳>`，被挪的文件不再以 `.json` 结尾，因此之后每次读取都忽略它，而字节留在磁盘上 |

这三行的证据分别是 `packages/storage/storage-json/src/format.ts:66`、`packages/storage/storage-json/src/format.ts:117` 与 `packages/storage/storage-json/src/per-record-unit.ts:305`。

### SQLite 后端

`packages/storage/storage-sqlite/src/schema.ts:9` 从 `node:sqlite` 导入 `DatabaseSync`。该包内没有第三方驱动；后端运行在 Node 内置实现之上。

| 属性 | 取值 | 证据 |
|---|---|---|
| 物理布局版本 | `STORAGE_SQLITE_SCHEMA_VERSION = 1`，存放在 `PRAGMA user_version` | `packages/storage/storage-sqlite/src/schema.ts:20` |
| 与单元版本的关系 | 正交；单元自己的版本按单元打在 `units` 行里 | `packages/storage/storage-sqlite/src/schema.ts:15` |
| 物理 schema 变更 | 只做拒绝；这个未发布的格式没有迁移，因此任何其他版本戳都拒绝 | `packages/storage/storage-sqlite/src/schema.ts:18` |
| 首次写入 | 数据与版本戳在一个事务里提交 | `packages/storage/storage-sqlite/src/unit.ts:152` |
| 回滚也失败 | 单元报告 `unknown-state`，后端必须关闭并重新打开 | `packages/storage/storage-sqlite/src/unit.ts:160` |
| 日志模式 | 默认 `wal`；`memory` 与 `off` 被排除，因为它们放弃了日志持久性 | `packages/storage/storage-sqlite/src/schema.ts:26` |
| 内存数据库 | `:memory:` 打开一个进程内数据库 | `packages/storage/storage-sqlite/src/index.ts:26` |

两个版本戳回答不同的问题，混淆它们是常见错误。`PRAGMA user_version` 描述数据库文件的表布局。`units.version` 列描述一个单元的记录格式。提升单元版本不要求新的物理布局，而新的物理布局也不改变任何单元记录的读法。

### 后端对比

| 问题 | JSON 后端 | SQLite 后端 |
|---|---|---|
| 介质是什么 | 一个文件树根目录，每个单元一份文档 | 一个托管所有被路由单元的数据库文件 |
| 单元版本放在哪里 | `single` 在文档头部，`per-record` 在每份记录文档里 | 在 `units` 行里，与 `PRAGMA user_version` 物理戳并列 |
| 不被接受的版本会怎样 | `single` 以 `version-mismatch` 拒绝；`per-record` 把该文档读作缺失 | 该单元以 `version-mismatch` 拒绝 |
| 一次写入如何发布 | 一次原子整文件替换 | 每次写入或批量一个事务 |
| 发布失败留下什么 | 上一个文件，除非在替换之后到达的目录 fsync 失败 | 上一次的数据与版本戳，除非回滚本身失败 |
| 跨进程写所有权 | 除调用方自备之外没有 | SQLite 自身的文件锁 |
| 对 TestPilot 最合适的用途 | 人类可读的方案树与逐记录的结果树 | 一个文件同时承载方案与运行历史 |

最后一行是判断，不是来自源码的事实。真正的区分事实是：`per-record` 的一次写入只重写一份文档而非整个单元，而 SQLite 把写入与它的版本戳一起提交。

## Session 持久化与版本链

session 日志是 harness 里另一个持久存储，它与 domain 层的形状不同。它只追加，模型历史由 `SessionEvent` 流派生，而不是单独存储。

| 属性 | 陈述 | 证据 |
|---|---|---|
| 当前格式版本 | `SESSION_FORMAT_VERSION = 4` | `packages/core/session/src/types.ts:90` |
| 迁移形状 | 仅相邻；`to` 不等于 `from + 1` 的声明被拒绝 | `packages/session/session-format/src/chain.ts:30` |
| 链完整性 | 要求从版本 0 到当前版本存在完整的链，否则构建抛错 | `packages/session/session-format/src/chain.ts:65` |
| 更新格式的存量数据 | 拒绝；存量版本高于当前版本时拒绝 | `packages/session/session-format/src/chain.ts:81` |
| 事件日志 | 自 seq 0 起连续，且永不改写 | `packages/session/session-persistence/src/index.ts:127` |
| 撕裂尾巴 | 永不返回给读取方，并由写入路径在首次追加之前截断 | `packages/session/session-persistence/src/index.ts:128` |
| 未知词汇 | 读取只校验当前格式的记录，并以失败关闭的方式拒绝未知词汇 | `packages/session/session-persistence/src/index.ts:130` |
| 持久化屏障 | `append` 以尽力而为方式持久化；`flush`（按句柄或服务级）才是屏障 | `packages/session/session-persistence/src/index.ts:131` |
| 跨进程写所有权 | 内核级锁：POSIX 上是 `flock(2)`，Windows 上是具名内核信号量 | `packages/session/session-persistence-jsonl/src/lease.ts:3` |

该锁是这一部分 harness 里唯一的跨进程写机制。`packages/session/session-persistence-jsonl/src/lease.ts:70` 是获取路径，争用映射为 `SessionAlreadyOwnedError`。当持有者的描述符关闭时内核释放该锁，包括进程死亡的情形；这里刻意没有过期机制，因为过期可能侵占一个停滞的写入方，而它恢复后的追加会撕裂日志（`packages/session/session-persistence-jsonl/src/lease.ts:11`）。

对 TestPilot 有两点推论。必须在崩溃后存活的检查点要显式等待 `flush`；仅等待 `append` 不构成持久性主张。而必须对第二个进程可见的 domain record 不能依赖 `domain/changed`，因为那是进程内事件。

## 两个可直接照抄的先例

harness 里已经有两个"domain 改变了形状却没有迁移运行器"的实例。它们就是 TestPilot 自身演进规程的模板。

### 先例一：schedule

`packages/schedule/schedule/src/storage.ts:134` 把 schedule domain 声明为版本 2 且 `compatibleVersions: [1]`，`packages/schedule/schedule/src/storage.ts:62` 声明的版本 2 任务 schema 仍接受版本 1 的行。新的元数据在磁盘上是可选的，正常解码不写入，而下一次编辑或投递会写出当前形状。一个 schema、两个被接受的世代、一个提升过的版本戳。

### 先例二：workspace

`packages/workspace/workspace/src/spec.ts:57` 声明 workspace 的全局状态，其中两个字段带有默认值，因此在这些字段出现之前写入的记录仍然能解析（`packages/workspace/workspace/src/spec.ts:62`）。该 domain 本身声明为版本 2（`packages/workspace/workspace/src/spec.ts:76`），消费方通过 `ctx.storageDomain.open` 打开它，把它作为自己的 effect 关闭，并取得带类型的表句柄与全局句柄（`packages/workspace/workspace/src/index.ts:215`）。

workspace 也是消费方一侧契约的先例：拥有包持有打开句柄及其拆卸，而设施只关闭消费方遗留未关的 domain。

## 附件

二进制证据不属于 domain record。附件存储就是为它而存在的，并且它有自己的准入规则。

| 限额 | 默认值 | 证据 |
|---|---|---|
| 接受的媒体类型 | png、jpeg、webp、gif | `packages/attachment/attachment/src/types.ts:8` |
| 单张图片的最大编码字节数 | 50 MiB | `packages/attachment/attachment-local/src/index.ts:34` |
| 单条消息的最大图片张数 | 20 | `packages/attachment/attachment-local/src/index.ts:36` |
| 单条消息的最大图片聚合字节数 | 200 MiB | `packages/attachment/attachment-local/src/index.ts:38` |
| 单张图片的最大固有像素数 | 64,000,000 | `packages/attachment/attachment-local/src/index.ts:40` |
| 单边最大像素数 | 65,535 | `packages/attachment/attachment-local/src/index.ts:46` |
| 文件上传，任意格式 | 完全没有准入限额 | `packages/attachment/attachment/src/index.ts:210` |

限额结构本身在 `packages/attachment/attachment/src/types.ts:74`。最后一行需要 TestPilot 侧给出答案：`packages/attachment/attachment/src/index.ts:208` 陈述文件不携带任何准入限额，任意字节内容与长度都被接受，存下的对象就是提交的确切字节。因此视频录制无论多大都能通过附件层。

存在两种引用形状。`ImageAttachmentRef`（`packages/attachment/attachment/src/types.ts:11`）描述一张不可变的归一化栅格图，其媒体类型由存储的字节校验得出。`FileAttachmentRef`（`packages/attachment/attachment/src/types.ts:39`）描述一份逐字节保存的文件，其 `attachmentId` 正是那些字节的 sha256 摘要。

存储采用内容寻址的两级分片：`packages/attachment/attachment-local/src/store.ts:53` 推导出 `objects/<前两位十六进制字符>/<sha256>`。上传在存储之前先被校验，而线路形态必须是规范 base64（`packages/attachment/attachment/src/admission.ts:15`）。

## TestPilot 的记录落在哪里

### 存储选择

TestProject、TestPlan、TestCase、TestRun 与 TestResult 属于 `dsh-storage` 与 `dsh-storage-domain`，不属于 session 事件日志。两个既有消费方展示了这一决定的形状。

`packages/workspace/workspace/src/spec.ts:76` 为 workspace 注册表声明了一个 domain，`packages/workspace/workspace/src/index.ts:215` 通过 `ctx.storageDomain.open` 打开它、持有带类型的句柄、并把它作为自己的 effect 关闭。`packages/schedule/schedule/src/storage.ts:134` 声明了 schedule domain 并把它路由到某个具名后端。

session 日志是错误的归属，理由与"一次测试运行不是一个 session"相同：session 日志没有权威内存状态，它的屏障是一次显式的 `flush`，也没有可查询的变更事件。测试方案必须整体读取、逐字段改写，并在写出它的 agent 之后继续存活。

推荐的划分遵循两种已声明的布局（`packages/storage/storage/src/backend.ts:64`）。

```text
testpilot_plan   layout=single       tables: projects, plans, cases
testpilot_run    layout=per-record   tables: runs, results
```

方案域承载人工撰写的产物——小、整体读取、整体重写都很便宜。运行域承载执行产物——大、一次写一个、且可逐条丢弃，而这正是 `per-record` 存在的场景。把两者路由到不同后端是可行的且不花代价：路由表是按 domain 的（`packages/storage/storage-domain/src/index.ts:109`）。

### 演进规程

| 情形 | 做法 | 证据 |
|---|---|---|
| 新增可选字段 | 扩展同一个 schema，并给该字段一个默认值，使此前写下的记录仍能解析 | `packages/workspace/workspace/src/spec.ts:62` |
| 新增必填字段，或某字段含义改变 | 提升 `version`，把旧版本移入 `compatibleVersions`，并让当前 schema 同时接受两个世代 | `packages/schedule/schedule/src/storage.ts:135` |
| 旧读取方无法解码的变更 | 附带一个显式、可恢复的升级步骤，在新 schema 打开该单元之前运行 | `docs/subsystems/storage.md:110` |
| 删除表，或改变布局 | 需要各自的保留与升级策略；仅仅一个兼容版本戳两者都定义不了 | `docs/subsystems/storage.md:108` |

因此优先级顺序是：先可选字段加默认值，其次是版本号加 `compatibleVersions` 用于旧读取方仍能解码的变更，只有不兼容变更才走最后一条，而它必须自带一次性的、可恢复的升级步骤。由于没有迁移运行器，跳过某个版本的 domain 仍必须接受它声称支持的最旧版本戳：`docs/subsystems/storage.md:110` 陈述，接受版本戳 2 的读取方还必须接受版本戳 1，以覆盖那些完全跳过版本 2 的用户。

### 大文件

| 产物 | 引用 | 存储 | 证据 |
|---|---|---|---|
| 截图 | `ImageAttachmentRef` | 附件存储，归一化后的栅格图 | `packages/attachment/attachment/src/types.ts:11` |
| 视频录制 | `FileAttachmentRef` | 附件存储，逐字节保存 | `packages/attachment/attachment/src/types.ts:39` |
| 两者被 domain record 引用时 | 只有引用对象 | 字节留在附件存储里 | `packages/attachment/attachment/src/types.ts:34` |

domain record 存引用，从不存字节。有两个原因让这一点没有商量余地。JSON 的 `single` 布局在每次写入时重发整个文件（`packages/storage/storage-json/src/single-unit.ts:77`），因此记录里的 base64 载荷会让每次写入重写该 domain 中的每一个载荷。而附件层不强制任何文件大小限额，所以视频的配额必须由 TestPilot 自备，并在写入之前施加。

## 并发、保留与回收

| 问题 | 答案 | 证据 |
|---|---|---|
| 一个进程内两个任务写同一个 domain | 安全；每个 domain 一条写链，`update` 在其链槽位执行 | `packages/storage/storage-domain/src/domain.ts:167` |
| 两个进程写同一个 domain | 不安全；存储层没有跨进程写所有权 | `packages/storage/storage-domain/README.md:146` |
| 原子批量删除 | 可用；`deleteMany` 是写链上的一个作业、一次后端调用 | `packages/storage/storage-domain/src/domain.ts:360` |
| 存储层的保留或回收 | 缺失；单元契约没有列举、扫描、时效或保留成员 | `packages/storage/storage/src/backend.ts:88` |
| 附件层的保留或回收 | 缺失；已发布的对象可能一直不可达，直到将来的保留策略来收集它们 | `packages/attachment/attachment/src/index.ts:95` |
| 唯一相关的原语 | `backupRecord` 把一份文档挪到一边并保留其字节以供检查 | `packages/storage/storage/src/backend.ts:153` |

一次 TestPilot 运行由一个 worker 进程写入运行域，所以进程内的保证足以覆盖常见情形。两个 worker 写同一个 domain 时，需要 TestPilot 自备一把锁。这一部分 harness 里唯一的内核级写独占属于 session 层（`packages/session/session-persistence-jsonl/src/lease.ts:3`），而且它守护的是 session 制品目录，不是存储 domain。

因为两层都不回收任何东西，TestPilot 拥有整个保留故事：哪些运行可以被回收、被回收的运行释放哪些附件对象，以及对象分片让哪一部分查找变得廉价。

## 延伸阅读

- [Session、工具与 worker 生命周期审计](session-tool-lifecycle-audit.zh.md) —— agent 与 session 的归属，以及为什么一次测试运行不是一个 session。
- [后台执行审计](background-execution-audit.zh.md) —— 测试 worker 可复用与不可复用的接缝。
- [阶段 0 验收](phase-0-acceptance.zh.md) —— 验收标准与尚未解除的阻塞项。
