# 项目架构梳理

本文档基于当前源码实现梳理 `my-code` 的定位、构建方式、启动链路、运行时架构、模型请求链路，以及本项目相对 Claude Code 源码的主要自定义适配点。若文档与代码不一致，以代码为准。

## 1. 项目定位

`my-code` 是一个基于 Claude Code 源码重构/适配的 Bun 单包 CLI 项目。它保留 Claude Code 的交互式终端、slash command、工具调用、MCP、skills、plugins、agent/subagent 等能力，同时围绕“本地可控、自定义 provider、自定义模型、单文件编译运行”做了适配。

当前项目的核心目标：

- 使用 Bun 作为依赖、测试、构建与单文件编译运行时。
- 输出可直接执行的 `./my-code` / `./my-code-dev`，减少对 Node 环境的运行期依赖。
- 使用 `~/.my-code/models.config.json` 管理 provider、protocol、base URL、API key、默认模型和模型 metadata。
- 使用 `MY_CODE_*` 环境变量隔离本项目配置，避免污染原 Claude Code 配置。
- 支持 Anthropic Messages-compatible API 与 OpenAI-compatible Chat Completions API。
- 保留原 Anthropic SDK 调用路径，在 client 层通过 fetch adapter 做协议转换。
- 将 `/model`、context window、auto compact、agent/team 模型路由等行为改为以当前 provider 配置为准。

## 2. 常用命令

项目命令定义在 `package.json`：

```bash
# 安装依赖
bun install

# 标准构建，输出 ./my-code
bun run build

# 开发构建，输出 ./my-code-dev
bun run build:dev

# 开发构建并启用实验功能
bun run build:dev:full

# 编译构建，输出 dist 下的单文件可执行产物
bun run compile

# 从源码运行
bun run dev

# 运行测试
bun test
```

相关文件：

- `package.json`
- `scripts/build.ts`
- `CLAUDE.md`
- `TEST_PLAN.md`

## 3. 构建系统

构建逻辑集中在 `scripts/build.ts`。

构建入口固定为：

```text
src/entrypoints/cli.tsx
```

构建脚本的主要职责：

- 读取 `package.json` 中的版本信息。
- 根据参数选择输出文件：
  - `bun run build` → `./my-code`
  - `bun run build:dev` → `./my-code-dev`
  - `bun run compile` → `./dist/my-code`
- 使用 `bun build --compile --target bun --format esm --minify --bytecode --packages bundle` 生成单文件可执行产物。
- 注入 `MACRO.VERSION`、`MACRO.BUILD_TIME`、`MACRO.PACKAGE_URL`、`MACRO.FEEDBACK_CHANNEL` 等构建期常量。
- 通过 `--feature` / `--feature-set=dev-full` 控制 `bun:bundle` feature flag，配合源码中的 `feature('...')` 做死代码消除。
- 设置 external native 包，例如 `@ant/*`、`audio-capture-napi`、`image-processor-napi` 等。

默认 feature 当前包含：

```text
VOICE_MODE
```

`build:dev:full` 会额外启用一组实验功能，例如 `BRIDGE_MODE`、`ULTRAPLAN`、`TEAMMEM`、`VOICE_MODE`、`TOKEN_BUDGET`、`AGENT_TRIGGERS` 等。

## 4. CLI 启动链路

源码入口链路：

```text
package.json scripts
  -> scripts/build.ts / bun run dev
  -> src/entrypoints/cli.tsx
  -> src/main.tsx
  -> commander CLI / headless -p / interactive REPL
  -> query loop / commands / tools
```

关键文件：

- `src/entrypoints/cli.tsx`
  - CLI bootstrap。
  - 在加载完整 CLI 前处理 fast path：`--version`、system prompt dump、Chrome MCP、daemon、bridge、background session、template、worktree+tmux 等。
  - 普通路径启动 early input capture，然后动态加载 `src/main.tsx`。

- `src/main.tsx`
  - 完整 CLI 主入口。
  - 初始化配置、settings、telemetry/gates、MCP、plugins、skills、权限上下文、初始模型、session 状态等。
  - 使用 Commander 注册命令行参数和子命令。
  - 根据参数进入 headless `-p/--print`、server/open/remote/assistant 等路径，或启动交互式 REPL。

