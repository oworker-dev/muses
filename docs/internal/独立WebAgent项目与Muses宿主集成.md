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

- `/root/projects/open-agent`：通用 Web Agent 产品，包含 Eve Harness、Agent 服务、Web 工作台、Client/Host SDK、开放 UI、Sandbox、Tool、Skill、MCP 和 Eval。
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

当前双向组合已经落地：Muses `agent-run` 节点通过短时 Host JWT 调用独立 Headless AgentRun API，使用 Workflow Run + node id 作为幂等边界；独立 Agent 则通过版本化 Host Capability 协议发现并调用 Canvas 与 Workflow 能力。2026-08-03 的 `alpha.7` 生产拓扑 E2E 在隔离 PostgreSQL World 上验证了 Workflow→Agent 的完成、幂等、Usage 投影和双向取消，以及 Agent→Host 的画布检查、工作流调用/等待、结果放置和最终复查。该实现证明公开协议组合，但真实供应商长任务、目标部署沙盒和非零计费对账仍需生产证据。
- Agent Runtime 不导入 Workflow Runtime；Workflow Runtime 不导入 Agent Harness。
- 双向引用只保存稳定身份、输入输出、Run 血缘和 correlation id。
- Muses Host 负责身份、权限、积分、画布和平台资产，不修改 Agent 内部状态机。
- Muses Host 通过私有 Responses-compatible Broker 为 Agent 解析 LLM
  Provider Connection；Agent 只持有独立 Broker 服务密钥，不持有管理员配置
  的上游模型密钥。独立部署仍可绕过该 Host 能力使用自己的 Provider。

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

UI 以 assistant-ui 为默认组件基线，但高层 `AgentWorkspace`、会话存储契约、事件投影、Host slots 和主题变量必须作为开放模块发布。独立 Web 应用和 Muses Studio 消费同一模块，禁止复制后再分别维护。

## 5. Harness 策略

Eve 是独立 Web Agent 默认发行版 Harness；公开 Headless AgentRun API 是 Muses 使用的稳定集成边界。旧 Muses Headless Runtime 已删除，不再作为参考实现。任何 Harness 都只能通过 Agent Contracts、Store、Policy、Tool、Sandbox 和 Event 端口工作。

当前 Open Agent 使用 Eve `0.31.1`、Node.js 24 和独立的 Workflow SDK 5 PostgreSQL World；Muses 仍使用自己的 Workflow SDK `4.6.2` World，二者不共享队列、数据库 schema 或运行时状态。Open Agent 已通过流恢复、审批、取消、Usage、严格消息顺序和 Docker 沙盒隔离门禁，但目标部署的多租户沙盒后端、资源配额和回收 SLO 仍需单独验收。因此：

1. `/root/projects/open-agent` 在 Node.js 24 与独立 Workflow World 上构建和运行，不导入 Muses 业务模块。
2. Muses 只消费同一不可变提交的 Contracts、Client 和 Host SDK；升级必须重新跑包分发、类型、构建和双向宿主门禁。
3. Conformance Suite 验证独立 Web、Headless AgentRun、嵌入式 Host 与工作流 Agent 节点的公开语义；不得通过升级 Muses 自身 Workflow Runtime 来耦合两套状态机。
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

当前 Profile 目录包含 `general-purpose@0.1.0` 与 `muses-platform@0.1.0`。画布 Agent 节点通过 `workflow.agent-run.config.set` 选择已发布 Profile，并冻结 Schema、权限、预算和输出模式；Domain reducer、Compiler 与服务端目录共同拒绝任意 Profile。`muses-platform` 使用以下 Host 能力：

- `canvas.inspect`、`canvas.item.put`；
- `workflow.list`、`workflow.inspect`、`workflow.invoke`、`workflow.run.inspect`、`workflow.run.wait`；其中 `wait` 在 Muses 服务端执行有界等待，避免 Agent 用模型回合轮询长任务；
- `workflow.draft.create`、`workflow.draft.command`、`workflow.validate`、`workflow.publish`；
- `image.generate` 只是可选媒体能力，不是默认 Agent 阶段。

