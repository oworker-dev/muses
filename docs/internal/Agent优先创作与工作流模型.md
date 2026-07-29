---
name: Agent-first 创作与工作流模型
description: Muses 创作画布、Agent 执行计划、可调用工作流、扩展安全边界与 Agent Core 优先交付路线。
---

# Agent-first 创作与工作流模型

## 1. 决策地位

本文是 APCC 决策 `agent-first` 的权威说明。它纠正两项已经被产品讨论推翻的旧假设：

- 专业工作流画布不是 Muses 默认创作体验；它是可复用自动化、调试和 API 发布界面。
- Codex 级 Agent Core 不是 PPT 遇到阻断后才拉取的可选能力；它是场景 MVP 前的当前主 Gate。

现有首图工程证据继续有效：图像 Capability、Workflow SDK 耐久运行、身份、Workspace、积分、模型目录和运行观测都是 Agent 可以复用的底座。需要纠正的是产品对象与交付顺序，不是删除这些实现。

## 2. 三种不同的权威对象

Muses 不再使用一个含义模糊的“画布 JSON”同时表达创作空间、Agent 计划和外部可调用工作流。

| 对象 | 目的 | 生命周期 | 用户界面边界 |
| --- | --- | --- | --- |
| `CreativeCanvas` | 持续创作、摆放资产、比较版本、表达空间和来源关系 | 随 Project 长期存在 | 默认创作模式，不显示 Input/Output |
| `ExecutionPlan` | Agent 为一个 `AgentRun` 建立的步骤、依赖、等待和检查计划 | 随 Run 创建、修订、完成或取消 | 默认折叠，可展开查看和调试 |
| `WorkflowDefinition` | 可重复运行、版本化、发布并由 Agent/API 调用的自动化定义 | 独立版本和发布生命周期 | 专业模式，显式 Input/Output |

三者共享 Asset、Artifact、Command、Capability、Node Type、Variable、Job、Policy、Usage 和 Provenance，但不共享同一个根 Schema。

## 3. 创作模式

创作模式以 Agent、资产和结果为中心。用户提出需求后产生 `AgentThread` 和 `AgentRun`；Run 自带隐式输入和终止状态，不在画布上创建可见开始/结束节点。

```text
用户需求
  → MusesAgent 检查当前画布、资产、模型和约束
  → 必要时澄清并展示计划
  → 通过 Command/Capability 创建和执行步骤
  → 将结果、来源和状态投影回 CreativeCanvas
  → 用户 steer、确认、拒绝、撤销或继续修改
```

同一 `CreativeCanvas` 可以包含多条相互引用但身份独立的 AgentThread/AgentRun。连线主要表达来源、引用、衍生与空间关系，不能自动视为一个可发布 DAG。

创作模式不是把专业画布的 Input/Output 用 CSS 隐藏。它使用不同的权威根对象和投影，只在用户要求调试时展开 `ExecutionPlan`。

## 4. 专业模式

专业模式服务可复用自动化、批处理、调试、模板和外部 API。一个 `ProfessionalWorkspace` 可以在总览中管理多个独立 `WorkflowDefinition`，但每个定义拥有自己的稳定身份、版本、输入输出和发布状态。

首版约束：

- 每个 `WorkflowDefinition` 有一个不可删除的 `Input/Trigger` 和一个 `Output/Return`。
- 定义内部允许分支、并行、受控循环、Agent、LLM、媒体、审批和子工作流节点。
- 多个互不相关的任务使用多个定义，不能依靠图的连通分量临时识别。
- 跨定义复用通过 `workflow.invoke` 或显式 Asset/Variable 契约完成，不允许任意跨组边。
- 多工作流总览可以使用列表、标签页或折叠卡片；进入单一定义后才显示完整节点图。

## 5. 工作流身份、版本与调用

开始节点、空间位置和显示名称都不是调用身份。调用单位至少包含：

