---
name: 平台技术栈与 Agent Harness 路线
description: Muses 对 AI Elements、XYFlow、Workflow SDK、Eve、Pi 与 AI SDK 的分层采用边界、对标推断和验证顺序。
---

# 平台技术栈与 Agent Harness 路线

## 1. 当前结论

Muses 不以“全部自研”证明先进，也不把某个 SDK 的对象模型当成平台内核。当前采用以下分层候选路线：

- **创作与专业画布投影**：AI Elements + XYFlow 是交互图投影候选；创作模式投影 `CreativeCanvas`，专业模式投影独立 `WorkflowDefinition`，两者不共享根 Schema。
- **耐久工作流执行**：Workflow SDK 是 `WorkflowRun` 的首选候选，不拥有探索画布。
- **自主 Agent Runtime**：Muses Agent Core 是当前权威 Runtime；Pi Agent Core 是可选的轻量循环 Adapter；Eve 保留为隔离的耐久 Harness 候选，当前不进入产品运行时。
- **模型与流式交互**：AI SDK 是模型、工具协议和流式 UI 适配层，不是 Agent Runtime。
- **专业文档渲染**：`DesignDocument` 独立比较 Konva/Fabric，必要时以 Pixi/WebGL 提升渲染上限。
- **权威产品状态**：CreativeCanvas、ExecutionPlan、WorkflowDefinition、DesignDocument、Command、Revision、Asset、Job、Capability、Provenance 与 Policy 始终由 Muses 拥有。

这项路线由 APCC 决策 `vercel-agent-harness` 管理。它确认分层和候选优先级，不冻结最终库。

## 2. 六层关系

```text
Muses Product Shell
├── AI Elements：Agent、Tool、Message、Node、Edge 等 UI 组件
├── Canvas Projection
│   ├── CreativeCanvas：Agent、资产、结果与来源
│   ├── ProfessionalWorkspace：独立 WorkflowDefinition
│   └── AI Elements Canvas + XYFlow（交互图候选）
├── Muses Domain Kernel
│   ├── CreativeCanvas / ExecutionPlan / WorkflowDefinition / DesignDocument
│   ├── Command / Revision / Asset / Provenance
│   └── Query / Capability / Job / Policy
├── Durable Execution
│   ├── Workflow SDK：WorkflowDefinition → WorkflowRun
│   └── BullMQ Worker：媒体与供应商任务执行
├── Agent Harness
│   ├── Muses headless runtime（当前主实现）
│   ├── Pi adapter（可选轻量循环）
│   ├── Eve adapter（隔离耐久候选）
│   └── Future harness adapter
└── Model Layer
    ├── AI SDK / provider adapters
    └── OpenAI、Anthropic、Google 与其他模型
```

依赖只能向下通过 Muses 端口流动。第三方 SDK 可以持有自己的临时运行状态，但不能成为 Muses 项目、文档、来源、费用或权限的唯一事实来源。

## 3. AI Elements 与 XYFlow

截至 2026-07-25，AI Elements 是 Apache-2.0 的 AI 原生组件库和自定义 registry。其 `Canvas` 组件直接导入 `ReactFlow`，接受完整 `ReactFlowProps`，并为平移、缩放、选择、删除和背景提供默认配置。因此：

```text
AI Elements Canvas = AI 原生 UI 约定 + XYFlow 底层节点图能力
```

采用 AI Elements 不会替代 XYFlow 技术判断，而是为 XYFlow 增加可复用的 Node、Edge、Toolbar、Controls 和视觉语言。Muses 可以复制并修改 registry 组件，使其符合开放源码、品牌和领域语义要求。

### 适合承担

- 外层节点、端口、边、视口、选择、框选、拖放和连接交互。
- Agent、Capability、Job、Asset、Approval 与专业文档节点的统一 UI 原语。
- 工作流运行状态、工具调用、错误、进度与分支结果的可视化投影。
- 快速形成与现代 AI 产品一致的交互基线。

### 不能直接承担

- WorkflowDocument 的权威 Schema、Command、Revision 和迁移。
- 五类边的业务不变量、探索图与已发布工作流边界。
- 500 节点目标规模的无条件性能承诺。
- DesignDocument 的文本、图片、形状、分组和专业变换模型。
- 保存恢复、来源、成本、租户权限和结构化项目导出。

