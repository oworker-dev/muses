---
name: 独立 Web Agent 项目与 Muses 宿主集成
description: Web-first 通用 Agent、独立 Workflow Engine 与 Muses 首个宿主之间的稳定产品和依赖边界。
---

# 独立 Web Agent 项目与 Muses 宿主集成

## 1. 决策

Muses 所需的 Codex 级 Agent 不是 Studio 内部功能，也不是为首图路径定制的模型循环。它首先是一个可以独立发布、部署、运行和集成的 Web-first Agent 项目；Muses 是它的第一个宿主。

该 Agent 项目在不安装任何 Muses、Canvas、Workflow、PPT、Image 或 Next.js 产品模块时，仍必须完成通用自主任务。文件、终端、Web、浏览器、Skill、MCP、自定义工具、上下文、审批、沙盒、委托、流式事件和 eval 属于 Agent 产品能力；画布、资产、媒体和工作流只由宿主通过工具注入。

CLI 是开发、诊断和自动化入口，不是当前主要用户体验。生产主体验是可独立部署的 Web Agent，并提供可嵌入的 UI、Client SDK 和 Host SDK。

## 2. 两个独立项目、三个产品边界

当前以两个可以独立构建、运行和发布的项目推进：

- `/root/projects/muses-agent`：通用 Web Agent 产品，包含 Eve Harness、Agent 服务、Web 工作台、Client/Host SDK、开放 UI、Sandbox、Tool、Skill、MCP 和 Eval。
- `/root/projects/saas`：Muses AI 设计平台。Muses Host 和 Workflow Engine 在同一仓库中保持模块与运行边界独立，后续是否拆仓由真实部署和团队所有权决定，而不是预先微服务化。

项目数量不改变产品边界。Agent、Workflow Engine 和 Muses Host 仍是三个独立物种：

```text
Standalone Web Agent Project          Workflow Engine
  Agent Contracts                       Workflow DSL
  Agent Runtime                         Compiler / Validator
  Harness adapters                      Durable Runtime
  Web application                       Version / Deployment
  Client SDK / Host SDK                 Run / Observability
  Sandbox / Tool / Skill / MCP
  Eval / Operations
             \                              /
              \---- Muses Host Layer ------/
                    Identity / Workspace
                    Canvas / Asset / Media
                    Model Catalog / Credits
                    Agent tools / agent.run bridge
```

Agent 与 Workflow 是可组合但不互相拥有的两个产品：

- Agent 通过宿主工具查询、编辑、校验、发布和调用工作流。
- Workflow 通过应用组合层的 `agent.run` 执行端口启动一个版本化 Agent Profile。
- Agent Runtime 不导入 Workflow Runtime；Workflow Runtime 不导入 Agent Harness。
- 双向引用只保存稳定身份、输入输出、Run 血缘和 correlation id。
- Muses Host 负责身份、权限、积分、画布和平台资产，不修改 Agent 内部状态机。

## 3. Agent 项目边界

### 3.1 必须拥有

- `AgentSession`、`AgentRun`、Turn、Message、Event、ToolCall、Approval、Checkpoint、ContextSnapshot、Usage 和 Budget 契约。
- `start`、`stream`、`steer`、`followUp`、`approve`、`cancel`、`resume`、`inspect` 和 `close` 控制协议。
- 通用模型循环、动态规划、工具调用、错误恢复、上下文压缩、并行委托和人工确认。
- 文件、Shell、Web/浏览器、Skill、MCP 和自定义 Tool 扩展面。
- 默认按 `AgentRun` 隔离的计算沙盒，以及 CPU、内存、时间、磁盘、网络和密钥策略。
- 可恢复事件流、Web 会话界面、附件、模型与推理强度选择、上下文和费用投影。
- SDK、Host Adapter、部署、迁移、遥测、固定 eval 和自托管说明。

### 3.2 禁止拥有

- Muses Workspace、积分账本、画布、Asset、媒体模型目录或专业工作流的权威状态。
- `image.generate`、PPT、短剧或其他场景的固化执行阶段。
- 对 Studio API、React Flow、数据库产品表或 Muses 管理员权限的隐式依赖。
- 通过 Skill、MCP 或 Prompt 自行扩大工具、网络、密钥或数据权限的能力。

## 4. Web-first 产品形态

独立 Agent 的 Web 应用是能力验收入口，而不是演示壳。至少包含：

- 会话和线程导航、消息流、推理摘要、工具活动、计划、审批、成果和 SubAgent 活动。
- 模型、推理强度、上下文窗口、Token、缓存 Token、费用和权限显示。
- Prompt、附件、停止、重试、继续、分支和刷新重连。
- 失败后的可操作恢复，不允许一次 Provider 异常永久卡住线程。
- 主题、国际化、响应式布局和无障碍语义。
- Host slots：品牌、身份、模型目录、附件解析、工具目录、成果渲染、审批和计费投影。

Muses 通过这些 Host slots 增加画布和创作能力。Studio 不维护另一套消息、工具或运行 UI。

