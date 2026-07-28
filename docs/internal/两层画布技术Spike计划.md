---
name: 两层画布技术 Spike 计划
description: 使用统一 PC-A01 夹具比较外层工作流画布与 DesignDocument 候选的时间盒、实现切片、证据和退出规则。
---

# 两层画布技术 Spike 计划

## 1. 目标

在不冻结最终领域契约的前提下，用可运行代码回答四个问题：

1. `WorkflowDocument` 与 `DesignDocument` 能否作为两个独立权威文档，经统一 Command 信封驱动同一沉浸式体验。
2. AI Elements + XYFlow + Konva 能否满足 `PC-A01` 功能闭环与 `A1` 性能、恢复和可访问性预算。
3. Fabric 或自定义混合外层是否提供足够大的可测收益，值得增加实现和维护成本。
4. 最小领域 Schema、adapter 接口和包边界能否保持候选库无关。

Spike 不是产品功能发布，也不接真实付费模型、PPT、Agent 或多人协作。

## 2. 时间盒与阶段

| 阶段             |        建议时间盒 | 产物                                                             | 停止条件                         |
| ---------------- | ----------------: | ---------------------------------------------------------------- | -------------------------------- |
| `S0 Harness`     |        1–2 工程日 | 纯 TS 两级文档、Command reducer、F0/A1 生成器、确定性 Capability | UI 之外可完成序列化和命令重放    |
| `S1 C1 闭环`     |        3–4 工程日 | AI Elements + XYFlow + Konva 的 PC-A01 可操作原型                | F0 功能与两层焦点链路通过        |
| `S2 可靠性`      |        2–3 工程日 | 自动保存模拟、过期 revision、断网、取消竞态与恢复                | 无数据丢失/写旁路硬失败          |
| `S3 规模与 A11y` |        2–3 工程日 | A1 trace、内存、结构视图、纯键盘路径                             | 得到完整强制门数据               |
| `S4 对照`        | 每个 2 工程日上限 | C2 内层或 C3 外层的聚焦对照                                      | 足以判断收益，不补齐完整产品功能 |
| `S5 决策`        |          1 工程日 | 候选评分、采用/淘汰记录、契约冻结输入                            | APCC 决策与证据包一致            |

首轮总时间盒建议 9–13 个工程日；只有 C1 暴露明确风险时才进入对应对照。时间盒到期仍无法测量的能力记为失败或未知风险，不能无限延长原型。

## 3. Spike 代码边界

Spike 代码进入正式仓库，但放在可删除边界：

```text
src/packages/domain/              # 候选无关的最小实验内核
src/packages/contracts/           # 实验 Schema 与版本
src/packages/testing/             # PC-A01、F0/A1/S2 与故障注入
src/packages/canvas-workflow/     # AI Elements/XYFlow/custom adapters
src/packages/canvas-design/       # Konva/Fabric adapters
src/apps/web/app/.../canvas-spike # 受保护的开发入口
delivery/evidence/platform-core-alpha/gate-0/
```

可以保留通过验证的纯领域代码，但不得因为代码已经写出就默认成为正式契约。候选适配器应能整目录删除而不破坏 Command reducer 测试。

## 4. S0 最小实验对象

在正式契约冻结前只实现夹具必需字段：

- `WorkflowDocumentDraft`：id、schemaVersion、revision、nodes、edges、selectionRef、jobRefs。
- `DesignDocumentDraft`：id、schemaVersion、revision、elements、publishedPorts、assetRefs。
- `CommandEnvelopeDraft`：id、targetType、targetId、expectedRevision、idempotencyKey、correlationId、payload。
- 五类 Edge、类型化 Port、ProfessionalDocumentRef、AssetRef、JobRef、ProvenanceRef。
- reducer 返回新状态、事件和 rejection，不执行 I/O。

名称中的 `Draft` 表示实验结构；Gate 0 结束前不承诺兼容性。候选库 id 可以在 adapter 内映射，但不能成为领域 id 生成规则。

## 5. 必测路径

### 功能

