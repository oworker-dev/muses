---
name: 平台核心 Alpha 路线
description: Muses 工作流原生无限画布、专业文档节点、图像能力与 Agent 分阶段接入的当前工程关键路径。
---

# 平台核心 Alpha 路线

## 1. 当前目标

当前不先开发 MusesPPT，也不先开发 Agent。第一目标是交付一个不依赖具体场景、模型或 Agent 的 **Platform Core Alpha**：

```text
用户在工作流原生无限画布中放入输入
→ 创建图像生成或处理任务
→ 观察运行状态、错误、成本与来源
→ 获得多个结果分支并人工选择
→ 将结果送入 DesignDocument 专业节点
→ 进入纯设计画布做局部编辑
→ 返回外层继续连接、比较和处理
→ 保存、刷新、恢复并导出结构化项目
```

这条链路先由人通过界面完成。它证明创作状态、工作流图、专业编辑、资产、长任务和能力执行能够可靠连接；同时必须暴露完整的 Query、Command 与 Capability 端口，使后续 Agent 无需模拟鼠标、操作 DOM 或绕过服务端权威状态。

## 2. 顶层产品形态

Muses 不是纯设计编辑器，也不是纯 ComfyUI 式 DAG 编辑器。它是工作流原生的沉浸式无限创作空间，同时承载内容、过程、结果与可进入的专业编辑环境。

```text
Muses Workflow Canvas
├── 输入与上下文：Brief、Prompt、参考资料、品牌资产
├── 创作成果：图片、文本、视频、音频、页面、素材集合
├── 执行对象：Capability、Job、AgentRun、人工审批
├── 关系：上下文、来源、派生、比较和类型化执行依赖
└── 专业文档节点
    ├── DesignDocument：纯设计画布
    ├── PresentationDocument：演示与商业材料
    ├── VideoDocument：镜头与时间线
    ├── AudioDocument：轨道与混音
    └── FutureDocument：后续专业媒体
```

外层工作流画布负责组织创作过程；专业文档节点负责深度编辑。二者共享标识、资产、命令信封、修订引用、来源、权限和审计，但不共享全部领域对象或交互语义。

外层画布使用同一 `WorkflowDocument` 提供两种产品投影：

- **创作模式**：面向 Codia/Lovart 类用户心智，内容与结果优先，使用智能默认值和自动连线隐藏复杂度。
- **专业模式**：面向 Coze 类完整工作流编辑，显式展示节点、类型化输入输出、变量、人工审核、运行和调试。

专业模式是完整无损视图并先行交付；创作模式只能隐藏或折叠复杂度，不能生成另一套权威工作流。超过创作模式表达范围的子图应显示为高级步骤并允许进入专业模式，不得静默丢失语义。

专业模式先行首先是 DSL、完整节点语义和可靠执行的验证顺序，不表示用户应先理解内部 Schema 或 Runtime。每个节点的产品理由、用户心智、优先级、目标契约、完成定义和强制同步规则以[专业模式节点产品目录](专业模式节点产品目录.md)为准。Coze/Dify 的节点或 Workflow SDK 原语不得因技术上已有实现而直接成为 Muses 产品节点。

## 3. 三类边必须分开

画布上的连线不能全部自动解释为可执行工作流：

| 边类型        | 含义                                      | 是否直接执行         |
| ------------- | ----------------------------------------- | -------------------- |
| `context`     | Prompt、Brief、参考资料、品牌或选择上下文 | 否，只参与上下文装配 |
| `provenance`  | 产物由什么输入、任务、模型或修订产生      | 否，是已发生事实     |
| `association` | 用户组织、比较、批注或视觉关联            | 否                   |
| `dataflow`    | 类型兼容的输出到输入依赖                  | 可执行               |
| `control`     | 条件、审批、顺序或显式控制依赖            | 可执行               |

探索中的画布子图默认是可编辑草稿，不等于已发布工作流。只有通过端口类型、必填输入、权限、循环、安全、版本和副作用校验的子图，才能编译或发布为 `WorkflowDefinition`。探索图、已发布定义和某次 `WorkflowRun` 必须是不同对象。

## 4. 专业文档节点契约

首个专业节点是 `DesignDocument`，但契约必须适用于未来专业媒体。外层节点至少引用：

```ts
type ProfessionalDocumentNode = {
  nodeId: string;
  documentType: string;
  documentId: string;
  revisionId: string;
  previewAssetId?: string;
  inputPorts: PortSpec[];
  outputPorts: PortSpec[];
  status: "ready" | "editing" | "running" | "error";
};
```

行为规则：