```ts
type WorkflowDefinitionRef = {
  workspaceId: string;
  workflowDefinitionId: string;
  version: number;
};

type WorkflowRunRef = WorkflowDefinitionRef & {
  workflowRunId: string;
  caller: "user" | "agent" | "api" | "workflow";
  idempotencyKey: string;
};
```

UI 通过定义分组的运行命令调用；Agent 通过 Workflow Catalog 的 `list/inspect/invoke` 工具调用；外部环境只调用已发布版本或稳定 Deployment alias。生产调用默认固定精确版本或 `production` alias，不能隐式跟随可变草稿。

未来如真实需求证明单一定义必须支持多个入口，再增加具名 `entrypointId`。首版不提前引入多入口复杂度。

## 6. Node Type Registry

Agent 只有查询版本化节点目录后才能构建工作流。节点类型至少声明配置 Schema、输入输出端口、执行器引用、所需 Capability、Policy、费用模型和 UI 投影引用。

Agent 可以自行实例化已注册节点类型。注册新可执行节点类型、安装未知代码或提升节点权限属于平台控制面操作，必须经过管理员授权、来源校验和安全审查。

首批公共节点类别是 Input/Output、LLM、Agent、Image Generate、Human Approval 和 Workflow Invoke。后续节点只能由用户任务和节点产品目录共同准入，不能只在前端或解释器中增加分支。

## 7. Agent Operation Gateway

Agent“直接驱动画布”表示它通过与 UI 相同的服务端 Query、Command 和 Capability 行动，不表示操作 DOM、模拟鼠标、写 React Flow 状态或直接访问数据库。

```text
Agent Sandbox
  → Query / Command / Capability Gateway
  → 身份、Workspace、Policy、预算、审批、revision、幂等校验
  → CreativeCanvas / WorkflowDefinition / Asset / Job
  → Event、Audit、Usage、Provenance
```

所有写操作携带目标、expected revision、幂等键、操作者、AgentRun 和 correlation id。结构、端口、类型、循环、费用和发布合法性在服务端验证；冲突返回结构化诊断，不静默覆盖。

## 8. 独立 Agent Core

Muses 自己拥有 Agent 契约，Eve、Pi、Workflow SDK 和未来框架只通过 adapter 接入。Agent Core 至少表达 Session、Run、Turn、Step、Event、ToolCall、Approval、Checkpoint、ContextSnapshot 和 Budget，以及以下控制原语：

```text
start / stream / steer / followUp / approve / cancel / resume / inspect
spawn / wait / close
```

Agent Core 不依赖 React、Next.js、XYFlow、PPT 或具体 Harness，必须能作为嵌入式包、独立 Worker/API 和 CLI/Eval Harness 运行。

AI SDK 负责模型与工具协议；Workflow SDK 负责耐久步骤、等待、重试和恢复；Harness 负责 Agent loop、上下文和扩展装配；Muses Agent Core 负责稳定产品身份、权限、预算、控制和审计。

## 9. Skill、MCP 与沙盒

Skill 是带版本、来源、校验和、兼容范围、所需工具和权限声明的能力包。每次 Run 固定 Skill snapshot；Skill 可以指导工具使用，但不能授予权限。

MCP 必须经过 Muses MCP Gateway，统一处理连接目录、OAuth/服务认证、工具发现、Schema 固定、超时、限流、结果大小、网络出口、审批、审计和 prompt-injection 风险。外部 MCP Server 不能直接获得平台主密钥。

隔离层次固定为：

```text
Workspace = 强租户边界
Canvas/Project = 资源授权范围
AgentSession = 上下文连续性
AgentRun = 默认执行沙盒边界
SubAgentRun = 独立子沙盒、工具权限和预算
```

所有 Run 都具备逻辑沙盒。只有代码、CLI、浏览器、不可信文件或复杂媒体处理需要计算沙盒。跨 Run 持久内容必须显式进入 ContextSnapshot、Artifact、Asset 或 Checkpoint，不能依赖隐藏的长期可写目录。

## 10. Agent 节点与递归边界

