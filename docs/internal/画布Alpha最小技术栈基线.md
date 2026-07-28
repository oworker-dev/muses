---
name: 画布 Alpha 最小技术栈基线
description: Muses Platform Core Alpha 已固定技术基础、两层画布候选、许可证边界与 Spike 决策规则。
---

# 画布 Alpha 最小技术栈基线

## 1. 决策状态

本文只冻结高置信、难以延后且会影响 Gate 0 实施方式的选择。工作流画布与 `DesignDocument` 渲染器仍处于候选状态，必须通过[平台核心 Alpha 需求与体验预算](平台核心Alpha需求与体验预算.md)的同条件 Spike 后才能采用。

截至 2026-07-25，仓库已有 Next.js 16、React 19、TypeScript 5.9、Hono、Zod 4、PostgreSQL、MinIO、Valkey/BullMQ 与 Playwright 基础，没有历史画布库或客户端状态库需要兼容。

## 2. 已固定基线

| 关注点 | Alpha 基线 | 边界 |
| --- | --- | --- |
| 语言 | TypeScript 5.9+，严格模式 | 权威 Schema、Command 与迁移不得依赖 UI 库类型 |
| 产品壳 | React 19 + Next.js 16 App Router | 页面和交互宿主，不拥有领域真相 |
| API | Hono + Zod 4 | Zod 只负责边界解析与版本校验，不代替领域行为 |
| 部署 | 模块化单体 Web/API + 独立 Worker | 不在 Alpha 拆分画布微服务 |
| 权威元数据 | PostgreSQL | 文档、revision、command、job 和 provenance 使用租户边界 |
| 大型资产 | S3 兼容存储，开发环境 MinIO | 文档只持有 AssetRef，不内嵌二进制 |
| 异步任务 | BullMQ + Valkey | 仅是 Job 适配器，不泄漏 queue 类型到公共契约 |
| 领域校验 | Zod 4 + 显式 Schema 版本 | 输入解析后仍由领域内核执行不变量校验 |
| 客户端投影状态 | XYFlow adapter 内存状态；Zustand 5 保留为规模化候选 | 只保存拖动中位置、视口、选择、节点库、Inspector、乐观队列等可重建状态；松手后才提交领域 Command |
| 测试 | Vitest（纯 TS/组件）+ Playwright（浏览器/性能/无障碍链路） | 性能 Gate 仍需固定参考机 trace，不以 CI 单次时间替代 |
| 可观测性 | 现有日志边界 + 浏览器 Performance trace | 记录 command、revision、job、candidate 和 fixture 版本 |

Zustand 不作为权威文档模型，也不能成为 Command reducer 的唯一实现。若 Spike 证明 React 原生 external store 或更小方案足够，可以删除 Zustand，不影响领域契约。

## 3. 包与依赖方向

Alpha 按以下依赖方向实现，不因候选库改变：

```text
apps/web ───────────────┐
apps/api ───────────────┼→ application → domain
apps/worker ────────────┘       │          ↑
                                ├→ contracts
canvas adapters → application ──┘
infrastructure adapters → application
```

建议在现有 `src/packages/` 下逐步形成：

| 包 | 责任 | 禁止内容 |
| --- | --- | --- |
| `domain` | WorkflowDocument、DesignDocument、Command reducer、Revision、图不变量 | React、XYFlow、Konva、Fabric、PostgreSQL、BullMQ |
| `contracts` | 版本化输入输出 Schema、事件信封、结构化导出格式 | 数据库实体或候选库序列化对象 |
| `application` | Query/Command/Capability 用例、授权、幂等和事务编排 | DOM、Canvas 实例、供应商 SDK |
| `canvas-workflow` | 外层画布投影、交互控制器、候选适配器 | 成为 WorkflowDocument 权威状态 |
| `canvas-design` | 专业文档投影、命中测试、变换控制器、候选适配器 | 把渲染节点当 DesignDocument 权威对象 |
| `persistence` | PostgreSQL/S3/Queue 适配器与迁移 | 业务场景类型或画布库类型 |
| `testing` | `PC-A01` 数据生成器、确定性 Capability、故障注入和测量工具 | 只适用于某个候选的私有夹具 |

候选库事件必须先翻译为 Muses Intent，再经应用层形成 Command。服务端接受 Command 并返回新 revision；客户端可以乐观投影，但失败时必须按确认结果回滚或进入冲突处理。

## 4. 外层工作流画布候选