- 外层节点显示预览、文档类型、当前修订、运行/错误状态和类型化端口。
- 聚焦节点后进入专业编辑器；退出后恢复外层空间位置、缩放和选择上下文。
- 外层边只能连接公开端口，不能直接连接 DesignDocument 内部某个图层或渲染对象。
- 内部对象需要被外层引用时，由专业文档显式发布选择集、Artifact 或类型化输出端口。
- 分支可以创建新修订或新文档分支，必须保留父修订和来源关系。
- 预览是可重建投影，不是专业文档的权威状态。

## 5. 两级文档、命令与修订

`CreativeDocument` 是跨媒体文档家族和共同信封，不应成为包含全部媒体细节的万能大对象。当前至少有两类具体权威文档：

- `WorkflowDocument`：拥有外层节点、端口、边、空间位置、分支、运行引用与探索状态。
- `DesignDocument`：拥有内层图层、文本、图片、形状、分组、布局、资产引用与专业编辑状态。

两类修改使用统一命令信封，但目标聚合和载荷 Schema 不同：

```text
CommandEnvelope
├── WorkflowCommand  → WorkflowRevision
└── DocumentCommand  → ProfessionalDocumentRevision
```

因此移动外层 DesignDocument 节点和移动其内部图片是两个不同命令。一次跨层用户意图可以通过 correlation ID 关联多个命令，但不能依赖跨层隐式内存状态或把内部图层复制为外层节点。

## 6. Platform Core Alpha 范围

### 必须包含

- `WorkflowDocument`、Node、Port、Edge、Command、Revision 与迁移 Harness。
- 无限工作流画布的平移、缩放、选择、框选、拖放、连接、分支布局和状态投影。
- `DesignDocument` 的图层、文本、图片、基础形状、分组、选择和变换最小编辑闭环。
- 可进入/退出的 DesignDocument 节点、预览和修订边界。
- Asset、Provenance、Job 与 Capability 的内存实现和真实基础设施适配器。
- 一个图像生成能力和一个输入输出清晰的图像处理能力。
- 结果分支、人工选择、失败、取消、受限重试、成本和来源可见。
- PostgreSQL/S3/Queue 持久化、自动保存、刷新恢复和结构化项目导出。
- 未来 Agent 可完整使用的 Query、Command 与 Capability 接口。

### 明确不包含

- LLM、Agent SDK、MusesAgent、领域 Agent 或多 Agent 调度。
- MusesPPT 页面模型、模板路线、PPTX 或 image-to-editable-SVG 路线。
- 通用工作流发布 UI、循环、复杂条件、市场或无人值守自动化。
- 视频时间线、音频工程、音乐、多人实时协作和 CRDT/OT。
- 完整专业设计工具、像素级图像编辑和所有媒体能力。
- 移动端、桌面端、插件市场和微服务拆分。

不在 Alpha 中实现不代表长期排除；扩展点必须是最小且有边界的，不能提前建设空泛框架。

## 7. 技术栈确认策略

### 当前可以固定

- TypeScript 作为 Web、领域契约和首批内核实现语言。
- React/Next.js 作为产品壳和交互宿主，不拥有领域真相。
- 模块化单体 Web/API 与独立 Worker 的部署起点。
- PostgreSQL 作为权威元数据与修订存储，S3 兼容存储管理大型资产。
- Valkey/BullMQ 作为当前异步 Job 基础，具体实现不得泄漏到 Job 契约。
- 服务端权威的 Command/Revision，客户端允许乐观投影但必须可回滚。
- 画布渲染、交互控制器、领域文档和持久化四层分离。

### 必须经过 Spike 再决定

- 工作流无限画布采用现成图编辑库、通用画布内核还是自定义混合层。
- DesignDocument 采用 Canvas 2D、SVG/DOM、WebGL 或混合渲染。
- 大对象量下的场景索引、虚拟化、命中测试和预览缓存策略。
- 客户端本地状态、命令缓冲与服务端确认的具体库和同步方案。
- 两层画布的嵌套焦点、快捷键、无障碍和事件路由实现。

候选库只作为可替换实现参与同一 Spike，不允许直接采用其内部节点模型作为 Muses Schema。

当前固定项、候选矩阵、许可证边界和评分规则见[画布 Alpha 最小技术栈基线](画布Alpha最小技术栈基线.md)，执行时间盒与证据结构见[两层画布技术 Spike 计划](两层画布技术Spike计划.md)。

### 当前不决定

- 具体大模型、Agent SDK、记忆框架和多 Agent 框架。
- PPT、SVG 重建、视频、音频或音乐专业路线。
- 多人实时一致性算法、微服务拓扑和最终云部署平台。

## 8. Gate 0：最小技术基线与契约

场景夹具、规模档位、参考设备、统计规则以及交互、保存、恢复、故障和可访问性强制门以[平台核心 Alpha 需求与体验预算](平台核心Alpha需求与体验预算.md)为准。候选技术不能使用自己的 Demo 数据或主观体验替代同条件测量。

使用同一个场景无关夹具比较候选实现：