- 完整执行 `PC-A01`，包括不兼容连接拒绝、三结果选择、进入/退出专业文档和结构化导出。
- UI 与无 UI Harness 产生语义相同的 Command 序列和最终文档。
- 外层节点移动与内层元素移动分别只改变自己的 revision。
- 外层预览引用明确的内层 revision，旧预览不会冒充当前文档。

### 可靠性

- 相同 idempotency key 双提交。
- 双标签页发送过期 revision。
- 保存前断网、保存确认后刷新、浏览器崩溃后恢复待同步命令。
- Job 排队/运行时取消、取消与成功同时发生、Worker 重启和迟到结果。
- 连续 100 次 undo/redo 与跨层焦点切换。

### 规模与稳定性

- F0 每次提交回归；A1 在固定参考机完成性能 Gate。
- S2 只绘制退化曲线并记录首个拐点。
- 20 次进入/退出、20 次项目切换和 30 分钟连续操作后测内存。

### 可访问性

- 纯键盘完成 PC-A01。
- 节点/边结构视图与画布选择双向同步。
- 进入/退出专业文档恢复焦点；边类型不只依赖颜色。
- axe 自动检查与一次屏幕阅读器结构走查。

## 6. 测量实现

- 数据生成器必须带固定 seed，输出 fixture manifest 和内容哈希。
- 浏览器测试记录候选版本、Git revision、Chromium 版本、视口、CPU/网络节流和运行编号。
- PerformanceObserver 采集 long task、event timing 和 navigation；Playwright 保留 trace。
- 使用浏览器内存 API 时标明可用性；最终 heap Gate 在固定 Chromium 调试环境重复测量。
- 每轮输出机器可读 JSON 与人类摘要，禁止手工复制单次最好成绩。

建议证据结构：

```text
delivery/evidence/platform-core-alpha/gate-0/
├── manifest.json
├── c1-ai-elements-xyflow-konva/
│   ├── README.md
│   ├── results.json
│   ├── serialization-sample.json
│   └── traces/
├── c2-ai-elements-xyflow-fabric/
├── c3-custom-winner/
└── decision.md
```

大型 trace、录像和 heap snapshot 不进入 Git；仓库只记录哈希、生成命令、摘要和受控存储位置，避免公开用户数据或让仓库膨胀。

## 7. 对照触发规则

### 触发 C2：Fabric

- Konva 的文本/输入法或变换控件需要超出 Alpha 时间盒的大量自建工作；或
- Konva 通过性能门，但 PC-A01 编辑质量无法达到用户可用；或
- Fabric 可用 2 工程日聚焦原型证明明显更低实现成本。

### 触发 C3：自定义混合外层

- XYFlow 在 A1 持续违反帧、长任务或内存硬门；或
- 五类边、虚拟化、结构视图或事件路由无法通过 adapter 补足；或
- XYFlow 类型无法从结构化导出与 Command 边界中彻底隔离。

Workflow SDK 不进入本次 renderer 对照。Spike 只投影确定性 Job/Run 状态；将已发布 WorkflowDefinition 映射到 Workflow SDK 是后续独立执行 Spike，不能反向改变画布领域 Schema。

### 触发 Pixi 第二轮

- D1/D2 在保持正确性和资源治理后仍无法满足 A1；且 trace 证明瓶颈主要来自 Canvas 2D 绘制，而非 React、图片解码、数据模型或同步逻辑。

## 8. 退出门

Spike 完成需要：

1. 至少 C1 提交完整 F0 证据和 A1 核心测量；失败也必须可复现。
2. 所有硬失败有明确结论，未测项标为 unknown。
3. 对照仅在触发条件成立时执行，并使用同一 Draft Schema 与 fixture。
4. 选定外层、内层、状态投影和测试实现，或明确记录无候选通过并重新规划。
5. 形成最小正式契约建议，但不在 Spike 任务内静默冻结。
6. 通过 APCC 记录采用/淘汰决策，再进入 `freeze-core-alpha-contracts`。

如果没有候选通过，正确结果是保留证据并修订规模、范围或技术路线；不得把失败原型包装成 Alpha 实现继续堆叠。

