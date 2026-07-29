---
name: Agent 委托与调度协议
description: Muses Agent Orchestration 的父子 Run、显式上下文、服务端权限、预算、DAG、取消、结果与 Workflow SDK 边界。
---

# Agent 委托与调度协议

## 1. 地位与目标

本文是 Muses A10 Agent Orchestration 的长期协议。它定义平台级 MusesAgent、领域 Agent 和执行型 SubAgent 如何复用同一独立 Agent Core，同时防止模型获得调度器、权限系统或计费系统的权威。

协议服务 AI 设计平台，不把 Muses 扩展成通用 Coze/Dify 式 AI 应用开发平台。多 Agent 只用于将真实创作任务拆成可控、可追踪、可聚合的专业工作，例如需求梳理、视觉方向、素材研究、图像生成、版式设计和 QA。简单任务仍应由一个 AgentRun 或一个 Capability 完成。

当前 `@muses/agent-core` 已实现 `0.1.0-draft` 委派类型、纯验证器、父子 Run 血缘、Run 级逻辑沙盒重验和框架无关 Scheduler 状态机；Web 侧已实现 PostgreSQL Store、事件、claim/lease、逻辑预算预留、生产 Profile/结果/Artifact 校验、独立 Child Agent Runtime，以及 Workflow SDK 持久驱动。尚未实现的委派 Trace/Billing 血缘、固定恢复 eval、受授权的产品委派入口、生产 Skill/MCP 解析、生产多 Agent 执行和物理计算沙盒不得被描述为已经可用。

## 2. 不固定组织层级

通用内核不写死“主 Agent → 领域 Agent → Worker”三层结构。`MusesAgent` 是平台级 Profile，负责跨领域意图、澄清、计划和委托；领域 Agent 是版本化专业 Profile；SubAgent 是一次有界子 Run，而不是永久组织岗位。

同一调度协议必须支持：

- 单 Agent 直接完成；
- 一个父 Run 委托一个专业子 Run；
- 多个互不依赖的子任务并行；
- 具有明确依赖的 DAG；
- 领域 Agent 在深度限制内继续委托；
- Agent 调用已发布 WorkflowDefinition，或工作流调用版本化 Agent Profile。

模型可以提出委派计划，但 Runtime Scheduler 才拥有任务图、状态、claim/lease、并发、预算预留、重试、取消、失败隔离和结果聚合。模型生成的 JavaScript、自然语言 todo 或 Harness 内部 state 都不能成为调度权威。

## 3. 身份与血缘

一次委派树至少区分四种身份：

| 身份 | 含义 | 不能替代什么 |
| --- | --- | --- |
| `rootRunId` | 整棵委派树最初的 AgentRun | 直接父 Run |
| `delegatedByRunId` | 提交当前计划的直接父 AgentRun | 根 Run |
| `delegationRunId` | Scheduler 执行一个计划版本的运行身份 | AgentRun |
| `childRunId` | 一个任务的一次独立 AgentRun | Scheduler task/attempt |

每个子 AgentRun 固定以下父引用：

```ts
type AgentRunParentRef = {
  runId: string;
  rootRunId: string;
  delegationPlanId: string;
  delegationPlanRevision: number;
  delegationTaskId: string;
};
```

这组字段是不可变启动身份的一部分。使用同一 `childRunId` 重放启动时，任何父 Run、根 Run、计划、revision 或 task 漂移都必须冲突，不能把已有子 Run 重新挂到另一棵树。Trace 和费用沿 `rootRunId → delegatedByRunId → delegationRunId/taskId → childRunId` 关联。

## 4. 服务端权威包与模型计划

模型提交 `AgentDelegationPlan`，服务端同时生成 `AgentDelegationAuthoritySnapshot`。两者职责不能合并。

### 4.1 AuthoritySnapshot

AuthoritySnapshot 由已授权父 Run 的当前权威状态派生，至少固定：

- Workspace、Project、Session、root Run 和直接父 Run；
- 当前委派深度和服务端限制；
- 父 ContextSnapshot 的精确 version；
- 可委派权限、工具、Skill、MCP Connection 和计算能力；
- 可传递的数据分类与 Artifact 引用；
- 父 Run 当前剩余预算。

Skill、MCP、Agent Profile、用户 Prompt 和父模型都不能扩大 AuthoritySnapshot。授权集合出现空值、重复值或无效 Context version 时，提交失败关闭。

### 4.2 DelegationPlan

Plan 固定 schema、id、revision、创建时间、作用域、root/direct-parent Run、最大并发、失败模式和任务 DAG。每个任务必须声明：

- 稳定 `taskId` 与有界目标；
- 精确 `profileId + version`；
- 显式依赖；
- 显式 ContextPackage；
- 权限/工具/Skill/MCP/计算 grant；
- 独立预算；
- JSON 对象结果 Schema、最大字节数和所需证据类型。