```text
Start（类型化输入）
→ 图像能力占位节点
→ 三个结果分支
→ 人工选择
→ DesignDocument 节点
→ 进入后修改文本、图片与形状
→ 返回外层并连接 End
→ 通过发布校验并获得后端耐久 runId
→ 序列化、刷新与恢复
```

这条含三个结果分支、人工选择和 DesignDocument 的链路是 Gate 0 组合测试夹具，用于同时覆盖集合、等待恢复和两层画布，不是专业模式的默认生图模板。正式首图最小模板是 `Start → image.generate → End`，生成数量默认 1；只有用户明确需要多结果审核或深度编辑时才添加 `human.review` 或 `document.design`。节点产品语义以[专业模式节点产品目录](专业模式节点产品目录.md)为准。

Spike 必须测量：

- 平移、缩放、选择、框选、拖放、连线和嵌套焦点体验。
- 外层节点和内层对象达到阶段规模时的帧率、交互延迟、内存与恢复时间。
- 外部代码只通过 Command 完成所有持久修改。
- 序列化结果不含候选库的不可迁移内部类型。
- 键盘、焦点、缩放和进入/退出专业节点的可访问性。
- 卸载、错误、过期修订与恢复的明确行为。

退出条件：形成采用/淘汰证据，冻结最小领域契约和包边界；未通过时缩小 Alpha 对象规模或交互范围，不用增加抽象掩盖问题。

## 9. 实施顺序与退出门

自 APCC 决策 `decision-5` 起，以下 Slice 不再作为按组件串行完成的时间顺序，而是用户成果暴露缺口后的能力池。当前唯一价值 Gate、观察方法和拉取规则以[用户成果驱动交付计划](用户成果驱动交付计划.md)为准：先在专业模式跑通用户友好的真实首图，再由真实 PPT 任务逐项扩展边界。

### Slice 1：工作流无限画布

先交付工作流图内核 Harness，再交付画布投影，最后接持久化、历史和结构化导出。

专业模式投影先直接对齐 Coze 的成熟节点逻辑和操作约定，但使用 Muses 技术栈与领域契约重写。画布瞬时拖动、视口、选择和面板状态只存在于 adapter；松手、连接、删除和配置确认才形成领域 Command。

退出条件：同一 WorkflowCommand 可由 Harness 和 UI 执行；不同边语义不会混淆；节点拖动实时跟手且只在结束时提交一次持久命令；刷新后位置、连接、分支和修订一致；运行状态只是 Job/Run 的投影。

当前已完成的执行边界纠偏：Start/End 是不可重复创建和删除的领域节点，Start 输入变量生成类型化输出端口；发布校验覆盖必填绑定、端口类型、悬空边、执行环和 Start→End 路径；纯编译器将编辑文档转换为不含坐标、标题和运行结果的独立 `WorkflowDefinition 0.3.0-draft`。首批节点服务端解释器已在 Next.js + Vercel Workflow SDK + Postgres World 上运行 `Start → image-generator → selector → design-document → End`：纯领域状态负责默认值、数据绑定、类型、执行序、输出提交与人工选择校验；SDK 只负责耐久编排、step、Hook 和事件流。Selector 会真实等待并由授权后的 PATCH 恢复，不自动选择；默认图像路径已接真实适配器，DesignDocument 和显式 Harness 图像仍使用服务端回归夹具。Studio 已持久化最后一次耐久运行指针，刷新后可重新投影等待状态；等待期间重启 Web/Workflow 进程时，Postgres World 会重新入队活动运行，Hook、事件流与候选仍可恢复。由于 Workflow SDK 的每次 `resumeHook()` 都会写入 `hook_received` 且不提供请求幂等键，Muses 使用 PostgreSQL 恢复回执串行化同一 suspension，并在 Hook 已释放或进程重启后为相同幂等键回放成功响应。等待中的运行还可通过 Muses 取消入口终止：取消与恢复共享 run 级数据库 advisory lock；SDK 只写入一次 `run_cancelled`，World 自动释放 Hook，Studio 保留历史但不再显示失效候选，并可在刷新后恢复已取消状态。

失败语义也已完成 Gate 0 验证：supported-node Step 固定为最多两次重试、三次总尝试；永久错误在第一次 `FatalError` 后停止，瞬时错误通过 `RetryableError` 产生可见 attempt 并可在第三次恢复。Selector 使用 Hook 与 durable `sleep()` 竞速，超时后进入结构化终止失败、释放 Hook 且不再投影失效候选。Studio 显示失败原因与尝试次数；只有 retryable failure 可从 World 读取旧 run 的冻结定义和输入并创建带 `retryOfRunId` 的新 run，PostgreSQL retry receipt 让相同请求稳定返回同一目标 run，旧失败事实不会被覆盖。受控故障只存在于服务端 Harness 参数，不进入节点配置或 `WorkflowDefinition`。

