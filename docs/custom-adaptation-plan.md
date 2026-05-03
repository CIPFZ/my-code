# my-code 自定义适配方案

## 目标理解

本次适配不是简单替换品牌名，而是把当前基于 free-code/Claude Code 的源码改造成一个通用 AI CLI：

1. 所有用户可见、包名、二进制名、文档中的 `free-code` 改为 `my-code`。
2. 移除登录、登出和原有 OAuth 依赖，避免用户进入 Claude/OpenAI Codex 登录流；官方 Anthropic/Claude 账号体系不作为默认能力保留。
3. 支持两类通用协议：Anthropic Messages 协议与 OpenAI 兼容协议。OpenAI 兼容以 `https://host/v1` 这类 base URL 为输入，优先适配常见 `/chat/completions` 兼容接口，后续可按厂商差异扩展 Responses。
4. provider 必须抽象为厂商无关，只要厂商实现 Anthropic 或 OpenAI 兼容 API，就能通过配置接入。
5. 所有运行时配置、状态、缓存、session、认证信息默认迁移到 `~/.my-code`，并且支持运行时环境变量和编译时默认值自定义。
6. `~/.my-code/models.config.json` 作为模型/provider 主配置，支持多个 providers、全局代理、provider 级代理、默认 provider/model、alias、agent/team 模型。
7. `/model` 不再展示固定 Claude 模型，而是根据当前 provider 的 models 动态展示和选择。
8. auto-compact/context window 不能再固定 Claude 200K/1M，必须基于当前 provider/model 的 `contextWindow`、`maxOutputTokens` 动态计算。
9. Agent、team、subagent 默认模型不再解析到 Claude opus/sonnet/haiku，而应按当前配置 alias 或 agents/teams 配置解析。
10. 首次启动自动创建 `~/.my-code`、默认配置文件、必要子目录。
11. 自定义项尽量支持打包阶段注入，便于其他用户 fork 后编译出自己的品牌、配置目录、默认 provider 配置。

## 当前代码关键发现

### 品牌与产物

- `package.json` 当前包名是 `claude-code-source-snapshot`，bin 是 `claude` / `claude-source`，需要改为 `my-code`。
- `README.md`、`CLAUDE.md`、`install.sh`、`scripts/build.ts`、入口提示中仍有 `free-code`、`Claude Code`、`./cli` 等用户可见命名。
- `scripts/build.ts` 当前输出 `cli` / `cli-dev` / `dist/cli`，可改为默认输出 `my-code` / `my-code-dev`，并允许编译时覆盖。

### 配置目录

- `src/utils/envUtils.ts` 的 `getClaudeConfigHomeDir()` 是核心路径入口，目前默认 `process.env.CLAUDE_CONFIG_DIR ?? ~/.claude`。
- `src/utils/env.ts` 使用 `CLAUDE_CONFIG_DIR || homedir()` 拼配置路径，需统一改到新的 config home helper。
- `src/utils/cachePaths.ts` 使用 `envPaths('claude-cli')`，缓存目录也会带 Claude 命名，需要切换成可配置 app name。
- `src/utils/markdownConfigLoader.ts`、`src/hooks/fileSuggestions.ts`、`src/utils/sessionStorage.ts`、`src/utils/concurrentSessions.ts` 等依赖配置目录 helper 或 `CLAUDE_CONFIG_DIR`。

建议不要全局机械删除 `getClaudeConfigHomeDir` 函数名，第一阶段可保留内部函数名但改语义，后续再重命名，降低风险。

### 登录/登出与认证

- `src/commands/login/`、`src/commands/logout/` 是 slash command 实现。
- `src/commands.ts` 聚合注册 login/logout，需要移除或替换为提示用户编辑 `models.config.json`。
- `src/utils/auth.ts` 含 Anthropic OAuth、Claude AI OAuth、Codex OAuth、API key helper 等逻辑。
- `src/services/api/client.ts` 目前仍通过 `getClaudeAIOAuthTokens()`、`getCodexOAuthTokens()`、`isCodexSubscriber()` 等进入旧认证链。