Host 调用对时间戳、method、path 和 body 做 HMAC 签名，同时携带 Workspace、原始用户主体、Project 与 Canvas scope。Muses 校验签名重放窗口、活动成员、角色与项目权威状态后才进入 Operation Gateway；Viewer 只能读取。Agent 不配置 Host URL/secret 时，这两个动态工具完全不出现，仍可独立完成通用任务。

截至 2026-08-02，独立 Agent 已拥有自己的产品数据 schema、独立 Eve Workflow World、Host JWT、线程所有权、Headless AgentRun API、可恢复事件流和 iframe 嵌入协议。当前默认产品 schema 与 Workflow 队列前缀均使用 `open_agent` 命名；Eve 上下文压缩以 82% 阈值启用，一个 AgentRun 独占一个 durable session，其 `/workspace` 跨 turn 保留。Muses 不再保存或压缩 Agent 上下文，也不再执行本地模型循环。

截至 2026-08-06 的历史 SDK 快照使用 `open-agent` 仓库 `oworker-dev/open-agent` 的 `v0.1.0-alpha.9` 和不可变提交 `442420dae167d8ee72b55133d2ba961433fb0633`；对应证据保留在 `delivery/evidence/open-agent-sdk-108/`，不代表当前生产锁定版本。当前 Muses 生产依赖已统一锁定到 Open Agent 提交 `657d1f7683ce3eaab6742bb7ba4c8742302431d7`，三个 package path 共用该不可变版本，并已重跑 SDK 分发、类型、构建和可用门禁；冷安装不得重新构建 SDK，也不得把 GitHub Release 的短期签名 URL 写入锁文件。集成只依赖公开 SDK、Host JWT 和 Host Capability；iframe 仍只是便捷 UI 投影，不是能力边界。旧 Muses Agent Runtime 的源码、API、Workflow driver 和本地上下文实现均已从生产代码删除。

同日完成的专业画布浏览器验收不使用固定 Harness 图：独立测试用户通过 UI 把默认工作流改造成 `Start → agent.run → End(result:text)`，变量选择器按真实自定义端口标签回退，发布目录冻结输出键、显示名、类型与必填性，随后 Muses Workflow SDK 通过 `@oworker/open-agent-client` 启动独立 Agent 并返回命名文本输出。该证据与 Agent→Host 的画布/工作流工具闭环共同证明两个方向都只经过开放 SDK 和版本化宿主能力。

同日完成首图宿主验收：自然语言 AgentRun 先发现 `canvas.inspect` 与 `image.generate`，再调用真实图像 Provider，生成并持久化一个 PNG Asset，通过 Operation Gateway 放入 CreativeCanvas，随后重新读取画布。验收同时检查了 1,629,358 字节对象、Asset/Workflow/credit reservation/settle 收据、`1,000,000` credit micros 结算、Agent 输入/输出/cache token 以及新快照中的 Asset。Agent Host 同步调用默认等待上限固定为 120 秒；超过该边界的长媒体仍必须使用 durable accepted + wait，不把长超时伪装成最终方案。该工程证据已通过，但“用户无需讲解即可完成首图”的产品负责人验收仍保持未完成。

Muses 旧 `muses_agent_*` 表、migration 和交付证据只作为历史升级与审计事实保留。当前 Drizzle Runtime 不导出这些表，生产源码不读写它们；旧 `/api/studio/agent-runs`、model loop、state store、trace、delegation scheduler/driver、`@muses/agent-core` 和 harness adapter 已退役。Muses 当前只保留 Host Capability、Profile 目录、权限/积分、Workflow `agent-run` 适配和 UI 嵌入边界。

## 7. 强制依赖方向

```text
agent-contracts <- agent-service <- Eve harness
       ^                ^                 ^
       |                |                 |
 agent-client       agent-web       headless AgentRun API
       ^                                  ^
       \------------ host-sdk ------------/
                         ^
                         |
                  Muses Agent Host
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

Muses Workflow SDK 4.x 的默认本地和 Docker 拓扑使用独立 PostgreSQL 数据库 `muses_workflow_world`（宿主端口 `5433`），业务 `DATABASE_URL` 仍指向 `oworker_saas`（`5432`）。Eve 继续使用自己的 World。Graphile `muses_` 前缀只是第二道隔离边界，不能替代物理数据库隔离。