Plan 不是 AgentRun 的可变 todo。提交后一个 Scheduler Run 固定一个 plan revision；修改计划需要新 revision 和新的提交指纹。

## 5. 显式上下文，不继承父历史

子 Agent 不隐式看见父对话、父 Harness state、父沙盒文件或整个 Project。`AgentDelegationContextPackage` 只传递服务端批准的事实和 Artifact 引用，并绑定直接父 Run 与精确 ContextSnapshot version。

验证至少拒绝：

- 来自其他 Run 或旧 Context version 的内容；
- 重复/空事实与 Artifact；
- 未授权的数据分类，例如父 Run不能转交的 restricted 数据；
- 不在服务端 Artifact 白名单内的引用；
- 超过每任务字符上限的目标、事实和引用。

子任务需要依赖任务产物时，Scheduler 在依赖完成后创建新的、可审计的 ContextPackage revision 或输入绑定；不能让子 Run读取兄弟沙盒。跨 Run 持久结果必须进入结构化 result、Artifact、Asset、Checkpoint 或经过授权的 Project 状态。

## 6. Grant 与独立沙盒

每个任务 grant 必须是 AuthoritySnapshot 的显式子集。空、重复或未授权的 permission、tool、Skill、MCP Connection 或 compute capability 均拒绝。Profile Registry 随后解析精确 Profile 版本，并再次检查其声明的工具与权限不超过任务 grant。

每个 SubAgentRun 使用独立 Run 身份和独立逻辑沙盒：

```text
filesystem namespace = agent-run/<childRunId>
scope = Workspace + Project + Session + childRunId + parentRunId
network default = deny
tool/permission set = exact task grant after Profile resolution
```

父子 Run 不共享可写 sandbox namespace。当前实现证明的是逻辑 scope、默认拒绝策略与计算沙盒 port，并不代表供应商 microVM、容器、浏览器隔离或网络防火墙已经启用。代码、CLI、浏览器、不可信文件和复杂媒体处理在正式上线前还必须接入并验证物理计算沙盒 adapter。

## 7. DAG 与 Scheduler 生命周期

提交时先验证 task id、依赖存在性、无 self-dependency、无环、任务数、深度和并发上限，并生成确定性拓扑序。生产 Scheduler 按以下顺序持久化：

1. 在事务内校验 AuthoritySnapshot、Plan 和 plan fingerprint。
2. 用调用者 `idempotencyKey + plan fingerprint` 创建或重放 `AgentDelegationSubmissionReceipt`。同键不同计划必须冲突。
3. 原子预留聚合子预算，再创建 DelegationRun 与 task rows。没有预算预留不能启动子 Run。
4. 将依赖已完成的 task 标记为 `ready`；claim 使用 attempt id 与 lease。
5. 为任务创建独立预算预留和确定性子启动键。
6. 持久化 `AgentDelegationChildSubmissionReceipt` 后启动 child AgentRun，并固定 parent ref 与 sandbox。
7. 观察 child checkpoint/terminal state；验证结果 Schema、大小、Artifact 与 evidence。
8. 解锁依赖任务，或按失败模式阻断/取消任务。
9. 聚合结构化结果、证据、用量和费用，形成终态。

Workflow 或 Worker 重放步骤时，稳定 submission/child receipt 必须防止重复 child Run 和重复预算预留。claim/lease 只控制执行所有权，不自动提供供应商调用 exactly-once；模型、图像、发送和发布仍使用各自 Muses 幂等与歧义收据。

## 8. 预算与并发

每个子任务拥有 turns、model calls、tool calls、输入/输出 Token、积分和持续时间上限。提交时使用保守聚合包络：离散调用与 Token/积分求和，`maxDurationMs` 也按所有任务上限求和预留；这是费用/资源授权上界，不是 DAG 实际墙钟耗时预测。并行只减少实际墙钟时间，不释放调用或费用上限。

聚合包络不能超过父 Run 剩余授权。真正启动任务前还必须原子扣减/预留，避免两个并发计划分别通过同一旧快照后共同超额。任务结束后按已知用量结算，未使用额度释放；供应商结果未知时进入人工复核，不能自动重发或静默释放。

`maxConcurrency` 同时受 Plan、Workspace policy、模型/Capability 限流和实际资源池约束。模型提出的并发值只会收紧，不能扩大服务端限制。

## 9. 失败、重试与取消

支持两种明确失败模式：

- `fail-fast`：任一必需任务失败后停止创建新子 Run，取消仍活动的兄弟 Run，并把未开始任务标记为 blocked/cancelled；已完成事实、Asset 和费用保留。
- `isolate`：失败任务及依赖它的后继被阻断；无依赖的分支继续，最终可为 `completed-with-failures`。

只有被分类为 retryable、尚未越过歧义副作用边界且仍有预算的 task attempt 可以重试。每次 attempt 有新 attempt id，但稳定 task submission identity 保留血缘；外部副作用继续使用稳定的操作幂等键。