如果统一 Spike 通过，正式依赖仍应写成 `Muses workflow adapter → AI Elements/XYFlow`，而不是让应用代码直接读写 React Flow nodes/edges。

## 4. Workflow SDK 的正确位置

Workflow SDK 负责可恢复、可观察的耐久步骤、暂停、继续、重试和事件等待。它解决的是执行生命期，不是空间编辑器。

Muses 对象必须保持区分：

| 对象                 | 权威责任                                     | Workflow SDK 的关系                                    |
| -------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `CreativeCanvas`     | 创作资产、布局、来源和 AgentRun 投影           | 不直接执行，不由 SDK 保存                              |
| `ExecutionPlan`      | 一个 AgentRun 的步骤、依赖、等待和检查         | 可以映射为耐久 Agent 编排，但不成为 SDK 私有状态       |
| `ProfessionalWorkspace` | 多个独立定义的编辑总览和空间布局             | 不直接执行，不由 SDK 保存                              |
| `WorkflowDefinition` | 经过类型、权限、副作用和版本校验的可执行定义 | 可以编译/映射为耐久执行入口                            |
| `WorkflowRun`        | 某个定义版本的一次执行及其步骤状态           | 可以由 Workflow SDK 承载，Muses 保存稳定引用与业务投影 |
| `Job`                | 单项媒体或供应商任务、尝试、费用和产物       | 可被 Workflow SDK 编排，由 Worker/Queue 执行           |

现有执行适配已于 2026-07-27 从边界 Probe 推进为首批节点解释器：Next.js 服务端使用 `workflow@4.6.2`，自托管 Docker 使用 `@workflow/world-postgres@4.3.1`；当前浏览器 `WorkflowDocument` 在迁移期视为单定义专业编辑草稿，Muses 完成发布校验并编译独立 `WorkflowDefinition`，再由 SDK 创建可查询的耐久 `WorkflowRun`。后续必须把专业工作空间、定义身份和创作画布分离，Workflow SDK 不参与该产品对象迁移。

`WorkflowDefinition 0.3.0-draft` 与 `WorkflowRuntimePort` 已冻结当前首图版本。默认图像路径已接真实 OpenAI Images Adapter；身份、积分和运行观测已经形成 Agent 可复用底座。Agent-first 产品对象、Node Type Registry、Operation Gateway、独立 Agent Core、Skill/MCP/沙盒端口与 Harness 对照已经完成；2026-07-29 的 A7 证据进一步证明单 Agent 可以复用这条路径生成真实图片，通过 Gateway 写入并移动 `CreativeCanvas` Asset，并把最小 `ExecutionPlan` 持久化在 AgentRun 中。Workflow SDK 没有因此成为 Agent、创作画布或生成 Asset 的权威状态。

本地自托管开发固定使用 `@workflow/world-postgres`，必须显式设置 `WORKFLOW_TARGET_WORLD` 与 `WORKFLOW_POSTGRES_URL`，不允许静默退回进程内 Local World。Workflow SDK 的事件日志是 Run、Step、Hook 和 Wait 的执行事实来源；Muses 自有 `muses_generated_asset` 保存用户资产身份、对象键、媒体元数据和来源，授权读取不依赖 SDK `returnValue`。这是执行耐久性与产品资产连续性的明确所有权边界。

## 5. 为什么 Agent 需要 Harness

Codex 级 Agent 不只是一次模型调用加若干 tools。它至少需要：

- 长生命周期 Session、Run、Turn、Step 和崩溃恢复。
- 上下文选择、压缩、长期状态、技能和按需加载。
- 工具循环、并行执行、前后置策略、流式事件和证据。
- steering、follow-up、暂停、继续、取消和人工审批。
- 沙箱、权限、凭证隔离、网络策略、预算和审计。
- 子 Agent 的独立上下文、工具表面、并发、失败隔离和结果汇总。

AI SDK/Chat SDK 主要覆盖模型协议、结构化输出、工具调用和流式 UI。它们可以位于 Harness 下方，但不能替代上述运行时。

## 6. Eve 与 Pi Spike 结论

2026-07-29 已使用相同的 Muses 生命周期、安全与自托管夹具完成
`@muses/agent-core`、`@earendil-works/pi-agent-core@0.82.1` 和
`eve@0.27.8` 对照。可执行矩阵与兼容性 Gate 位于
`src/packages/agent-harness-adapters`。

