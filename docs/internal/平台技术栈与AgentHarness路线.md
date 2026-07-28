---
name: 平台技术栈与 Agent Harness 路线
description: Muses 对 AI Elements、XYFlow、Workflow SDK、Eve、Pi 与 AI SDK 的分层采用边界、对标推断和验证顺序。
---

# 平台技术栈与 Agent Harness 路线

## 1. 当前结论

Muses 不以“全部自研”证明先进，也不把某个 SDK 的对象模型当成平台内核。当前采用以下分层候选路线：

- **外层创作画布**：AI Elements + XYFlow 是首个投影候选。
- **耐久工作流执行**：Workflow SDK 是 `WorkflowRun` 的首选候选，不拥有探索画布。
- **自主 Agent Harness**：Eve 是平台级首选候选，Pi Agent Core 是轻量可嵌入对照候选。
- **模型与流式交互**：AI SDK 是模型、工具协议和流式 UI 适配层，不是 Agent Runtime。
- **专业文档渲染**：`DesignDocument` 独立比较 Konva/Fabric，必要时以 Pixi/WebGL 提升渲染上限。
- **权威产品状态**：WorkflowDocument、DesignDocument、Command、Revision、Asset、Job、Capability、Provenance 与 Policy 始终由 Muses 拥有。

这项路线由 APCC 决策 `vercel-agent-harness` 管理。它确认分层和候选优先级，不冻结最终库。

## 2. 六层关系