- `src/replLauncher.tsx`、`src/screens/REPL.tsx`
  - 交互式 Ink/React UI 主循环。
  - 连接 app state、prompt input、message rendering、commands、tools、MCP、background tasks 等运行态。

注意：旧文档中提到的 `src/main.ts` 当前实际文件为 `src/main.tsx`。

## 5. 核心目录概览

```text
src/entrypoints/        CLI bootstrap 与 init
src/main.tsx            完整 CLI 主入口和 Commander 注册
src/screens/            交互式 REPL / Ink UI
src/components/         终端 UI 组件
src/commands.ts         slash command 聚合注册
src/commands/           slash command 实现
src/tools.ts            tool 聚合注册、过滤、MCP 合并
src/tools/              内置工具实现，例如 Bash/Read/Edit/Agent/Skill/Task 等
src/query.ts            主 query loop
src/query/              query 依赖注入、配置、token budget、状态迁移
src/services/api/       Anthropic client、streaming、OpenAI adapter、API 支持模块
src/services/compact/   manual/auto/micro compact 与 context 管理
src/services/mcp/       MCP client、server config、resources、commands、tools
src/services/analytics/ analytics/growthbook gates/stubs
src/state/              AppState 类型、store、状态变更处理
src/hooks/              React hooks
src/skills/             skill 系统
src/plugins/            plugin 系统
src/bridge/             remote control / IDE bridge 相关能力
src/tasks/              background task 状态与管理
src/utils/model/        provider/model/config/resolver/capability 逻辑
scripts/build.ts        Bun 单文件构建脚本
docs/                   项目文档
```

## 6. 运行时状态与 UI 结构

状态核心在：

- `src/state/store.ts`
- `src/state/AppStateStore.ts`
- `src/state/AppState.js` / `src/state/onChangeAppState.js`

`createStore()` 是一个轻量 store：保存 `state`、提供 `getState()` / `setState()` / `subscribe()`，并在状态变更时调用 `onChange`。

`AppState` 保存交互式会话的大部分运行态，例如：

- 当前 `mainLoopModel` / session model。
- `toolPermissionContext`。
- MCP clients/tools/commands/resources。
- plugins、agent definitions、tasks、todos、file history。
- REPL bridge、remote session、footer selection、UI 展开状态等。

交互式 UI 通过 Ink/React 组件订阅这些状态；headless 模式也会构造 store，但输出路径不同。

## 7. Slash command 架构

命令聚合入口：`src/commands.ts`。

主要机制：

- 静态导入常用命令，例如 `clear`、`compact`、`config`、`context`、`model`、`mcp`、`memory`、`status`、`skills`、`hooks` 等。
- 使用 `feature('...')` 或 `process.env.USER_TYPE === 'ant'` 条件加载实验/内部命令，构建时可被 DCE。
- `COMMANDS` 使用 `memoize` 延迟构建，避免模块初始化阶段读取配置。
- `getCommands(cwd)` 会合并：
  - bundled skills
  - builtin plugin skills
  - skill dir commands
  - workflow commands
  - plugin commands
  - plugin skills
  - 内置 commands
- `meetsAvailabilityRequirement()` 当前直接返回 `true`，表示本项目移除了原登录/订阅路径对命令可见性的限制。

命令类型由 `src/types/command.js` 定义，常见形态包括 local JSX command、prompt command、local command 等。

## 8. Tool 架构

工具聚合入口：`src/tools.ts`。

核心函数：

- `getAllBaseTools()`：返回当前环境中可能存在的所有内置工具。
- `getTools(permissionContext)`：根据 simple mode、REPL mode、feature flags、权限 deny rules 和 `tool.isEnabled()` 过滤工具。
- `assembleToolPool(permissionContext, mcpTools)`：合并内置工具与 MCP tools，并按名称排序去重，保持 prompt cache 稳定。
- `getMergedTools(permissionContext, mcpTools)`：简单合并内置工具与 MCP tools。

常见内置工具包括：