目标是通用 provider，所以认证应从 provider 配置读取：`apiKey`、可选 headers、baseURL/apiUrl、protocol、proxy。不再需要交互式 OAuth。

### provider/model 链路

- `src/utils/model/providers.ts` 当前通过环境变量选择 provider，例如 `CLAUDE_CODE_USE_OPENAI`、Bedrock、Vertex、Foundry。
- `src/utils/model/configs.ts` 当前是硬编码 Anthropic/Bedrock/Vertex/Foundry/Codex 模型常量。
- `src/utils/model/model.ts` 负责默认 opus/sonnet/haiku、主模型、小模型、alias、显示名。
- `src/utils/model/modelOptions.ts` 和 `src/components/ModelPicker` 驱动 `/model` 可选项。
- `~/.my-code/models.config.json` 已存在，结构已经包含 `currentProvider`、`currentModel`、`proxy`、`aliases`、`providers`、`agents`、`teams`，可以作为目标 schema 基础。

### OpenAI/Anthropic 协议适配

- 当前 `src/services/api/client.ts` 统一创建 Anthropic SDK client。
- `src/services/api/codex-fetch-adapter.ts` 是 Codex 专用 adapter，把 Anthropic Messages API 转成 Codex backend responses；不能直接作为通用 OpenAI adapter，但可复用其 message/tool/stream 翻译思路。
- 需要新增通用 `openai-fetch-adapter.ts`：把 Anthropic SDK 发出的 `/v1/messages` 请求转换为 OpenAI compatible Chat Completions 或 Responses 请求，并把响应/流转换回 Anthropic Messages 事件。
- Anthropic 协议 provider 可继续使用 Anthropic SDK，但 baseURL、apiKey、headers 从配置读取；不内置官方 Anthropic provider 模板。

### auto-compact/context window

- `src/utils/context.ts` 当前默认 `MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`，并有 Claude 1M 特例。
- `src/services/compact/autoCompact.ts` 已通过 `getContextWindowForModel(model)` 和 `getMaxOutputTokensForModel(model)` 计算阈值，这是适配入口。
- `src/utils/model/modelCapabilities.ts` 当前从 Anthropic models API 获取能力并缓存，通用 provider 下应优先使用 `models.config.json` 中模型的 `contextWindow`、`maxOutputTokens`，再 fallback 默认值。

### agent/team/subagent 模型

- `src/utils/model/agent.ts` 的 `getAgentModel()` 当前仍围绕 `opus/sonnet/haiku/inherit` 和 provider-specific Claude 模型解析。
- `src/tools/AgentTool/AgentTool.tsx` 的 tool schema 里 `model` 目前限制为 `z.enum(['sonnet', 'opus', 'haiku'])`，需要改成通用字符串或配置 alias。
- `src/tools/TeamCreateTool/TeamCreateTool.ts` team lead model 来自 appState/mainLoopModel/default，需要接入配置解析。
- `src/utils/swarm/spawnUtils.ts` 会传播 provider/config env，需要增加 `MY_CODE_CONFIG_DIR`、`MY_CODE_PROVIDER` 等新变量。

## 目标配置 schema 建议

以现有 `~/.my-code/models.config.json` 为基础，建议稳定为：