专业工作流可以包含同等级 `Agent` 节点。节点引用版本化 Agent Profile、Instructions、Skill、MCP Connection、输入绑定、输出 Schema、工具策略和预算。

Agent 可以构建包含 Agent 节点的工作流，但 Runtime 必须限制最大委托深度、并发、总步骤、时间、Token、积分和外部副作用。SubAgent 默认不继承父 Agent 全部权限；父 Agent 只能委托显式能力包。

## 11. 交付顺序

当前工程主线固定为：

1. **A0-A2 产品与调用契约**：完成本文、工作流身份、Node Type Registry 和 AgentRuntimePort。
2. **A3 Operation Gateway**：服务端权威 CreativeCanvas/WorkflowDefinition、revision、Query、Command、Capability、授权和审计。
3. **A4 独立 Agent Core**：完成框架无关状态、事件、控制原语和 headless Harness。
4. **A5 扩展与隔离**：完成 Skill、MCP Gateway、逻辑沙盒与计算沙盒端口。
5. **A6 Harness Spike**：安装 Eve 后先读随版本文档，再用同一工具和夹具对照 Eve 与 Pi；`@workflow/ai` 只作为耐久集成基线。
6. **A7 单 Agent 创作闭环**：用户需求到计划、真实生图、结果入画布和 steering。
7. **A8 工作流发布闭环**：UI、Agent、API 按稳定 ID/版本调用一个专业空间中的指定定义。
8. **A9 可靠性 Gate**：刷新/进程恢复、压缩不漂移、幂等费用、预算、审批、取消、隔离、追踪和固定 eval。
9. **A10 Agent Orchestration**：单 Agent 可靠后增加 MusesAgent、Domain Agent Profile、SubAgent 与 Runtime Scheduler。
10. **A11 场景 MVP**：先 PPT，再用 AI 短剧验证跨媒体复用。

场景不得提前于 A9 和最小 A10。多 Agent 不得提前于单 Agent 可靠性 Gate。

## 12. A7 当前工程状态

截至 2026-07-29，A7 已用真实模型和真实图片通过第二个纵向切片：已登录用户可以在 Studio 用自然语言发起 `AgentRun`，Muses Agent Core 通过 AI SDK 完成模型工具循环，`image.generate` 复用模型目录、积分预留、Workflow SDK 图像解释器和对象存储，并只通过 Operation Gateway 把生成的 Asset 放入权威 `CreativeCanvas`。Studio 默认进入创作模式，专业模式保留为可切换投影；生成结果以可移动 Asset 卡片显示，拖动通过 `creative.item.put` 保存，刷新后位置、图片和 AgentRun 均可恢复。

AgentRun 现在持久化“理解需求 → 生成图片 → 放置结果”的最小 `ExecutionPlan`，计划步骤携带依赖、状态和 Asset evidence ref，并在 Agent 面板中默认折叠、按需展开。这证明了 ExecutionPlan 与 CreativeCanvas 是不同权威对象，而不是把专业工作流的 Input/Output 隐藏起来；当前计划仍是图像闭环的固定最小计划，不是通用可编辑规划器。

生成图片同时写入 Muses 自有 `muses_generated_asset` 记录，保存对象键、媒体类型、字节数、尺寸、Prompt、Provider、Model 和 Workflow/Node/Step 来源。图片读取先经过 Muses Workspace 与 WorkflowRun 授权，再按 Asset 记录访问对象存储，不再把 Workflow SDK `returnValue` 当成 Asset 权威；因此 Workflow World 清理、过期或切换不能让已确认 Asset 失去产品身份。

首图证据位于 `delivery/evidence/agent-core-alpha/a7-single-agent-loop/`；真实 follow-up 证据位于 `delivery/evidence/agent-core-alpha/a7-steering-loop/`。A7 已完成，但它自身仍不等于完整创作模式或 Codex 级可靠性全部通过。A8 指定工作流调用和 A9 单 Agent 可靠性 Gate 现均已通过；下一步进入最小 A10 调度契约，仍不提前进入 PPT 场景。文本模型生产计价、物理计算沙盒与人工对账 UI 保留为明确后续风险。