- `AgentTool`
- `BashTool`
- `FileReadTool`
- `FileEditTool`
- `FileWriteTool`
- `GlobTool` / `GrepTool`
- `NotebookEditTool`
- `WebFetchTool` / `WebSearchTool`
- `TodoWriteTool`
- `SkillTool`
- `AskUserQuestionTool`
- `EnterPlanModeTool` / `ExitPlanModeV2Tool`
- `TaskCreateTool` / `TaskGetTool` / `TaskUpdateTool` / `TaskListTool`（由 todo v2 gate 控制）
- `ListMcpResourcesTool` / `ReadMcpResourceTool`

MCP tools 会在运行时进入 `AppState.mcp.tools`，再通过 tool pool 参与模型请求。

## 9. 模型请求主链路

模型调用主流程：

```text
REPL/headless input
  -> src/query.ts query()
  -> queryLoop()
  -> productionDeps()
  -> queryModelWithStreaming()
  -> src/services/api/claude.ts
  -> getAnthropicClient()
  -> src/services/api/client.ts
  -> Anthropic SDK 或 fetch adapter
```

关键文件：

- `src/query.ts`
  - 主 query loop。
  - 负责组织 messages、system prompt、user/system context、tool definitions、permission context、token budget、compact、fallback、stop hooks、tool execution 等。
  - 每轮通过 `deps.callModel(...)` 发起 streaming 模型调用。
  - 当模型返回 `tool_use` 后，进入 tool orchestration，再把 `tool_result` 追加回上下文，继续 loop。

- `src/query/deps.ts`
  - production 依赖注入点。
  - 当前注入：`queryModelWithStreaming`、`microcompactMessages`、`autoCompactIfNeeded`、`randomUUID`。
  - 测试可以通过 `QueryParams.deps` 注入 fake。

- `src/services/api/claude.ts`
  - Anthropic Messages 请求构造与 streaming 处理核心。
  - 负责 max output tokens、thinking、tools、betas、fallback、usage、stream event 等 API 层细节。

- `src/services/api/client.ts`
  - Anthropic client 创建入口。
  - 根据 Bedrock/Foundry/Vertex 环境变量走对应 SDK。
  - 否则读取本项目 provider 配置，选择 Anthropic base URL 或 OpenAI fetch adapter。

## 10. Provider / Model 配置系统

配置核心文件：

- `src/utils/model/configs.ts`
- `src/utils/model/model.ts`
- `src/utils/model/modelOptions.ts`
- `src/utils/model/modelStrings.ts`
- `models.config.example.json`

默认配置路径：

```text
~/.my-code/models.config.json
```

配置路径优先级：

```text
MY_CODE_MODEL_CONFIG
MY_CODE_CONFIG_DIR/models.config.json
~/.my-code/models.config.json
```

当前 provider 解析优先级：

```text
MY_CODE_PROVIDER
models.config.json currentProvider
models.config.json default
```

provider schema 关键字段：

```ts
{
  protocol: 'anthropic' | 'openai'
  baseUrl?: string
  apiUrl?: string
  apiKey?: string
  apiKeyEnv?: string
  defaultModel?: string
  models?: Array<string | {
    id?: string
    name?: string
    description?: string
    contextWindow?: number
    maxOutputTokens?: number
  }>
  proxy?: {
    enable?: boolean
    http?: string
    socks5?: string
  }
}
```

重要行为：

- `resolveCurrentProvider()` 要求 provider 必须存在，否则明确报错。
- `resolveProviderProtocol()` 只允许 `anthropic` 或 `openai`。
- `resolveProviderModels()` 只返回当前 provider 下的模型；如果 `defaultModel` 未出现在 `models` 中，会自动补到列表开头。
- `resolveModelMetadata(model)` 要求模型必须有有效 `contextWindow`，用于 `/context` 和 auto compact。
- `getConfigApiKey()` 优先读取 `apiKey`，否则读取 provider 声明的 `apiKeyEnv`。
- `getConfigApiUrl()` 读取 `baseUrl` 或兼容旧字段 `apiUrl`。
- `getConfigDefaultModel()` 是默认主模型的重要来源。

## 11. `/model` 与 provider-scoped model picker

`/model` 入口：

- `src/commands/model/index.ts`
- `src/commands/model/model.tsx`
- `src/components/ModelPicker.tsx`
- `src/utils/model/modelOptions.ts`

