# 项目架构梳理

本文档归纳当前项目的整体结构、构建方式、启动链路、模型请求链路以及多 provider / Codex 适配相关改造点。

## 项目定位

本项目是基于 Claude Code 源码改造的 Bun 单包项目。它不是传统 npm workspaces 形式的 monorepo，但源码目录分层较大，整体更接近“单体大仓”结构。

主要目标包括：

- 基于 Claude Code 源码构建自定义 CLI。
- 使用 Bun 作为构建和测试运行环境。
- 保留 Claude Code 原有的交互式 CLI、工具调用、slash command、REPL 等能力。
- 增加多 provider / 自定义模型配置能力。
- 通过 fetch adapter 将 Anthropic Messages API 调用转接到 OpenAI / Codex 等后端。

## 常用命令

项目使用 Bun 管理依赖、构建和测试。

```bash
# 安装依赖
bun install

# 标准构建，输出 ./my-code
bun run build

# 开发构建，输出 ./my-code-dev
bun run build:dev

# 开发构建并启用实验功能
bun run build:dev:full

# 编译构建
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

## 构建系统

构建逻辑集中在 `scripts/build.ts`。

构建入口固定为：

```text
src/entrypoints/cli.tsx
```

构建脚本负责：

- 调用 Bun build。
- 根据参数选择输出文件。
- 处理 feature flags。
- 支持开发构建和完整实验功能构建。

常见输出包括：

- `./my-code`
- `./my-code-dev`
- `./dist/my-code` 或 `./dist/cli`

## CLI 启动链路

CLI 启动链路大致如下：

```text
package.json scripts
  -> scripts/build.ts
  -> src/entrypoints/cli.tsx
  -> src/main.ts
  -> REPL / commands / tools
```

关键文件：

- `src/entrypoints/cli.tsx`
  - CLI bootstrap。
  - 包含 fast-path 和动态 import 逻辑。
  - 普通路径最终加载 `src/main.ts`。

- `src/main.ts`
  - CLI 主入口。
  - 初始化运行环境并进入交互流程。

- `src/screens/REPL.tsx`
  - 交互式终端 UI 主循环。
  - 基于 Ink / React。

- `src/commands.ts`
  - slash command 注册入口。

- `src/tools.ts`
  - 工具注册入口。

## 核心目录概览

```text
src/entrypoints/  CLI 入口
src/screens/      终端 UI / REPL
src/components/   Ink / React UI 组件
src/commands/     slash command 实现
src/tools/        工具实现
src/services/     API、OAuth、MCP、analytics 等服务层
src/state/        应用状态管理
src/hooks/        React hooks
src/skills/       skill 系统
src/plugins/      plugin 系统
src/bridge/       IDE bridge
src/voice/        语音输入相关能力
src/tasks/        后台任务管理
src/utils/model/  provider / model 配置与选择逻辑
```

## 模型请求主链路

模型调用的主流程如下：

```text
src/query.ts
  -> deps.callModel
  -> src/query/deps.ts
  -> queryModelWithStreaming
  -> src/services/api/claude.ts
  -> getAnthropicClient
  -> src/services/api/client.ts