| 候选 | 当前角色 | 原生优势 | 必须由 Muses 补齐或持有 | 当前硬阻断 |
| --- | --- | --- | --- | --- |
| Muses headless | 主 Runtime | 权威生命周期、审批、预算、事件、Checkpoint、Run 隔离 | PostgreSQL Store 与生产 Model Adapter | 无框架级阻断 |
| Pi 0.82.1 | 可选循环 Adapter | 工具循环、事件、steering/follow-up、工具前后置 Hook、Node 22 可运行 | 耐久状态、审批暂停、Skill/MCP、Sandbox、权限与费用 | 不可独立承担生产耐久 Runtime |
| Eve 0.27.8 | 延后隔离候选 | 耐久 Session、HITL、Skill、MCP、Sandbox、Subagent、自托管 World | Muses 权威状态、Run 级隔离、消息队列和 Gateway Adapter | Node 24、Workflow 5 beta、per-session sandbox 与当前基线冲突 |

### Eve：延后隔离候选

Eve 是 Apache-2.0、filesystem-first 的耐久 Agent Framework，`0.27.8`
仍处于 Preview。随包文档确认其默认 Agent loop、上下文压缩、Tools、
Skills、State、Channels、Schedules、Human-in-the-loop、Subagents、Sandbox
和基于 Workflow SDK 的 step checkpoint/resume 都有较完整实现。

适合验证：

- MusesAgent 和领域 Agent 的长会话、暂停恢复和多入口渠道。
- Workflow SDK 与 Agent Run 的集成。
- per-session sandbox、工具审批、技能加载和子 Agent 隔离。
- 自托管 world、状态、流和运行观测能否满足 Muses 开放要求。

当前不能直接采用，原因是：

- 安装版要求 Node.js `>=24`，Muses 当前为 Node `22.22.0`。
- Eve vendored `@workflow/* 5.0.0-beta` 协议，Muses 当前生产路径为
  `workflow@4.6.2` 与 `@workflow/world-postgres@4.3.1`，不能共享 World。
- Eve sandbox 按 Session 持久，而 Muses 的默认隔离边界是 AgentRun；不能仅靠
  名称映射假装满足隔离。
- Eve 不保证同 Session 并发消息的耐久 FIFO；应用层仍需串行队列。
- 中断中的 step 会重跑，计费、发送和发布等副作用仍必须使用 Muses 幂等收据。

因此不在当前 Web/Worker 进程导入 Eve。未来只在 Node 24、独立 Workflow World
和 Run-sandbox Adapter 的隔离部署中复验，删除候选不影响 Muses 状态格式。

### Pi Agent Core：可选轻量循环 Adapter

Pi 是 MIT 的 Agent Harness。Agent Core 提供多模型、工具循环、事件流、并行/串行工具、上下文变换、steering/follow-up 与状态管理；Coding Agent 还提供可分支 Session、自动压缩、Extensions、Skills 和可替换 UI。

适合验证：

- 低耦合、可嵌入的执行型 Agent Runtime。
- Muses 自己持有调度、状态和策略时，最小 Harness 需要多少代码。
- 本地优先、自托管或桌面执行场景。
- 与 Eve 比较性能、透明度、删除成本和框架锁定。

Pi 的 `beforeToolCall`/`afterToolCall` 与 steering/follow-up 适合映射 Muses
策略和控制原语；Node `>=22.19.0` 与当前运行时兼容。当前 Adapter 已证明：

- Pi 工具只能调用 Muses `AgentToolRegistryPort`。
- `runId:toolCallId` 继续作为稳定幂等键。
- 缺失权限、未知工具和审批要求都会在执行前失败关闭。
- 有副作用工具强制串行，低风险工具才允许并行。

Pi 的 preflight 只能阻止工具，不能独立表达 Muses 的耐久审批等待。因此当前不把
Pi `Agent` 类直接实现为完整 `AgentRuntimePort`；它只能作为 Muses Runtime 内的
可替换循环，审批、状态、预算、Checkpoint、Skill/MCP snapshot 和 Sandbox 均由
Muses 持有。

## 7. Harness 适配器契约

Eve、Pi 或未来 Harness 都必须位于 `AgentRuntimePort` 后方。最小候选接口应表达：