当前 `ModelPicker` 使用 `getProviderScopedModelOptions()`，而不是原 Claude Code 的订阅/内置模型列表。

`getProviderScopedModelOptions()` 行为：

```text
resolveProviderModels()
  -> 当前 provider models
  -> ModelOption[] { value, label, description }
```

这意味着：

- `/model` 只展示当前 provider 配置的模型。
- 切换 provider 后，模型列表随 provider 变化。
- 未配置在当前 provider 下的模型不会被静默选中。

## 12. Context window 与 auto compact

相关文件：

- `src/utils/context.ts`
- `src/services/compact/autoCompact.ts`
- `src/commands/context/index.js/tsx`

关键行为：

- `getContextWindowForModel(model)` 会调用 `resolveModelMetadata(model)`，优先使用 `models.config.json` 中当前 provider 的 `contextWindow`。
- `[1m]` suffix、capability、beta header 和 ant-only override 会在配置 metadata 基础上进一步影响返回值。
- `getEffectiveContextWindowSize(model)` 使用 `resolveModelMetadata(model).contextWindow` 减去 compact summary 预留 token。
- auto compact threshold 基于 effective context window 计算。
- 缺少 `contextWindow` 会明确报错，避免自动 fallback 到错误的 Claude 内置窗口。

因此：新增模型时必须在配置中写入准确的 `contextWindow`，否则 `/context` 与 auto compact 都无法可靠运行。

## 13. OpenAI-compatible fetch adapter

当前 OpenAI 适配核心文件：

- `src/services/api/client.ts`
- `src/services/api/openai-fetch-adapter.ts`

client 选择逻辑：

```text
getAnthropicClient()
  -> getConfigApiKey()
  -> getConfigApiUrl()
  -> getConfigProtocol()
  -> protocol === 'openai'
       ? createOpenAIFetch(apiKey, baseUrl)
       : Anthropic SDK baseURL/fetch
```

OpenAI adapter 的职责：

- 拦截 Anthropic SDK 发往 `/v1/messages` 的请求。
- 将 Anthropic Messages body 转为 OpenAI Chat Completions body。
- 转换 system prompt、user/assistant messages、image、tool definitions。
- 将 Anthropic `tool_use` / `tool_result` 映射为 OpenAI tool calls / tool messages。
- 请求 OpenAI-compatible `/v1/chat/completions`。
- 将 OpenAI SSE stream 转换回 Anthropic SSE event 格式：
  - `message_start`
  - `content_block_start`
  - `content_block_delta`
  - `content_block_stop`
  - `message_delta`
  - `message_stop`
- 将 OpenAI 错误转换为 Anthropic SDK 可消费的 JSON error response。

该层是本项目最关键的兼容热路径之一，因为上层 query loop 仍按 Anthropic Messages/streaming/tool_use 语义工作。

## 14. Agent / Team 模型路由

相关逻辑在 `src/utils/model/configs.ts`：

- `resolveAgentModel()`
- `resolveTeamModel()`
- `resolveConfiguredRoute()`
- `validateProviderModel()`

路由顺序：

```text
Agent:
1. toolSpecifiedModel
2. agents.models[agentName]
3. agents.defaultModel
4. currentModel
5. agent frontmatter model / alias
6. 无法解析则报错

Team:
1. toolSpecifiedModel
2. teams.models[role]
3. agents.models[role]
4. teams.defaultModel
5. agents.defaultModel
6. currentModel
7. agent frontmatter model / alias
8. 无法解析则报错
```

所有解析结果都会通过 `validateProviderModel()` 校验，确保模型属于当前 provider。这样可以避免 subagent/team 静默 fallback 到 `sonnet`、`opus`、`haiku` 等 Claude 默认别名。

## 15. 配置示例

最小 OpenAI-compatible 配置：

```json
{
  "currentProvider": "openai",
  "providers": {
    "openai": {
      "protocol": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "MY_CODE_OPENAI_API_KEY",
      "defaultModel": "gpt-5.4",
      "models": [
        {
          "id": "gpt-5.4",
          "name": "GPT-5.4",
          "description": "Default coding model",
          "contextWindow": 128000,
          "maxOutputTokens": 16000
        }
      ]
    }
  }
}
```