### 候选 W1：AI Elements + XYFlow

- 基线包：`ai-elements@1.9.0`（Apache-2.0）与 `@xyflow/react@12.11.2`（MIT）。AI Elements 的 `Canvas` 直接包装 React Flow 并透传 `ReactFlowProps`。
- 使用范围：AI 原生 Node/Edge/Controls/Toolbar 视觉原语，以及视口、节点/边投影、选择、拖动、连接和基础可见性优化。
- 优势：图交互成熟、React 集成直接、与 shadcn/AI UI 生态一致，可以较快验证五类边、类型化端口和运行状态节点。
- 核心风险：AI Elements 是 UI 组件层而非领域内核；底层仍有 DOM/SVG 密度、内部 Zustand 与 Muses store 的边界、键盘结构视图不足和 Schema 泄漏风险。
- 采用前提：`A1` 通过预算；序列化自动检查无 XYFlow 类型；全部持久修改可映射为 Muses Command；结构视图补足键盘和屏幕阅读器路径。
- 专业模式 UX 基准：直接研究 `coze-dev/coze-studio@22275b1` 的节点面板、360px 节点、右侧配置、变量选择和底部工具栏，以 Muses 的 XYFlow/shadcn adapter 重写；不得因“自行设计”降低已被成熟产品验证的操作下限。
- 交互状态规则：`onNodesChange` 必须实时更新 adapter 节点，`onNodeDragStop` 只提交一次 `workflow.node.move`。如果每个指针事件进入领域 reducer、localStorage、数据库或网络写入，视为硬失败。

### 候选 W2：自定义混合投影

- 基线组成：React DOM 节点层 + Canvas 2D 边/装饰层 + 独立空间索引；空间索引可试用 MIT 的 `rbush@4.0.1`。
- 使用范围：保留 DOM 节点的语义/表单可访问性，把高数量边和装饰从 SVG/DOM 中剥离。
- 优势：完全控制边语义、细节降级、虚拟化、事件路由与开放许可；长期性能上限更可控。
- 核心风险：选择、框选、连接、路由、缩放、命中测试和无障碍需要自行实现，初期工程量显著更高。
- 采用前提：在严格时间盒内证明关键交互和 `A1` 性能相对 W1 有实质优势；否则不因“理论上更自由”提前自研。

### 外层不采用项

- `tldraw@5.2.5`：当前默认许可证只允许开发环境使用，生产部署需要单独许可与 License Key，并包含技术执行和使用数据条款。它可作为体验参考，但不进入 Muses 默认生产内核或 Gate 0 代码依赖。
- ComfyUI、Rete、LiteGraph 等完整工作流对象模型：当前不作为首选，因为 Muses 的探索图、来源边、专业文档节点和发布工作流边界不同；如后续只复用无状态布局或路由算法，需另行评估。

### Workflow SDK 不属于画布候选

Workflow SDK 是 `WorkflowDefinition → WorkflowRun` 的耐久执行候选，不负责 WorkflowDocument 的空间布局、探索边、选择或专业文档节点。Gate 0 画布 Spike 使用确定性 Job/Run 投影，不为接入 Workflow SDK 延迟；正式执行映射在发布工作流或 Agent 持久 Run 阶段独立验证。

## 5. `DesignDocument` 候选

### 候选 D1：Konva + react-konva

- 基线包：`konva@10.3.0`、`react-konva@19.2.5`，MIT，React 19.2 对等依赖已匹配。
- 使用范围：Canvas 2D 场景投影、图层、选择框、变换控制与基础命中测试。
- 优势：投影层较薄、React 集成当前、对象和事件能力足以完成 Alpha 的文本/图片/形状/分组/变换。
- 核心风险：文本编辑仍需 DOM overlay；可访问性必须依赖同步结构视图；大量对象和图片缓存需要主动治理。
- 采用前提：不持久化 Konva Node JSON；输入法文本编辑、缩放变换、撤销和 `A1` 内存/帧预算通过。

### 候选 D2：Fabric.js

- 基线包：`fabric@7.4.0`，MIT，2026-05 仍有发布。
- 使用范围：Canvas 2D 交互对象、控制点、文本和图片编辑原型。
- 优势：内建对象控制与文本能力较完整，可能减少 Alpha 编辑交互实现量。
- 核心风险：包体和对象模型更重，内部序列化很容易反向成为产品 Schema；React 生命周期适配和 1,000 对象性能需要实测。
- 采用前提：通过独立 adapter 且不使用 Fabric JSON 作为权威格式；`A1` 性能、输入法、清理释放与分支恢复不弱于 D1，或能以显著更低实现成本弥补差异。

