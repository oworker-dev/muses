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

可复核证据位于 `delivery/evidence/agent-core-alpha/a7-single-agent-loop/`。这项证据仍不等于 A7 或完整创作模式全部通过：steering/follow-up 尚未完成真实浏览器验收；审批 UI、子图像工作流联动取消、文本模型目录计价、上下文压缩、进程恢复、隔离、追踪与固定 eval 仍属于后续 Gate。下一步先完成 steering 用户链路，再推进 A8 指定工作流调用与 A9 可靠性，不提前增加多 Agent 或 PPT 场景。

## 13. 当前实现迁移

现有专业画布、Start/End、类型化变量、WorkflowDefinition 编译器和 Workflow SDK Runtime 保留，重新归类为专业模式基础。现有浏览器 `localStorage` 只能作为临时缓存，不能继续充当 Agent 可写的权威状态。

迁移按纵向切片进行：先建立新对象和服务端端口，再让当前 Studio 通过 adapter 使用它们；不先删除可工作的首图链路，也不在没有替代路径时进行全量重写。

## 14. 当前非目标

- 不在 Agent Core Gate 内完成完整 Lovart UI、Coze 节点全集或通用 AI 应用平台。
- 不允许 Agent 静默安装任意代码、MCP Server 或高权限节点。
- 不在单 Agent 可靠前实现复杂多 Agent 拓扑。
- 不为进入 PPT 而绕过通用 Agent、Command、Asset、权限、费用和来源契约。
- 不预先冻结 Image-to-editable-SVG、PPTX、视频时间线或音乐编辑器路线。