首个真实 follow-up 探针发现空闲时间被错误计入 `maxDurationMs`。Agent Core 已改为终态 Run 重开时刷新连续执行时间窗，同时保留累计模型、工具、Token 和积分预算，并通过跨空闲期回归测试。供应商额度不足期间的重试均保持零模型用量、零图像、零积分与零画布副作用；供应商原始诊断现已在 Agent Core 提交前统一为稳定错误，并在 Web API 投影层兼容脱敏历史记录。额度恢复后，同一 Run 完成计划修订，Agent 在一次无效参考 Asset 的无副作用失败后自纠，只创建一个真实图像 Workflow、新增一个 Asset 并扣费一次；新图在旧图右侧非重叠放置，中文浏览器刷新恢复 Run、两张图片和位置。A7 因而通过，后续缺口转入 A8/A9。

## 13. 当前实现迁移

现有专业画布、Start/End、类型化变量、WorkflowDefinition 编译器和 Workflow SDK Runtime 保留，重新归类为专业模式基础。现有浏览器 `localStorage` 只能作为临时缓存，不能继续充当 Agent 可写的权威状态。

迁移按纵向切片进行：先建立新对象和服务端端口，再让当前 Studio 通过 adapter 使用它们；不先删除可工作的首图链路，也不在没有替代路径时进行全量重写。

## 13.1 A8 工作流发布闭环

Studio 的专业模式现已停止把浏览器中的可变 `WorkflowDocument` 直接提交给运行端。运行前先等待 Operation Gateway 草稿写入完成，再由服务端锁定稳定 definition id 与 draft revision，编译并写入不可变 `WorkflowDefinition` 版本；相同可执行内容重复发布复用原版本，变化后才递增版本。`production` Deployment 只绑定一个精确版本，可禁用，并在发布新版本时原子更新。

UI 与 Agent 都通过同一服务端 invocation 函数解析 `definitionId + version` 或 Deployment id，随后进入既有 Workspace 授权、幂等指纹、积分预留、Workflow SDK、观测与审计链路。`muses_workflow_run` 记录解析后的 definition、version、deployment 与 caller；浏览器上传 graph 的旧入口已被拒绝。MusesAgent 仅通过 Tool Registry 中的 `workflow.list`、`workflow.inspect` 与 `workflow.invoke` 访问目录和启动运行，不拥有数据库或编译器旁路。

`?template=harness` 仍用于等待、恢复、取消和重试回归，但定义改由服务端固定夹具发布，不再把 localStorage 图作为运行权威。该夹具不代表产品工作流，也不会进入普通用户目录，除非显式启用 Harness 环境。

2026-07-29 的 A8 证据已验证三条入口共享同一发布身份：专业 Studio 发布并按 Deployment 调用默认真实图片定义；HTTP API 拒绝可变 graph、不存在版本、禁用 Deployment 和跨 Workspace 目标；真实 MusesAgent 严格执行 `workflow.list → workflow.inspect → workflow.invoke`，调用者审计绑定 AgentRun，并在证据清理后由 Workflow SDK 与 Muses 产品表共同持久化 `cancelled`。对应证据位于 `delivery/evidence/agent-core-alpha/a8-callable-workflows/`。

A8 不改变后续 Gate：公开外部 API 的服务身份/密钥产品化、Workspace 删除与不可变版本保留策略、Agent 子运行联动取消、审批、追踪、隔离和固定 eval 仍在 A9 或其后的显式任务中解决。特别是当前不可变版本触发器会阻止发布版本随 Workspace 级联物理删除；在实现 Workspace 删除前必须先确定归档、保留或受控清除政策，不能静默绕过不可变历史。

## 13.2 A9 可靠性验收矩阵

A9 的权威状态、故障夹具、通过证据和残余风险已冻结在
`delivery/agent-core-a9-reliability-gate.md`。执行顺序固定为 driver
恢复与重新认领、上下文压缩、预算与幂等费用、审批与联动取消、隔离与
追踪、固定 eval；每项都必须提供失败注入证据，不能用一次正常生图代替。