### 升级候选 D3：PixiJS

- `pixi.js@8.19.0` 与 `@pixi/react@8.0.5` 为 MIT，并支持 React 19。
- 只在 D1/D2 无法满足目标规模或后续专业媒体需要 GPU 合批时启用第二轮 Spike。
- Alpha 首轮不选它，因为文字输入、编辑控件、可访问结构和资源生命周期需要更多自建工作；纯渲染上限不能抵消用户编辑体验风险。

### 内层不采用项

- SVG/DOM 全对象渲染：保留为结构视图和文本输入层，不作为 1,000 对象专业画布的首轮完整渲染候选。
- tldraw 编辑器内核：许可证和产品对象模型边界均不适合当前默认路线。
- image-to-editable-SVG：这是未来场景能力问题，不是 `DesignDocument` 渲染内核选择条件。

## 6. 候选组合与实验顺序

首轮只比较能回答最高风险问题的三个组合，避免四组全排列浪费时间：

| 组合 | 外层 | 内层 | 目的 |
| --- | --- | --- | --- |
| `C1` | AI Elements + XYFlow | Konva | 最短路径基线，优先证明 AI 原生外层、两层闭环与公共 Command 边界 |
| `C2` | AI Elements + XYFlow | Fabric | 隔离比较专业编辑实现成本、文本能力、性能和 Schema 泄漏风险 |
| `C3` | 自定义混合 | C1 胜出的内层 | 只比较外层在 `A1` 的性能、语义和无障碍收益是否值得自研成本 |

先做 `C1`。若 C1 已在不可修正的硬阻断项失败，再进入 C2/C3 对应替换；若只存在可测性能差距，先保持相同夹具完成比较，不在中途改 Schema 或预算。

## 7. 选择评分与硬门

满足全部硬门后才评分：

- MIT/Apache-2.0/BSD 等可兼容开放分发许可，且无生产 License Key、强制遥测或自托管限制。
- 权威 Schema 和结构化导出不含候选库类型。
- 全部持久 UI 行为通过 Muses Command；候选实例不能直接写服务端状态。
- `F0` 功能、键盘和故障链路全部通过。
- `A1` 核心交互、打开和恢复达到预算，或有明确、有限、可在 Alpha 内关闭的差距。
- 没有数据丢失、跨层状态混淆、不可恢复冲突或资源持续泄漏。

通过硬门后按下列权重评分：

| 维度 | 权重 |
| --- | ---: |
| 用户交互与两层切换质量 | 25 |
| `A1` 性能、内存和稳定性 | 20 |
| 领域隔离、可迁移和可测试性 | 20 |
| 键盘、结构视图和辅助技术适配 | 15 |
| Alpha 实现/维护成本 | 10 |
| 生态活跃度、React 兼容与升级风险 | 10 |

评分不能让某个硬失败被其他优势平均掉。总分差小于 5 分时，选择依赖更少、领域隔离更简单、删除成本更低的方案。

## 8. 暂缓决策

- 不在 Gate 0 决定 CRDT/OT、多人协作或离线优先同步框架。
- 不引入 XState 作为通用状态总线；复杂 Job/Agent 状态可以在对应阶段独立评估。
- 不决定自动布局引擎；标准夹具使用确定性布局，先验证编辑与连接。
- 不决定 WebGL/WebGPU 终局；Canvas 2D 未达到预算时再用证据触发。
- 不决定 Agent、PPT、视频、音频、音乐或 SVG 重建技术。
- Workflow SDK、Eve、Pi 和 AI SDK 的长期位置遵循[平台技术栈与 Agent Harness 路线](平台技术栈与AgentHarness路线.md)，不进入本次画布 renderer 评分。

## 9. 当前结论

Muses 当前固定 TypeScript/React/Next.js 产品基础、服务端权威 Command/Revision、PostgreSQL/S3/Queue 适配边界和 Vitest/Playwright 验证组合。画布实现不冻结：首个 Spike 组合为 **AI Elements + XYFlow + Konva**，Fabric 是内层对照，自定义 DOM/Canvas 混合层是外层对照，Pixi 是性能升级候选。

这是一项可撤销的实现选择，不是领域架构决策。只有完成统一证据包后，才能把候选提升为 Alpha 正式依赖。