```ts
type AgentRuntimePort = {
  start(input: StartAgentRun): Promise<AgentRunRef>;
  stream(runId: string, cursor?: string): AsyncIterable<AgentEvent>;
  steer(runId: string, message: AgentMessage): Promise<void>;
  approve(runId: string, approval: ApprovalDecision): Promise<void>;
  cancel(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  inspect(runId: string): Promise<AgentRunSnapshot>;
};
```

Harness 工具只能调用 Muses Query、Command 与 Capability。模型消息、框架 Session、todo、checkpoint 或 tool result 可以作为运行证据保存，但不能绕过 Muses Command 修改画布，也不能成为项目导出的唯一格式。

## 8. 对标平台的高置信推断

公开 Web 特征只能证明架构形态，不能可靠证明私有画布库：

- Lovart 公开层具有 Next.js/RSC/Turbopack 特征，同时使用独立静态资产域和 Istio 上游，符合“React 前台 + 独立媒体/任务后端”的形态。
- Codia 公开层具有 Next.js 与 Cloudflare/CDN 特征，并使用独立媒体资产域。
- 达到这类产品规模后，顶层通常不是一个库包办全部能力，而是 DOM/React 交互层、Canvas/WebGL 媒体层、独立任务后端和自有领域状态的组合。

因此“不落后”的关键不是猜中竞争对手的某个 npm 包，而是成熟 SDK 可直接替换、核心状态自主、渲染层可升级、长任务与 Agent 可以恢复。

## 9. 当前固定、候选与暂缓

### 已固定

- TypeScript、React、Next.js 产品基础。
- Muses 自有领域文档和 Query/Command/Capability/Job/Policy 边界。
- AI Elements/XYFlow、Workflow SDK、Agent Harness 都只能通过 adapter 接入。
- CreativeCanvas、ExecutionPlan、ProfessionalWorkspace 和 WorkflowDefinition 拥有不同根 Schema，共享 Command、Capability、Asset、Variable、Policy 与 Provenance。
- Agent 只能通过服务端 Query、Command 与 Capability 行动；当前真实图像能力作为首个工具闭环，不要求先补完所有媒体模块。

### 当前实现与候选

- 外层画布：AI Elements + XYFlow。
- 耐久工作流：Workflow SDK。
- Agent Runtime：Muses Agent Core headless 实现；Muses PostgreSQL 保存权威 Agent Run/Event，Workflow SDK Postgres World 驱动可恢复 Node step。
- 生成 Asset：Muses PostgreSQL 保存 Asset 身份、对象键、元数据和来源，S3 兼容对象存储保存二进制；Workflow SDK 输出只作为执行结果，不作为 Asset 授权或生命周期权威。
- 模型工具协议：AI SDK 7；内部点分工具名通过可逆别名映射到供应商安全名称。
- 首批 Agent 工具：`canvas.inspect`、`canvas.item.put`、`image.generate`，写操作统一经过 Operation Gateway。
- 可选 Agent loop：Pi Agent Core Adapter。
- 隔离耐久候选：Eve，当前延后。

### 暂缓

- 最终专业画布渲染器。
- 生产环境 Workflow World 的托管/自托管部署选择；本地自托管开发已固定 Postgres World。
- Eve 的生产采用；Pi 当前只固定 Spike 版本，不承诺成为唯一 Loop。
- 多 Agent 拓扑、Agent SDK、模型供应商和长期记忆实现。

## 10. 后续验证顺序

1. 已完成 Agent-first 对象、调用身份、Node Type Registry、Operation Gateway、独立 Agent Core、扩展/沙盒端口和 Eve/Pi 对照。
2. 已完成单 Agent 真实生图最小闭环：PostgreSQL Run/Event、AI SDK 模型工具循环、Workflow SDK driver、真实 Image Capability、Gateway 入画布与刷新恢复。
3. 已完成权威 CreativeCanvas 的默认创作模式投影、可移动 Asset、来源数据、可展开最小 ExecutionPlan 和真实 steering/follow-up 浏览器验收。
4. 当前让 UI、Agent 和 API 按稳定 id、版本与幂等键调用专业空间中的指定 WorkflowDefinition。
5. 通过恢复、压缩、费用、预算、审批、取消、隔离、追踪与 eval Gate 后，再进入 MusesAgent、领域 Agent 和 SubAgent 调度。
6. 最小 Orchestration 通过后才进入真实 PPT；AI 短剧随后验证跨媒体复用。

技术候选的新版本不会自动改变路线。升级、替换和正式采用必须由可复现证据与 APCC 决策驱动。