安装的 `workflow@4.6.2` 没有调用方指定 WorkflowRun id 或 start
幂等键，因此 Muses 使用自有 attempt/lease 保护 claim/attach 窗口，并让
durable driver 在模型或工具之前自绑定 SDK run。该机制不虚构模型调用
exactly-once：供应商响应后、Agent checkpoint 前的崩溃歧义仍必须在 A9
预算、费用与固定 eval 中显式验证。

2026-07-29 的六个 A9 切片已全部通过。恢复切片证明过期未绑定 claim 和过期已绑定终态 SDK
run 均可在 Studio 轮询中重新认领，旧 attempt 无法执行，恢复夹具在模型、
子工作流、图片和积分预留上均为零副作用。证据位于
`delivery/evidence/agent-core-alpha/a9-reliability/`。上下文切片使用消息数与
字符数双高水位及更低保留水位，滚动对话历史有界，当前 plan、权限、预算、
Asset、待处理动作与已省略工具结果以结构化 facts 保存；Agent Core 而非
可替换 compactor 负责把权威 facts 注入模型。PostgreSQL 夹具完成 14 轮后
重建 Runtime 并完成第 15 轮，全程只压缩一次且事实无漂移。

预算与幂等费用切片没有假设模型供应商支持幂等键，而是以
`AgentRun + turn + ContextSnapshot version` 建立稳定模型调用收据。供应商调用前
持久化保守 Token/积分估算、attempt lease 与预留；完成结果先校验、结算并落收据，
再允许 Agent checkpoint。已完成收据直接回放；过期未调用收据可换 attempt；已进入
供应商但结果未知的收据只转 `ambiguous/review_required`，永不自动重发；明确非超时
4xx 拒绝只释放一次；超预留保留结果与实际用量但不静默完成。隔离 PostgreSQL
夹具证明非零费率 reserve/settle/release 唯一、余额不足零收据。真实 Agent 生图
证明 2 次文本模型调用对应 2 条完成收据，临时图像子 Workflow 以父 AgentRun 为
caller、不伪装成发布版本，最终只生成 1 个 Asset 并结算 1 个图像预留。

审批与联动取消切片把 `image.generate`、`workflow.invoke` 和未来 `external` 工具统一放在服务端审批门禁后。Studio 显示持久化工具名、原因和有界参数；相同决策可重放，冲突决策被拒绝，拒绝不执行工具。取消先落 Muses 收据并终结 AgentRun，再取消 durable driver 与全部仍活动的 Agent 子 Workflow。取消收据和 AgentRun 行锁共同阻止新子提交与画布写入；已完成子运行保留事实，已知用量结算，未发生用量释放，供应商结果不明转人工复核。真实图片、精确发布工作流和等待 Selector 子运行分别通过审批、调用和联动取消浏览器证据。

隔离与追踪切片为每个新 Run 固定 Workspace/Project/Session/Run 精确作用域、独立临时文件命名空间、默认拒绝网络、精确权限和工具集合，并固定 Skill 版本/校验和、MCP 连接版本及工具 Schema。Skill 和 MCP 不能自行授予工具或权限；每次读取 Run 都重验完整性，持久化快照被改写后在模型或工具执行前关闭。当前这是逻辑沙盒与计算沙盒端口，不代表已经为代码、浏览器或不可信文件启用供应商计算沙盒。

AgentRun id 同时作为 trace id。只读 API 在 Workspace 授权后关联 AgentEvent、模型调用收据、Operation Gateway 命令、Agent 子 WorkflowRun、Asset、积分预留和账本；Workflow SDK World 仍是 durable run/step/event/correlation id 的权威，查询统一使用 `resolveData: none`。投影不返回 Prompt、模型正文、工具完整输入输出、对象键、凭证引用或邮箱。AI SDK telemetry 也明确关闭输入输出记录，只允许 Run、Workspace、Project、model-call、turn 与 context version 等结构化 id。真实链路证据包含 23 个 Agent 事件、2 个模型收据、1 个画布命令、2 个 SDK Run、13 个 Step、45 个 SDK Event、1 个 Asset 及费用事实；跨 Workspace Run/Asset、工具输入篡改作用域和快照篡改均被拒绝。