取消根 Run、直接父 Run 或 DelegationRun 时，Scheduler 先持久化 Muses 取消收据和 fence，再停止新 claim/child submission，最后显式请求取消全部活动 descendant AgentRun 与 WorkflowRun。不能假设后台子工作流会自动随父 Workflow SDK run 取消。晚到结果不能复活终态，但已真实完成的用量和 Asset 仍需结算和保留。

## 10. 结果、证据与可观测性

子结果必须是符合任务 JSON 对象 Schema 的结构化数据，并受 UTF-8/序列化字节上限约束。Artifact/evidence ref 不能只看字符串格式：聚合前还需由对应 Registry 验证 Workspace、来源、存在性和类型。缺少 required evidence 的任务不能标记完成。

父 Agent 只接收经过验证的结构化结果、摘要和引用，不接收子 Agent 隐藏历史或推理正文。聚合器必须保留每个 task/attempt/child Run 的成功、失败、取消、用量和证据，而不是只返回一段不可追踪的总结。

Trace 至少关联 root/direct-parent/child AgentRun、DelegationPlan revision、task/attempt、submission receipts、Profile/Skill/MCP snapshot、sandbox、模型调用、工具、WorkflowRun、Asset、预算预留和账本。面向普通用户的投影展示进度、成果、失败和费用；敏感 Prompt、凭证、完整工具输入输出和受限上下文不进入公开 trace。

## 11. Workflow SDK 边界

安装版 `workflow@4.6.2` 继续作为耐久执行 adapter：workflow function 负责确定性编排，Node/供应商操作位于可重试 step，等待使用 Hook/Wait，执行事实由 Workflow World 保存。

Workflow SDK 支持直接 `await` 子 workflow（把步骤展平进父 run）和在 step 中调用 `start()` 创建独立后台 run。Muses 子 Agent 需要独立 AgentRun、事件、预算、沙盒和取消身份，因此不能用展平调用冒充 SubAgentRun。当前 adapter 以独立 SDK run 驱动一个 DelegationRun，并把 SDK run id 与 Muses driver attempt/lease 绑定；Child Runtime 再为每个任务创建独立 AgentRun。Scheduler 仍是任务 DAG 和聚合状态权威，Workflow SDK 只负责耐久唤醒、step 与 sleep。

当前 driver 的恢复顺序是：先在 PostgreSQL claim；`start()` 后由 SDK workflow 自绑定并由调用方补偿 attach；租约过期时先查询 SDK run，仍活动则续租，已终止才通过 CAS reclaim。工作流函数只执行 `resume Scheduler -> sleep(2s) -> resume`，数据库、Agent Runtime 和 SDK API 操作均位于 `"use step"` 或 workflow 外部。取消由 Muses 先持久化 Scheduler/Agent 终态，再显式取消仍活动的 SDK driver，不能反向让 Workflow World 成为产品状态权威。

SDK 自动 step retry 不等于产品幂等。`start()` 返回 SDK run id，但当前路径没有可依赖的调用方 run id/idempotency key；Muses submission receipt 仍是去重权威。后台 child 的取消传播、预算、权限和结果验证也由 Muses 显式实现。Workflow SDK 的 VM sandbox 更不是 Agent 物理计算沙盒。

## 12. 与 Eve 原则的关系

安装版 `eve@0.27.8` 的可取原则包括：子 Agent 不自动看见父历史、明确任务消息、专业工具/状态/沙盒、结构化 task result、并行委派和父取消向后代传播。Muses 保留这些原则，但有三项有意不同：

- Eve root copy 可以共享父 sandbox；Muses 每个 SubAgentRun 都使用独立 Run sandbox。
- Eve 以文件系统声明的 subagent 层级表达拓扑；Muses 内核不固定组织层级，DAG 由 Scheduler 持有。
- Eve/Workflow/Harness 负责执行机制；Muses 始终拥有 Workspace 授权、预算、审批、账本、项目状态与审计。

## 13. 验收与后续顺序

协议 Gate 要求纯验证器覆盖合法 DAG、稳定拓扑序、scope/lineage、重复/缺失/self/cycle 依赖、深度/任务/并发限制、权限/工具/Skill/MCP/计算越权、Context version/分类/Artifact/大小、结果 Schema/大小、子预算与聚合预算，以及子 Run 独立 sandbox 和幂等父引用冲突。

后续顺序固定为：

1. 完成持久 Runtime Scheduler 的 Trace/Billing 血缘、固定恢复 eval 与受授权委派入口；
2. 交付平台级 MusesAgent Profile，让它提出受验证的计划而不获得调度权威；
3. 交付第一个版本化领域 Agent Profile；
4. 用确定性 fixture 和真实最小创作任务验证受控多 Agent 执行；
5. 通过恢复、隔离、费用、取消和聚合 eval 后，才进入真实 PPT 场景。

当前不能因为协议类型和测试通过就宣称步骤 1—4 已经完成。