### Slice 2：DesignDocument 专业节点

先交付 DesignDocument 内核 Harness，再实现可进入的最小设计画布和外层节点。

退出条件：外层与内层状态分别权威；内部图层不泄漏为外层节点；进入、编辑、退出、分支和恢复成立；预览可重建。

### Slice 3：图像能力闭环

交付 Asset/Provenance、Job/Capability、图像生成和图像处理真实适配器，再完成无 Agent 闭环。

退出条件：用户能创建输入、发起任务、观察进度、取消/重试、比较分支、选择结果、进入 DesignDocument 编辑并恢复项目；失败不产生重复收费或悬空权威状态。

### Platform Core Alpha Gate

每个内核必须具有独立 Harness、版本化契约、故障测试、真实适配器和组合证据。Query、Command 与 Capability 必须足以让外部程序完整操作两层画布，且没有 DOM、鼠标模拟或数据库写旁路。

这个 Gate 用于宣称 Platform Core Alpha 达到完整独立与组合成熟度，不是开始 PPT 真实任务走查的前置条件。若首图或 PPT 在此之前暴露 Agent 需求，Agent 只能调用已经通过直接 UI/Capability 路径验证的操作；未验证能力不能由 Agent 包装后绕过本 Gate。

## 10. Agent 分阶段接入

### Agent Core Alpha

先定义可替换的 AgentRuntimePort，再用同一任务比较 Eve 平台级 Harness 与 Pi 轻量 Harness：上下文装配与压缩、计划、工具循环、预算、权限、确认、流式事件、steering、暂停恢复、沙箱和检查点。AI SDK 只作为模型/流式适配，Workflow SDK 只作为耐久执行候选。单 Agent 只通过 Query、Command 与 Capability 操作外层 WorkflowDocument 和内层 DesignDocument。

### Agent Orchestration

单 Agent 可靠后再增加：

- `MusesAgent`：平台级意图理解、澄清、跨领域计划与委托。
- 领域 Agent：版本化领域知识、工具、策略和验收配置。
- 执行型 SubAgents：在明确任务、权限、依赖和预算下执行专业工作。
- Runtime Scheduler：真正管理并发、重试、取消、检查点、失败隔离、结果汇总和成本归因。

MusesAgent 可以决定委托什么，领域 Agent 可以细化专业任务，但只有 Runtime Scheduler 拥有可靠调度状态。固定的“主 Agent → 领域 Agent → 多 Agent”层级不能写死在通用内核；简单任务应允许单 Agent 或直接 Capability 完成。

## 11. 场景用于拉动边界

首图 Gate 通过后立即用一个真实 MusesPPT 任务运行当前平台，不等待 Platform Core 和 Agent 层按组件清单全部完成。该任务先暴露首个成果阻断，再决定是否拉动 WorkflowDocument、专业文档、Asset、Job、Capability、Agent、设计或导出能力。

- 当前不以 PPTX、模板或 SVG 路线预先决定平台核心契约。
- MusesPPT 只能消费当轮已证明的公共接口；缺失能力先以最小纵向切片验证，再判断是否形成通用契约。
- 页面模型、模板方法、视觉生成和可编辑重建路线在真实任务中重新探索，不受历史项目默认方案约束。
- Agent 不是 PPT 的固定前置层；只有直接 Capability 与人工工作流不足时才拉取单 Agent，多 Agent 必须晚于单 Agent 可靠闭环。
- AI 短剧用于验证跨场景复用，并只扩展真实缺失的时间线、视频、配音、音效与音乐专业节点。

真实业务证据持续用于排序、抽象升级和停止判断。场景不得绕过权威状态、权限、幂等、来源或迁移边界。

## 12. 当前下一步

当前唯一下一步是[用户成果驱动交付计划](用户成果驱动交付计划.md)中的 Gate 1：

1. 冻结首图用户任务、观察指标、硬护栏和停止规则。
2. 用当前 Studio 完整走查模板与空白路径，先形成按成果阻断排序的缺口表。
3. 只补 `Start → image.generate → End` 真实首图需要的 DSL、一个真实适配器、结果体验和最小权威状态。
4. 由产品负责人无讲解完成真实生图；未通过时回到具体缺口，不转向无关技术任务。
5. 首图 Gate 通过后，用一个真实 PPT 任务运行现有能力，再逐项拉动文本、Agent、PresentationDocument、设计或导出等实际缺口。

正式发布持久化、SDK `start()`/receipt 崩溃窄窗口、A1 规模、DesignDocument 完整度和其他 Runtime 工作保留为缺口池；只有首图或后续真实场景实际阻塞时才拉取，不再自动排在用户成果之前。

当前任务、负责人和实时状态以 `apcc status` 为准。