固定 eval `agent-core-a9-reliability@1.0.0` 以确定性模型、时钟、ID、Store 和工具直接驱动同一 Headless Runtime，8/8 覆盖成功、恢复、拒绝、预算、审批、取消、隔离和零副作用；任何硬断言失败或与提交证据漂移都会非零退出，且不调用真实供应商或网络。A9 因而通过，可以进入最小 A10，但不等于多 Agent、PPT 或完整 Codex 体验已经完成。文本模型生产费率当前仍需进入版本化模型目录；本次真实环境费率为零，非零文本费用的一次性账本语义由隔离夹具证明。

## 13.3 A10 委派协议

A10 第一切片已经冻结框架无关的委派边界，完整协议见[Agent 委托与调度协议](Agent委托与调度协议.md)，Gate 见 `delivery/agent-orchestration-a10-contract.md`。每个委派计划现在区分整棵树的 root Run 和提交当前计划的直接 parent Run；子 AgentRun 固定 parent/root Run、计划 id/revision 与 task id，并使用独立 `agent-run/<childRunId>` 逻辑沙盒。相同 child Run id 只能重放同一不可变血缘。

子 Agent 不继承父对话或沙盒。ContextPackage 绑定直接父 Run 与精确 ContextSnapshot version，事实分类与 Artifact 引用必须属于服务端 AuthoritySnapshot 的可委派子集；权限、工具、Skill、MCP Connection 和计算能力同样只能收窄。纯验证器已覆盖合法 DAG、稳定拓扑序、scope、依赖、深度、并发、越权、Context、结构化结果和聚合预算，当前 Agent Core 共 72 项测试通过。

后续 A10 切片现已实现 Muses 自有 submission/child receipt、并发逻辑预算预留、task claim/lease、精确 Profile 解析、结果/证据/Project 级 Artifact 校验、独立 Child AgentRun，以及带 attach/reclaim/取消组合的 Workflow SDK 持久驱动。隔离 PostgreSQL 门禁已证明子 Run 血缘、独立逻辑沙盒、结构化结果聚合和 driver 恢复；Workflow SDK 只负责耐久唤醒，Scheduler 继续拥有 DAG 和聚合状态。

A10 Scheduler Gate 现进一步完成整棵 Agent 树的 Trace/Billing 血缘、6/6 固定恢复 eval，以及受现有 external-tool 审批控制的 `agent.delegate` 入口。模型只提交任务 DAG、显式 Context、精确 Profile、收窄 grant、预算和结果契约；Workspace/Project/Session、root/direct-parent、深度、Context version、策略和剩余预算全部由持久 AgentRun 派生。首个领域配置 `muses-image-specialist@0.1.0-alpha` 只拥有 `image.generate` 工具及其最小权限/媒体计算声明。

下一 Gate 是使用真实文本与图像供应商完成一次经认证、可审批、可刷新恢复的多 Agent 创作验收，并让用户能处理子 Run 审批和看到聚合成果、费用与追踪。平台级 MusesAgent 只能提出计划，不能成为 Scheduler、权限或预算权威；生产 Skill/MCP 解析与物理计算沙盒也仍是明确缺口。该真实验收通过前仍不进入 PPT。

## 14. 当前非目标

- 不在 Agent Core Gate 内完成完整 Lovart UI、Coze 节点全集或通用 AI 应用平台。
- 不允许 Agent 静默安装任意代码、MCP Server 或高权限节点。
- 不在单 Agent 可靠前实现复杂多 Agent 拓扑。
- 不为进入 PPT 而绕过通用 Agent、Command、Asset、权限、费用和来源契约。
- 不预先冻结 Image-to-editable-SVG、PPTX、视频时间线或音乐编辑器路线。
