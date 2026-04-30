# my-code

`my-code` 是一个基于 Claude Code 源码改造的 Bun 单包 CLI，目标是提供一个本地可控、配置驱动、支持多厂商模型的代码助手运行时。

本项目的核心改造方向：

- 使用 `~/.my-code` 作为用户配置目录。
- 使用 `MY_CODE_*` 作为 my-code 自身环境变量前缀。
- 通过配置文件管理 provider、protocol、model、context window 和 API key。
- 支持 Anthropic Messages 协议与 OpenAI-compatible 协议。
- 移除 `/login`、`/logout` 和订阅/OAuth 驱动的模型选择路径。
- `/model` 只在当前 provider 下选择模型。
- `/context` 与 auto compact 根据当前模型 metadata 动态计算上下文窗口。
- subagent/team 模型路由优先使用 my-code 配置，避免默认落到 Claude 模型族。

## 快速开始

### 环境要求

- Bun >= 1.3
- Node.js 兼容运行环境
- 一个可用的 Anthropic 或 OpenAI-compatible API key

### 安装依赖

```bash
bun install
```

### 配置模型

创建配置目录：

```bash
mkdir -p ~/.my-code
cp models.config.example.json ~/.my-code/models.config.json
```

编辑 `~/.my-code/models.config.json`，配置当前 provider 和模型。

最小示例：

```json
{
  "currentProvider": "openai",
  "providers": {
    "openai": {
      "protocol": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "MY_CODE_OPENAI_API_KEY",
      "defaultModel": "gpt-5.4",
      "models": {
        "gpt-5.4": {
          "displayName": "GPT-5.4",
          "contextWindow": 128000,
          "maxOutputTokens": 16000
        }
      }
    }
  }
}
```

然后设置 API key：

```bash
export MY_CODE_OPENAI_API_KEY="your-api-key"
```

也可以通过环境变量切换当前 provider：

```bash
export MY_CODE_PROVIDER=openai
```

## 运行

从源码运行：

```bash
bun run dev
```

构建后运行：

```bash
bun run build
./my-code
```

单次查询：

```bash
./my-code -p "summarize this repository"
```

## 构建命令

```bash
# 标准构建，输出 ./my-code
bun run build

# 开发构建，输出 ./my-code-dev
bun run build:dev

# 开发构建并启用实验功能
bun run build:dev:full

# 编译构建
bun run compile
```

注意：`my-code`、`my-code-dev`、`dist/` 等构建产物不应提交到 Git。

## 测试

```bash
bun test
```

当前重点测试覆盖：

- provider/model resolver
- `~/.my-code` 配置解析
- provider-scoped model metadata
- OpenAI/Codex fetch adapter
- auto compact context window 计算

## 配置文件

默认配置路径：

```text
~/.my-code/models.config.json
```

可用环境变量：

| 变量 | 说明 |
|---|---|
| `MY_CODE_CONFIG_DIR` | my-code 配置目录，默认 `~/.my-code` |
| `MY_CODE_MODEL_CONFIG` | 模型配置文件完整路径 |
| `MY_CODE_PROVIDER` | 覆盖当前 provider |
| provider 自定义 `apiKeyEnv` | 由配置文件显式声明，例如 `MY_CODE_OPENAI_API_KEY` |

### Provider schema

每个 provider 必须显式声明协议：

```json
{
  "currentProvider": "anthropic",
  "providers": {
    "anthropic": {
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "MY_CODE_ANTHROPIC_API_KEY",
      "defaultModel": "claude-sonnet-4-6",
      "models": {
        "claude-sonnet-4-6": {
          "displayName": "Claude Sonnet 4.6",
          "contextWindow": 200000,
          "maxOutputTokens": 16000
        }
      }
    }
  }
}
```

支持的 `protocol`：

- `anthropic`：Anthropic Messages-compatible API
- `openai`：OpenAI-compatible Chat Completions API adapter

模型 metadata 采用配置优先：

- `contextWindow` 用于 `/context` 和 auto compact。
- `maxOutputTokens` 用于输出限制相关逻辑。
- 如果配置缺失且无法从 provider API 获取，会明确报错。

## 模型选择

`/model` 只展示当前 provider 下配置的模型。

provider 由以下顺序决定：

1. `MY_CODE_PROVIDER`
2. `models.config.json` 中的 `currentProvider`
3. 配置缺失时报错

## Agent / Team 模型路由

subagent/team 模型选择遵循：

1. tool 显式指定且在当前 provider 下有效的模型
2. `~/.my-code/models.config.json` 中的 agent/team 配置
3. 当前 provider/current model
4. 配置过的 frontmatter alias 兼容映射
5. 无法解析时报错

不会静默 fallback 到 `sonnet`、`opus`、`haiku`。

## 项目结构

```text
src/entrypoints/        CLI 入口
src/screens/            交互式 REPL / Ink UI
src/commands/           slash command 实现
src/components/         终端 UI 组件
src/services/api/       API client 与 protocol adapters
src/services/compact/   auto compact 服务
src/tools/              工具与 AgentTool
src/utils/model/        provider/model/resolver 配置系统
src/utils/context.ts    context window 相关逻辑
scripts/build.ts        Bun 构建脚本
docs/                   项目文档
```

## 文档

- `docs/project-architecture-overview.md`：项目架构梳理
- `models.config.example.json`：多 provider 配置示例
- `CLAUDE.md`：本仓库开发时给 Claude Code 的工程说明，不作为 my-code 用户配置文件

## Git 注意事项

以下内容不应提交：

- `node_modules/`
- `dist/`
- `my-code`
- `my-code-dev`
- `.omc/`
- `.claude/`
- 临时 `test-*.ts` / `test-*.mjs` 调试脚本

## License

本项目是基于 Claude Code 源码的自定义改造版本。请根据原始项目许可与使用约束自行评估分发和使用方式。