```

关键文件：

- `src/query.ts`
  - 主 query loop。
  - 负责组织 messages、system prompt、tools、token budget、compact 状态等。
  - 在主循环中通过 `deps.callModel(...)` 发起模型调用。

- `src/query/deps.ts`
  - production dependency 注入。
  - 将 `callModel` 绑定到 `queryModelWithStreaming`。

- `src/services/api/claude.ts`
  - Claude / Anthropic Messages API 调用核心。
  - 构造请求参数。
  - 处理 streaming、fallback、tool use、usage 等逻辑。

- `src/services/api/client.ts`
  - API client 创建入口。
  - 根据 provider 选择 Anthropic、Bedrock、Vertex、Foundry、OpenAI、Codex 等路径。

## Provider / Model 配置

provider 和模型配置主要集中在：

- `src/utils/model/providers.ts`
- `src/utils/model/configs.ts`
- `src/utils/model/modelConfigs.ts`
- `models.config.example.json`

当前 provider 类型包括：

```text
firstParty
bedrock
vertex
foundry
openai
custom1
custom2
custom3
```

provider 选择逻辑大致包括：

- 优先读取 `MY_CODE_PROVIDER` 指定的 custom provider。
- 然后判断 Bedrock / Vertex / Foundry / OpenAI 相关环境变量。
- 默认使用 first-party Anthropic provider。

模型配置文件优先级大致为：

```text
CLAUDE_CODE_MODEL_CONFIG
MY_CODE_CONFIG_DIR/models.config.json
~/.my-code/models.config.json
```

`models.config.example.json` 提供了多 provider 配置样例，包括：

- `apiUrl`
- `apiKey`
- `defaultModel`
- provider-specific model 配置

## OpenAI / Codex 适配

OpenAI / Codex 适配是当前项目中最重要的自定义改造之一。

相关文件：

- `src/services/api/client.ts`
- `src/services/api/codex-fetch-adapter.ts`
- `src/services/api/openai-fetch-adapter.ts`
- `src/services/api/codex-fetch-adapter.test.ts`

设计思路是保留 Claude Code 原有的 Anthropic SDK 调用方式，但在 client 层注入自定义 fetch：

```text
Anthropic SDK 请求 /v1/messages
  -> client.ts 注入自定义 fetch
  -> codex-fetch-adapter.ts 拦截请求
  -> 转译为 Codex Responses API
  -> 将 response / stream 转回 Claude Code 期望的格式
```

Codex 适配层承担的职责包括：

- 将 Anthropic Messages API 请求转换为 Codex Responses API 请求。
- 转换 system / user / assistant / tool messages。
- 映射 `tool_use` 和 `tool_result`。
- 处理 streaming event。
- 注入或转换 token usage。
- 处理错误响应。

该部分是高风险热路径，因为它位于 Claude Code 原 query pipeline 和外部模型后端之间。

## 测试情况

当前测试使用 Bun 内置测试框架。

探查时基础测试结果为：

```text
50 pass, 0 fail
56 expect() calls
4 files
```

常用测试命令：

```bash
bun test
```

相关文件：

- `TEST_PLAN.md`
- `src/services/api/codex-fetch-adapter.test.ts`

## 当前改造热点

从当前工作区状态和热路径看，主要改动集中在：

- `src/services/api/client.ts`
- `src/services/api/codex-fetch-adapter.ts`
- `src/services/api/openai-fetch-adapter.ts`
- `src/utils/model/providers.ts`
- `src/utils/model/configs.ts`
- `src/utils/model/fetchModels.ts`
- `src/utils/model/model.ts`
- `src/utils/model/modelOptions.ts`
- `src/utils/model/modelStrings.ts`
- `models.config.example.json`
- `README.md`

另外 `.omc/**` 下存在运行态文件变更，提交业务代码时应避免将 `.omc/state/**` 等会话状态文件混入业务提交。

## 推荐阅读顺序

如果继续开发或排查问题，建议按以下顺序阅读：

1. `README.md`、`CLAUDE.md`
   - 理解项目命令、构建方式和目录约定。

2. `src/entrypoints/cli.tsx`、`src/main.ts`
   - 理解 CLI 如何启动。

3. `src/query.ts`、`src/query/deps.ts`
   - 理解主请求循环和模型调用入口。

4. `src/services/api/claude.ts`、`src/services/api/client.ts`
   - 理解 Anthropic SDK 调用、client 创建和 provider 分流。

5. `src/utils/model/providers.ts`、`src/utils/model/configs.ts`
   - 理解 provider / model 的选择和配置加载。

6. `src/services/api/codex-fetch-adapter.ts`
   - 深入理解 Codex/OpenAI 协议适配层。

## 后续开发建议

- 如果调整 provider 或模型选择策略，应重点验证 `src/utils/model/*` 与 `src/services/api/client.ts` 的联动。
- 如果调整 Codex/OpenAI 适配，应优先补充或更新 adapter 测试，尤其是 streaming、tool use、usage 和错误响应。
- 如果调整 query pipeline，应谨慎评估 compact、token budget、tool orchestration、fallback 等逻辑的影响范围。
- 提交前建议运行：

```bash
bun test
bun run build
```

## 总结

本项目的核心改造点不是终端 UI，而是：

```text
Claude Code 原 query pipeline
  + 多 provider / model 配置系统
  + OpenAI / Codex fetch adapter 协议转换层
```

因此后续维护时，最需要关注的是模型调用链路的兼容性、streaming 行为、tool use 映射以及不同 provider 下的配置选择是否一致。