## 9. 外层工作流交互壳基线

首轮 C1 闭环证明了状态边界，但第一次人工检查判定节点抽象、画布不跟手且整体不可直接面向用户。该结果不是通过可用性 Gate，而是触发 `decision-4` 的修订输入。外层交互壳按以下原则继续 Spike：

- 同一 `WorkflowDocument` 提供创作模式与专业模式两种投影，不复制权威状态；专业模式是完整无损视图并优先交付，创作模式后续隐藏变量、端口和控制细节。
- 专业模式直接以 Coze Studio 的成熟信息架构和节点逻辑为体验基准：按需弹出的搜索节点库、中央拓扑图、360px 任务节点、节点点击打开右侧配置面板、底部画布工具与独立试运行控制。
- 参考源码固定为 `coze-dev/coze-studio@22275b1`（Apache-2.0），本地只读研究材料位于 `.tmp/coze-studio-reference`。Muses 使用 React、AI Elements、XYFlow、shadcn 和领域 Command 重写，不引入 Flowgram、Coze 表单运行时或其领域状态。
- 画布瞬时交互状态与领域权威状态分离：拖动过程中由 XYFlow adapter 实时更新位置，松手后只提交一次 `workflow.node.move`；不得在每帧执行领域 reducer、持久化或远程写入。
- 节点表达用户任务、必要配置、输入和输出；Asset、Job、Provenance 默认是节点输出数据，不因内部实现自动膨胀为画布节点。生成候选在节点配置或运行结果面板中查看，只有显式分支或人工审核才成为流程步骤。
- 变量 UI 默认显示来源节点、字段、类型和预览，不直接暴露 `{{node.port.path}}`；底层仍持久化结构化 `sourceNodeId + sourcePortId + path`，选择变量等价于 typed-edge Command。
- 可用变量按作用域、端口类型和无环约束过滤；多输入端口显式声明 `allowsMultiple`，普通输入拒绝第二个数据流绑定。
- 节点标题、状态、常用输入输出保持在节点上；模型、比例、数量、错误策略、运行结果和调试进入右侧配置面板；revision、id 和命令记录默认折叠为开发者详情。
- 输出端口旁提供 Coze 式续建入口：点击 `+` 打开上下文节点库，只展示存在类型兼容输入端口的候选；选择后在来源节点右侧进行防重叠布局，并通过同一标准 Command 序列提交 `workflow.node.add` 与 `workflow.edge.add`，不得建立 UI 私有连线状态。
- 图像能力节点的 Side Sheet 必须区分“配置”与“运行详情”：展示实际解析后的 Prompt、Job 状态、输出 Asset 数量、开始/完成时间、耗时和 Credits；结果用 Asset 画廊消费，Job/Asset id 收入折叠的开发者详情。未运行节点明确显示“尚未运行”。
- 视口默认由用户控制，不因运行、选择结果或切换步骤自动移动相机；适配全图是明确的用户动作。画布提供鼠标与触控板两套输入约定。
- 运行交互继续保持轻量控制面。未来 Workflow SDK 只负责 `WorkflowDefinition → WorkflowRun` 的耐久执行，通过 adapter 投影 Run、stream 和 observability，不拥有画布文档或瞬时交互状态。
- `/studio` 使用站点语义主题令牌、跟随 `next-themes` 的 system/light/dark，并通过 `next-intl` 同时维护英文和简体中文消息。

专业模式体验 Gate 至少要求：节点在指针按下期间实时跟随；节点库和配置面板不永久挤占画布；从任一输出端口续建时只出现类型兼容节点并自动形成可见变量绑定；单节点运行后可直接读懂输入、状态、成本和结果；Gate 0 组合夹具“开始 → 图像生成 → 人工选择 → 设计画布 → 结束”无需解释内部 Schema 即可理解；生成结果不产生无意义的图节点爆炸。该组合夹具不是默认产品模板，正式首图节点与体验要求以[专业模式节点产品目录](专业模式节点产品目录.md)为准。