```json
{
  "currentProvider": "fkcodex",
  "currentModel": "gpt-5.5",
  "configVersion": 1,
  "proxy": {
    "enable": false,
    "socks5": "socks5://127.0.0.1:7897",
    "http": "http://127.0.0.1:7890",
    "https": "http://127.0.0.1:7890"
  },
  "aliases": {
    "opus": "gpt-5.5",
    "sonnet": "gpt-5.5",
    "haiku": "gpt-5.5",
    "fast": "gpt-5.5",
    "reasoning": "gpt-5.5"
  },
  "providers": {
    "fkcodex": {
      "name": "FK Codex",
      "protocol": "openai",
      "apiUrl": "https://cch.fkcodex.com/v1",
      "apiKey": "...",
      "defaultModel": "gpt-5.5",
      "headers": {},
      "models": [
        {
          "id": "gpt-5.5",
          "name": "gpt-5.5",
          "description": "FK Codex GPT-5.5",
          "contextWindow": 400000,
          "maxOutputTokens": 128000,
          "supportsTools": true,
          "supportsStreaming": true,
          "supportsThinking": false
        }
      ],
      "proxy": {
        "enable": false,
        "socks5": "socks5://127.0.0.1:7897"
      }
    }
  },
  "agents": {
    "defaultModel": "gpt-5.5",
    "models": {
      "main": "gpt-5.5",
      "agent": "gpt-5.5",
      "fast": "gpt-5.5",
      "reasoning": "gpt-5.5",
      "planner": "gpt-5.5",
      "executor": "gpt-5.5",
      "critic": "gpt-5.5",
      "verifier": "gpt-5.5"
    }
  },
  "teams": {
    "defaultModel": "gpt-5.5",
    "models": {
      "main": "gpt-5.5",
      "agent": "gpt-5.5",
      "fast": "gpt-5.5",
      "reasoning": "gpt-5.5"
    }
  }
}
```

协议字段第一阶段只支持：

- `anthropic`：厂商自建或代理的 Anthropic Messages compatible，不内置官方 Anthropic。
- `openai`：OpenAI compatible，配置形态为 `apiUrl: "https://host/v1"`，第一阶段优先请求 `/chat/completions`；若厂商只支持 Responses API，再扩展协议子类型。

## 编译时自定义设计

建议新增构建期常量，集中在一个模块，例如 `src/customization/defaults.ts` 或通过 `bun --define` 注入：

- `MY_CODE_APP_NAME`：默认 `my-code`。
- `MY_CODE_CONFIG_DIR_NAME`：默认 `.my-code`。
- `MY_CODE_CONFIG_ENV`：默认 `MY_CODE_CONFIG_DIR`。
- `MY_CODE_PROVIDER_ENV`：默认 `MY_CODE_PROVIDER`。
- `MY_CODE_MODELS_CONFIG_FILE`：默认 `models.config.json`。
- `MY_CODE_DEFAULT_MODELS_CONFIG_JSON`：可选，编译时内置不含隐私的配置模板；不得内置真实 provider apiKey。
- `MY_CODE_DISABLE_LOGIN`：默认 true。
- build 输出名：默认 `my-code`，支持 `--app-name`、`--config-dir-name`、`--default-model-config <file>`。

运行时优先级建议：

1. CLI 参数，例如 `--model`、未来可选 `--provider`。
2. 环境变量：`MY_CODE_CONFIG_DIR`、`MY_CODE_PROVIDER`、`MY_CODE_MODEL_CONFIG`。
3. `~/.my-code/models.config.json`。
4. 编译时内置 defaults，例如 app 名、配置目录、默认配置模板。
5. 安全 fallback：创建不含 apiKey 的配置模板并提示用户补充 provider。

## 分阶段实施计划

### P0：项目初始化和安全清理

- 删除或忽略已复制的 `cli`、`node_modules/` 构建产物，避免误提交。
- 初始化/确认 git 状态。
- 更新 package/bin/build 输出为 `my-code`。

### P1：品牌与配置目录迁移

- 替换用户可见 `free-code` 为 `my-code`。
- 将默认配置根目录从 `~/.claude` 改到 `~/.my-code`。
- 新增 `MY_CODE_CONFIG_DIR`，兼容期可读取 `CLAUDE_CONFIG_DIR` 但不默认写入。
- 首次启动自动创建配置目录、sessions、projects、logs/cache 等必要目录。