### 4.1 Codex 产品形态校准

首批体验基准使用 `.tmp/codex桌面端截图.png` 和 `.tmp/codex桌面端小尺寸截图.png`，校准的是信息架构和任务心智，不复制品牌资产或像素外观：

- 宽屏默认呈现项目/会话侧栏与任务工作区；空会话以任务输入为中心，历史会话可直接恢复。
- 小尺寸进入单会话专注态，侧栏收起为导航入口，标题、任务时间线和底部输入保持稳定。
- 用户消息、模型回复、Reasoning、Shell/文件/Web/自定义工具、变更、审批、成果、失败和恢复属于同一按时间排序的任务记录。
- Prompt composer 固定在任务区底部，提供附件、模型、推理强度、上下文/用量状态和停止入口；选项必须来自 Agent/Profile 或 Host 配置，不写死供应商。
- 失败必须结束当前运行状态，并提供同线程继续、重试或切换模型的可操作入口，不能刷新后永久停留在“运行中”。

UI 以 Vercel AI Elements 为基础，但高层 `AgentWorkspace`、会话存储契约、事件投影、Host slots 和主题变量必须作为开放模块发布。独立 Web 应用和 Muses Studio 消费同一模块，禁止复制后再分别维护。

## 5. Harness 策略

Eve 是独立 Web Agent 默认发行版 Harness，Pi 是轻量嵌入式对照，Muses Headless Runtime 保留为稳定契约参考。任何 Harness 都只能通过 Agent Contracts、Store、Policy、Tool、Sandbox 和 Event 端口工作。

当前安装的 Eve `0.27.8` 处于 preview，要求 Node.js 24，并使用 Workflow SDK `5.0.0-beta` 协议；当前 Muses 主运行时是 Node.js 22 与 Workflow SDK 4.6.2。Eve 当前还没有证明满足 Muses 的 per-AgentRun 物理沙盒和并发消息顺序契约。因此：

1. `/root/projects/muses-agent` 在 Node 24 与独立 Workflow World 上直接跑通 Eve 默认发行版，不导入 Muses 业务模块。
2. 用同一 Conformance Suite 验证 Eve、Pi 与 Headless 公开语义，而不是直接升级 Muses 生产运行时。
3. Eve 通过流、审批、取消、Usage、消息顺序和物理沙盒 Gate 后，才允许 Muses Host 把生产 Agent 流量切到该发行版。
4. 即使更换 Harness，公开 SDK、事件、Profile、Tool、Usage 和 Host 协议也不改变。

## 6. Profile 与平台自举

`AgentProfile` 是独立 Agent 项目的版本化运行配置，包含模型策略、Instructions、Tools、Skills、MCP、预算、权限需求、沙盒需求和输出 Schema。Profile 不是 Workflow，Agent 也不是 Workflow 的特殊节点实现。

Muses 平台功能使用以下引用链：

```text
SolutionDefinition
  -> AgentProfile Deployment
  -> Workflow Deployment(s)
  -> Host UI / permissions / delivery type
```

平台 MusesAgent 和专业画布中的 Agent 节点都启动同一个 Agent Runtime。两者只在 Profile、Host tools、权限、预算、沙盒和调用身份上不同。官方 Solution 可以在管理员工作区编辑、评测、发布、灰度和回滚；用户 Fork 时必须移除私有密钥、管理员工具和无权访问的 MCP。

## 7. 强制依赖方向

```text
agent-contracts <- agent-runtime <- harness adapters
       ^                ^                 ^
       |                |                 |
 agent-client       agent-web         agent-service
       ^                                  ^
       \------------ host-sdk ------------/
                         ^
                         |
                  muses-agent-host
                         |
             canvas / media / workflow tools
```

通用 Agent 包不得导入 `@muses/domain`、Studio、Canvas、媒体或 Workflow 实现。Muses 可以依赖 Agent 的公开包，Agent 不得反向依赖 Muses。

## 8. 生产验收

独立 Agent 必须先在自己的 Web 应用通过以下 Gate，才能宣称 Muses 拥有 Codex 级 Agent：

1. 不加载 Muses 工具完成普通问答、文件编辑、Shell、Web 研究和自定义工具任务。
2. 多轮对话、steering、并行工具、SubAgent、审批、取消、刷新和进程恢复保持事件有序。
3. 模型失败可重试或换模型，同一线程不会停留在伪运行状态。
4. 每个 Run 和 SubAgent 使用明确的物理沙盒、网络与密钥策略，跨 Run 访问被拒绝。
5. Web、SDK 和嵌入式 Host 使用同一协议和 Conformance Suite。
6. Muses Host 只增加工具与成果渲染；移除 Host 后 Agent 仍可独立运行。
7. Workflow `agent.run` 与平台 MusesAgent 产生相同类型的 AgentRun、Event、Usage 和 Trace。
8. 安全、负载、故障注入、计费幂等、可观测性、灰度、回滚和自托管文档通过生产 Gate。

首图、PPT 或短剧成功不能替代以上验收。