最小 Anthropic-compatible 配置：

```json
{
  "currentProvider": "anthropic",
  "providers": {
    "anthropic": {
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "MY_CODE_ANTHROPIC_API_KEY",
      "defaultModel": "claude-sonnet-4-6",
      "models": [
        {
          "id": "claude-sonnet-4-6",
          "name": "Claude Sonnet 4.6",
          "description": "Default Anthropic model",
          "contextWindow": 200000,
          "maxOutputTokens": 16000
        }
      ]
    }
  }
}
```

## 16. 测试与验证建议

常用验证：

```bash
bun test
bun run build
./my-code --version
./my-code -p "summarize this repository"
```

重点测试方向：

- provider/model config 解析。
- `MY_CODE_MODEL_CONFIG` / `MY_CODE_CONFIG_DIR` / `MY_CODE_PROVIDER` 覆盖。
- `/model` 只展示当前 provider 模型。
- `contextWindow` 缺失时报错。
- OpenAI adapter 的 streaming、tool call、tool result、usage、错误响应。
- Agent/Team 模型路由不会跨 provider fallback。
- 构建产物 `./my-code` / `./my-code-dev` 能直接运行。

## 17. 推荐阅读顺序

后续开发建议按以下顺序阅读：

1. `README.md`、`CLAUDE.md`、`docs/project-architecture-overview.md`
   - 理解项目目标、命令、构建方式和目录约定。

2. `scripts/build.ts`、`src/entrypoints/cli.tsx`、`src/main.tsx`
   - 理解构建产物如何生成，以及 CLI 如何启动。

3. `src/commands.ts`、`src/tools.ts`
   - 理解 slash command 与 tool 如何注册、过滤和进入模型上下文。

4. `src/query.ts`、`src/query/deps.ts`
   - 理解主请求循环、工具调用回路、compact 与 fallback。

5. `src/services/api/claude.ts`、`src/services/api/client.ts`
   - 理解 Anthropic SDK 调用与 provider 分流。

6. `src/utils/model/configs.ts`、`src/utils/model/model.ts`、`src/utils/model/modelOptions.ts`
   - 理解 provider/model 配置、默认模型、`/model` 列表和 agent/team 路由。

7. `src/services/api/openai-fetch-adapter.ts`
   - 深入理解 OpenAI-compatible 协议转换层。

8. `src/utils/context.ts`、`src/services/compact/autoCompact.ts`
   - 理解 context window、compact 阈值和大上下文行为。

## 18. 后续开发注意事项

- 修改 provider/model 解析时，应同时检查：
  - `src/utils/model/configs.ts`
  - `src/utils/model/model.ts`
  - `src/utils/model/modelOptions.ts`
  - `src/services/api/client.ts`
  - `src/utils/context.ts`
  - `src/services/compact/autoCompact.ts`

- 修改 OpenAI-compatible 适配时，应重点验证：
  - streaming event 顺序。
  - text delta。
  - tool call id/name/arguments 增量。
  - tool result 回传格式。
  - error response 是否能被 Anthropic SDK/query loop 正确消费。

- 新增模型时，应至少配置：
  - `id`
  - `name`
  - `description`
  - `contextWindow`
  - `maxOutputTokens`

- 构建产物和运行态文件通常不应提交：
  - `node_modules/`
  - `dist/`
  - `my-code`
  - `my-code-dev`
  - `.omc/state/**`
  - `.claude/**`

## 19. 总结

本项目的核心不是重新实现终端 UI，而是在保留 Claude Code 原运行时的基础上，增加一层本地可控的 provider/model 配置与协议适配：

```text
Claude Code 原 CLI / REPL / query pipeline
  + Bun 单文件构建
  + ~/.my-code provider/model 配置
  + provider-scoped /model 与 context metadata
  + OpenAI-compatible fetch adapter
  + agent/team 模型路由校验
```

后续维护最需要关注的是模型调用链路的兼容性、streaming/tool_use 语义、context window/auto compact 一致性，以及所有模型选择逻辑是否严格限定在当前 provider 配置内。