### P2：models.config.json 配置系统

- 新增 `src/utils/model/providerConfig.ts` 或类似模块。
- 定义 zod schema、加载、保存、初始化默认配置。
- 支持全局/providor 级代理解析。
- 提供 `getCurrentProviderConfig()`、`getCurrentModelConfig()`、`resolveModelAlias()`、`getConfiguredModels()` 等 API。

### P3：去除登录/登出

- 从 `src/commands.ts` 完全移除 login/logout 注册与命令入口。
- API client 不再依赖 OAuth token 获取。
- 保留最小 API key helper 支持但从 provider config 读取。

### P4：Anthropic/OpenAI 通用协议

- 改造 `src/services/api/client.ts`：按 provider.protocol 分支。
- Anthropic：使用 Anthropic SDK + configured apiKey/baseURL/defaultHeaders，但不提供官方 Anthropic 默认配置。
- OpenAI：新增通用 fetch adapter，将 Anthropic SDK 请求转换到 OpenAI compatible `/chat/completions` API。
- 支持 streaming、tool use、tool result、system prompt、max tokens、temperature 等核心字段。

### P5：动态 /model

- 改造 `src/commands/model/model.tsx`、`src/utils/model/modelOptions.ts`、`ModelPicker` 数据源。
- 只展示当前 provider models。
- 选择后写回 appState/session/global config 中的 currentModel。
- 支持切换 provider 的设计可后续新增 `/provider` 或扩展 `/model` 分组。

### P6：动态 context window 与 auto-compact

- `getContextWindowForModel()`、`getModelMaxOutputTokens()` 优先读取 current provider model config。
- `autoCompact.ts` 自动使用动态窗口。
- modelCapabilities 对非 Anthropic provider 不再请求 Anthropic models API，避免错误。

### P7：agent/team/subagent 模型适配

- `AgentTool` 的 `model` 参数从固定 enum 改为 string/alias。
- `getAgentModel()` 使用 config aliases 和 `agents.models`。
- `TeamCreateTool` 和 swarm spawn 继承 `MY_CODE_*` 环境变量。
- 默认 subagent 模型优先 inherit，其次 `agents.defaultModel`。

### P8：打包自定义

- `scripts/build.ts` 增加 app name、配置目录名、默认 config 注入。
- 文档说明其他用户如何编译自己的品牌和默认 provider。

## 主要风险

1. OpenAI streaming 到 Anthropic streaming 的转换是最高风险点，需要用真实兼容 API 测试 tool use、多轮工具调用、错误处理。
2. 原代码中很多安全/权限/插件/skills 路径依赖 `~/.claude` 语义，目录迁移必须优先走统一 helper，避免遗漏。
3. `/model` 目前和 Claude alias、1M context、fast mode、pricing 深度耦合，动态化时要避免破坏 appState。
4. 移除登录后，旧的 Claude AI 账号状态、订阅判断、Codex subscriber 判断会失效，相关 UI 需同步降级。
5. `~/.my-code/models.config.json` 中包含 apiKey，文档与默认模板不能提交真实 key。

## 已确认决策

1. 不保留官方 Anthropic/Claude provider 模板；官方账号体系在目标环境不可用。
2. OpenAI 兼容协议必须适配 `https://cch.fkcodex.com/v1` 这类 base URL，第一阶段按常见 OpenAI `/chat/completions` 兼容接口实现；如实际厂商需要 Responses API，再补充协议分支。
3. `/login`、`/logout` 完全删除，不保留提示型命令。
4. `/provider` 可以后续新增；现阶段允许用户通过 `models.config.json` 设置 `currentProvider`。首次启动如缺少配置，应创建模板并提示用户编辑。
5. 编译时只注入 app 名、工作/配置目录、默认模板等非隐私自定义信息；真实 provider、model、apiKey 由用户在本地配置。
