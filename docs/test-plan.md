# 测试方案

本文档描述 `my-code` 项目的测试策略、重点覆盖范围和手动验证清单。

## 测试框架

项目使用 Bun 内置测试框架：

```bash
# 安装依赖
bun install

# 运行所有测试
bun test

# 运行单个测试文件
bun test path/to/file.test.ts

# 详细输出
bun test --reporter=verbose
```

## 自动化测试重点

当前测试应优先覆盖以下热路径：

### 1. Provider / Model 配置

目标：确保 `~/.my-code/models.config.json` 和 `MY_CODE_*` 环境变量能稳定控制 provider 与模型。

重点用例：

- 默认配置路径解析：`~/.my-code/models.config.json`。
- `MY_CODE_MODEL_CONFIG` 覆盖配置文件路径。
- `MY_CODE_CONFIG_DIR` 覆盖配置目录。
- `MY_CODE_PROVIDER` 覆盖当前 provider。
- provider 缺失时报错。
- provider `protocol` 只接受 `anthropic` / `openai`。
- 当前 provider 下模型列表解析。
- `defaultModel` 自动进入 provider model list。
- 模型缺失 `contextWindow` 时明确报错。

相关源码：

- `src/utils/model/configs.ts`
- `src/utils/model/model.ts`
- `src/utils/model/modelOptions.ts`

### 2. OpenAI-compatible Adapter

目标：确保 OpenAI-compatible 后端能通过 Anthropic SDK fetch adapter 接入原 query pipeline。

重点用例：

- Anthropic Messages body 转 OpenAI Chat Completions body。
- system prompt 转换。
- user / assistant text message 转换。
- image block 转换。
- tool schema 转换。
- `tool_use` 转 OpenAI tool call。
- `tool_result` 转 OpenAI tool message。
- OpenAI streaming text delta 转 Anthropic SSE。
- OpenAI streaming tool call delta 转 Anthropic `tool_use`。
- OpenAI error response 转 Anthropic SDK 可消费 error。

相关源码：

- `src/services/api/client.ts`
- `src/services/api/openai-fetch-adapter.ts`
- `src/services/api/claude.ts`

### 3. Context Window / Auto Compact

目标：确保上下文窗口和自动压缩基于当前 provider 的模型 metadata，而不是硬编码 Claude 默认值。

重点用例：

- `getContextWindowForModel()` 使用 provider model `contextWindow`。
- `[1m]` suffix 行为符合预期。
- `getEffectiveContextWindowSize()` 正确预留 summary output tokens。
- auto compact threshold 随模型窗口变化。
- 缺失 metadata 时失败而不是静默 fallback。

相关源码：

- `src/utils/context.ts`
- `src/services/compact/autoCompact.ts`
- `src/commands/context/`

### 4. `/model` 与 Agent / Team 路由

目标：确保模型选择严格限制在当前 provider 范围内。

重点用例：

- `/model` 只展示当前 provider 的模型。
- provider 切换后模型列表变化。
- 未配置模型不能被静默选中。
- agent `toolSpecifiedModel` 优先级最高。
- `agents.defaultModel` / `teams.defaultModel` 生效。
- team role model 生效。
- frontmatter alias 只作为兼容路径，且必须能解析到当前 provider 模型。
- 无法解析时报错，不 fallback 到 `sonnet` / `opus` / `haiku`。

相关源码：

- `src/components/ModelPicker.tsx`
- `src/utils/model/modelOptions.ts`
- `src/utils/model/configs.ts`
- `src/tools/AgentTool/`
- `src/tools/TeamCreateTool/`

### 5. CLI 构建与启动

目标：确保 Bun 构建产物可直接运行。

重点用例：

- `bun run build` 输出 `./my-code`。
- `bun run build:dev` 输出 `./my-code-dev`。
- `bun run compile` 输出 `./dist/my-code`。
- `./my-code --version` 可执行。
- `bun run dev` 可从源码启动。
- `./my-code -p "..."` 可走 headless 查询路径。

相关源码：

- `scripts/build.ts`
- `src/entrypoints/cli.tsx`
- `src/main.tsx`

## 手动验证清单

### 基础启动

- [ ] `bun install`
- [ ] `bun test`
- [ ] `bun run build`
- [ ] `./my-code --version`
- [ ] `./my-code -p "hello"`
- [ ] `bun run dev`

### 配置文件

- [ ] 使用默认 `~/.my-code/models.config.json`。
- [ ] 使用 `MY_CODE_MODEL_CONFIG` 指向临时配置。
- [ ] 使用 `MY_CODE_CONFIG_DIR` 指向临时目录。
- [ ] 使用 `MY_CODE_PROVIDER` 切换 provider。
- [ ] provider `apiKeyEnv` 能正确读取 API key。
- [ ] provider `baseUrl` 生效。

### 模型选择

- [ ] `/model` 显示当前 provider 下的模型。
- [ ] 切换 provider 后 `/model` 列表变化。
- [ ] 选择模型后当前 session 使用新模型。
- [ ] 未配置模型时报错清晰。

### OpenAI-compatible 后端

- [ ] 普通文本查询成功。
- [ ] Bash/File Read 等工具调用成功。
- [ ] 多轮 tool use 能继续执行。
- [ ] 错误 API key / base URL 时错误信息清晰。
- [ ] streaming 输出正常。

### Anthropic-compatible 后端

- [ ] 普通文本查询成功。
- [ ] 工具调用成功。
- [ ] `/context` 显示窗口合理。
- [ ] auto compact 触发逻辑符合模型窗口。

## 提交前建议

如果依赖已安装，提交前建议至少运行：

```bash
bun test
bun run build
./my-code --version
```

如果修改了 OpenAI adapter 或 query pipeline，建议额外做一次真实 provider 的手动工具调用验证。