```text
Muses Product Shell
├── AI Elements：Agent、Tool、Message、Node、Edge 等 UI 组件
├── Canvas Projection
│   ├── AI Elements Canvas + XYFlow（首选候选）
│   └── 自定义 DOM + Canvas/WebGL 混合投影（性能出口）
├── Muses Domain Kernel
│   ├── WorkflowDocument / DesignDocument
│   ├── Command / Revision / Asset / Provenance
│   └── Query / Capability / Job / Policy
├── Durable Execution
│   ├── Workflow SDK：WorkflowDefinition → WorkflowRun
│   └── BullMQ Worker：媒体与供应商任务执行
├── Agent Harness
│   ├── Eve adapter（平台级主候选）
│   ├── Pi adapter（轻量对照候选）
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
| `WorkflowDocument`   | 用户探索、布局、上下文、来源、分支和草稿连接 | 不直接执行，不由 SDK 保存                              |
| `WorkflowDefinition` | 经过类型、权限、副作用和版本校验的可执行定义 | 可以编译/映射为耐久执行入口                            |
| `WorkflowRun`        | 某个定义版本的一次执行及其步骤状态           | 可以由 Workflow SDK 承载，Muses 保存稳定引用与业务投影 |
| `Job`                | 单项媒体或供应商任务、尝试、费用和产物       | 可被 Workflow SDK 编排，由 Worker/Queue 执行           |

Platform Core Alpha 不让 Workflow SDK 延迟或拥有画布 Spike。执行适配已于 2026-07-27 从边界 Probe 推进为首批节点解释器：Next.js 服务端使用 `workflow@4.6.2`，自托管 Docker 使用 `@workflow/world-postgres@4.3.1`；浏览器提交 `WorkflowDocument`，Muses 先完成发布校验并编译独立 `WorkflowDefinition`，再由 SDK 创建可查询的耐久 `WorkflowRun`。纯领域解释器负责 Start 默认值、类型化 data binding、稳定执行序、输出提交、Selector 候选校验与 End 输出；一个通用 `"use workflow"` 循环只做编排，服务端 effect 位于静态 `"use step"`。Selector 通过私有 Hook 进入真实等待，运行事件写入 `muses:runtime` 命名流，API 按已知 tail 非阻塞读取并投影给 Studio。

`WorkflowDefinition 0.3.0-draft` 与 `WorkflowRuntimePort` 已冻结当前首图版本。`resumeRun` 对外只接受 Muses suspension id；API 在 `resumeHook()` 前通过 Hook metadata 核对 run、workspace、suspension 与候选白名单，原始 Hook token 留在服务端 adapter 内。默认图像路径已接真实 OpenAI Images Adapter；DesignDocument effect 与显式 Harness 图像仍是服务端回归 fixture，不调用浏览器夹具，也不冒充真实 Job/Capability。开发环境可使用 Local World，Docker/自托管环境使用需要长进程的 Postgres World；Vercel 部署使用 Vercel World，不能把 Postgres World 放进 serverless 函数。下一门是用首图和真实场景暴露的缺口接入正式 Job/Capability，而不是扩展任意节点或提前进入 Agent。

## 5. 为什么 Agent 需要 Harness

Codex 级 Agent 不只是一次模型调用加若干 tools。它至少需要：

- 长生命周期 Session、Run、Turn、Step 和崩溃恢复。
- 上下文选择、压缩、长期状态、技能和按需加载。
- 工具循环、并行执行、前后置策略、流式事件和证据。
- steering、follow-up、暂停、继续、取消和人工审批。
- 沙箱、权限、凭证隔离、网络策略、预算和审计。
- 子 Agent 的独立上下文、工具表面、并发、失败隔离和结果汇总。

AI SDK/Chat SDK 主要覆盖模型协议、结构化输出、工具调用和流式 UI。它们可以位于 Harness 下方，但不能替代上述运行时。

## 6. Eve 与 Pi 候选定位

### Eve：平台级主候选

Eve 是 Apache-2.0、filesystem-first 的耐久 Agent Framework，当前处于 Beta。公开能力包括默认 Agent loop、上下文压缩、Tools、Skills、State、Channels、Schedules、Human-in-the-loop、Subagents、Sandbox 和基于 Workflow SDK 的 step checkpoint/resume。

适合验证：

- MusesAgent 和领域 Agent 的长会话、暂停恢复和多入口渠道。
- Workflow SDK 与 Agent Run 的集成。
- per-session sandbox、工具审批、技能加载和子 Agent 隔离。
- 自托管 world、状态、流和运行观测能否满足 Muses 开放要求。

主要风险：Beta API 变化、框架约定较强、Vercel Sandbox/Workflow 的托管便利可能掩盖自托管差距，以及其 Session/State 不能取代 Muses 项目状态。

### Pi Agent Core：轻量对照候选

Pi 是 MIT 的 Agent Harness。Agent Core 提供多模型、工具循环、事件流、并行/串行工具、上下文变换、steering/follow-up 与状态管理；Coding Agent 还提供可分支 Session、自动压缩、Extensions、Skills 和可替换 UI。

适合验证：

- 低耦合、可嵌入的执行型 Agent Runtime。
- Muses 自己持有调度、状态和策略时，最小 Harness 需要多少代码。
- 本地优先、自托管或桌面执行场景。
- 与 Eve 比较性能、透明度、删除成本和框架锁定。

主要风险：默认没有完整权限和沙箱系统；扩展可执行任意代码；耐久工作流、多 Agent 调度、租户边界和生产恢复需要 Muses 或外部基础设施补齐。

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
- 任何操作先通过直接 UI/Capability 路径证明，再允许 Agent 通过同一公共端口调用；不以完成全部 Platform Core 作为真实 PPT 任务走查的前置条件。

### 首选候选

- 外层画布：AI Elements + XYFlow。
- 耐久工作流：Workflow SDK。
- 平台 Agent Harness：Eve。
- 轻量 Agent Harness：Pi Agent Core。
- 模型/流式 UI：AI SDK。

### 暂缓

- 最终专业画布渲染器。
- Workflow SDK 的正式 world/托管部署选择。
- Eve 或 Pi 的正式采用与版本固定。
- 多 Agent 拓扑、Agent SDK、模型供应商和长期记忆实现。

## 10. 后续验证顺序

1. 用当前 Studio 走查模板与空白工作流两条首图路径，不先改代码。
2. 只为 `Start → image.generate → End` 补实际暴露的 DSL、一个真实图像适配器、结果体验与最小可靠性边界。
3. 首图通过后运行一个真实 PPT 任务，并让首个阻断决定下一项技术验证。
4. 只有任务需要非确定性梳理或工具循环时，才定义 AgentRuntimePort 与单 Agent 安全、恢复、预算和审批验收夹具。
5. 用同一真实任务对照 Eve 与 Pi，不先实现 MusesAgent 或多 Agent。
6. 单 Agent 闭环可靠且任务确有委托需求后，再进入平台级 MusesAgent、领域 Agent 和多 Agent 调度。

技术候选的新版本不会自动改变路线。升级、替换和正式采用必须由可复现证据与 APCC 决策驱动。
