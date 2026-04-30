# my-code

<p align="center">
  <strong>基于 Claude Code 源码的自定义构建版本</strong><br>
  移除所有遥测。使用本地 provider/API key 配置。支持代理和多模型协议。<br>
  一个二进制文件，零回调。
</p>

---

## 目录

- [快速安装](#快速安装)
- [新增特性](#新增特性)
- [模型提供商](#模型提供商)
- [代理配置](#代理配置)
- [配置文件](#配置文件)
- [构建](#构建)
- [测试](#测试)
- [使用方法](#使用方法)
- [项目结构](#项目结构)

---

## 快速安装

```bash
curl -fsSL https://raw.githubusercontent.com/paoloanzn/my-code/main/install.sh | bash
```

或手动构建：

```bash
git clone https://github.com/paoloanzn/my-code.git
cd my-code
bun install
bun run build
./my-code
```

---

## 新增特性

本次优化版本在原版 my-code 基础上增加了以下功能：

### 1. 配置文件驱动的模型配置

模型配置通过内置常量定义，支持 Anthropic 和 OpenAI 两种协议。配置文件路径可通过环境变量指定：

```bash
# 指定配置文件路径
export MY_CODE_CONFIG_DIR="/path/to/models.config.json"
```

配置示例请参考 `models.config.example.json`。

### 2. SOCKS5 代理支持

完整支持 HTTP、HTTPS 和 SOCKS5 代理配置：

```bash
# 环境变量方式
export SOCKS5_PROXY="socks5://user:pass@host:port"
export HTTPS_PROXY="http://proxy.example.com:8080"
```

### 3. 移除登录/OAuth 运行时路径

- `/login`、`/logout` 不再注册为用户可见命令
- API 认证来自 `~/.my-code/models.config.json` 中当前 provider 的 `apiKey` 或显式 `apiKeyEnv`
- 订阅状态不参与 provider、model 或认证选择

### 4. /model 动态获取

使用 `/model custom` 命令可动态配置自定义 API：

```bash
./my-code /model custom
# 输入 API URL 和 Key
# 系统自动获取支持的模型列表
```

### 5. Auto Compact 智能适配

- 根据不同模型自动调节 context 窗口大小
- 标准模型：200K tokens
- [1m] 模型：1M tokens
- 模型切换后自动重新计算

---

## 模型提供商

支持 **5 种 API 提供商**，通过环境变量切换：

| 提供商 | 配置方式 | 认证方式 |
|--------|----------|----------|
| Anthropic | `~/.my-code/models.config.json` + `MY_CODE_PROVIDER=anthropic` | provider `apiKey` / `apiKeyEnv` |
| OpenAI-compatible | `~/.my-code/models.config.json` + `MY_CODE_PROVIDER=<provider>` | provider `apiKey` / `apiKeyEnv` |
| 自定义 provider | `~/.my-code/models.config.json` + `MY_CODE_PROVIDER=<provider>` | provider `apiKey` / `apiKeyEnv` |

### Anthropic (默认)

```bash
export MY_CODE_PROVIDER=anthropic
./my-code
```

| 模型 | ID |
|------|-----|
| Claude Opus 4.6 | `claude-opus-4-6` |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` |
| Claude Haiku 4.5 | `claude-haiku-4-5` |

### OpenAI-compatible provider

在 `~/.my-code/models.config.json` 中配置 provider 的 `apiUrl`、`apiKey`/`apiKeyEnv`、`defaultModel` 后运行：

```bash
MY_CODE_PROVIDER=custom1 ./my-code
```

### Custom providers

通过 `~/.my-code/models.config.json` 增加 provider，并用 `MY_CODE_PROVIDER` 选择当前 provider。

---

## 代理配置

### 环境变量方式

```bash
# HTTP/HTTPS 代理
export HTTPS_PROXY="http://proxy.example.com:8080"
export NO_PROXY="localhost,127.0.0.1"

# SOCKS5 代理
export SOCKS5_PROXY="socks5://user:pass@host:port"
```

### 配置文件方式

```json
// proxy.config.json
{
  "http": "http://proxy.example.com:8080",
  "https": "http://proxy.example.com:8080",
  "socks5": "socks5://user:pass@host:1080",
  "no_proxy": ["localhost", "127.0.0.1"]
}
```

通过环境变量指定配置文件路径：
```bash
export CLAUDE_CODE_PROXY_CONFIG="/path/to/proxy.config.json"
```

---

## 配置文件

### 模型配置文件

```json
// ~/.my-code/models.config.json
{
  "default": "anthropic",
  "proxy": {
    "http": "http://proxy:8080",
    "socks5": "socks5://user:pass@proxy:1080"
  },
  "providers": {
    "anthropic": {
      "apiUrl": "https://api.anthropic.com",
      "apiKey": "your-anthropic-key",
      "protocol": "anthropic",
      "defaultModel": "claude-opus-4-6"
    },
    "custom1": {
      "apiUrl": "https://cch.fkcodex.com/v1",
      "apiKey": "your-custom-key",
      "protocol": "openai",
      "defaultModel": "gpt-4o",
      "proxy": {
        "socks5": "socks5://different-proxy:1080"
      }
    }
  }
}
```

### 切换厂商

```bash
# 使用默认厂商（anthropic）
./my-code

# 使用 custom1 厂商
MY_CODE_PROVIDER=custom1 ./my-code

# 使用 anthropic 厂商
MY_CODE_PROVIDER=anthropic ./my-code
```

配置文件路径（按优先级）：
1. `MY_CODE_MODEL_CONFIG` 环境变量
2. `MY_CODE_CONFIG_DIR/models.config.json`
3. `~/.my-code/models.config.json`（默认）

---

## 构建

```bash
# 安装依赖
bun install

# 标准构建
bun run build

# 开发构建（带实验功能）
bun run build:dev

# 全功能解锁构建
bun run build:dev:full

# 从源码运行（较慢启动）
bun run dev
```

---

## 测试

```bash
# 运行所有测试
bun test

# 运行特定测试文件
bun test src/utils/proxy.test.ts

# 运行测试并显示详细输出
bun test --reporter=verbose
```

### 测试覆盖

| 文件 | 测试内容 |
|------|----------|
| `src/utils/proxy.test.ts` | 代理URL解析、SOCKS5支持、NO_PROXY匹配 |
| `src/utils/auth.test.ts` | 3P服务检测、订阅名称映射 |
| `src/utils/model/configs.test.ts` | 配置文件路径解析 |
| `src/services/compact/autoCompact.test.ts` | Auto compact窗口计算、token warning |

**测试结果：50 个测试全部通过**

---

## 使用方法

```bash
# 交互式 REPL（默认）
./my-code

# 单次查询模式
./my-code -p "what files are in this directory?"

# 指定模型
./my-code --model claude-opus-4-6

# 自定义 API 配置
./my-code /model custom

# 配置当前 provider 后运行
MY_CODE_PROVIDER=anthropic ./my-code
```

### 环境变量参考

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点 |
| `ANTHROPIC_MODEL` | 覆盖默认模型 |
| `MY_CODE_MODEL_CONFIG` | 模型配置文件完整路径 |
| `MY_CODE_CONFIG_DIR` | 模型配置目录 |
| `CLAUDE_CODE_PROXY_CONFIG` | 代理配置文件路径 |
| `HTTPS_PROXY` / `SOCKS5_PROXY` | 代理服务器 |
| `NO_PROXY` | 不使用代理的地址 |

---

## 项目结构

```
my-code/
├── scripts/
│   └── build.ts              # 构建脚本（feature flag 系统）
├── src/
│   ├── entrypoints/
│   │   └── cli.tsx           # CLI 入口
│   ├── commands/
│   │   ├── model/            # /model 命令
│   │   ├── compact/          # /compact 命令
│   │   └── context/          # /context 命令
│   ├── components/
│   │   ├── ModelPicker.js    # 模型选择器
│   │   ├── ContextVisualization.tsx  # 上下文可视化
│   │   └── CustomAPISetup.tsx # 自定义 API 配置
│   ├── services/
│   │   ├── api/              # API client/adapters
│   │   └── compact/          # Auto compact 服务
│   ├── utils/
│   │   ├── model/
│   │   │   ├── configs.ts     # 模型配置
│   │   │   ├── providers.ts  # 提供商判断
│   │   │   ├── model.ts      # 模型解析
│   │   │   └── fetchModels.ts # 动态获取模型
│   │   ├── proxy.ts          # 代理配置
│   │   └── auth.ts           # 认证工具
│   └── ...
├── tests/                    # 测试文件
├── models.config.json        # 模型配置示例
└── proxy.config.json         # 代理配置示例
```

---

## 技术栈

| | |
|---|---|
| **运行时** | Bun >= 1.3.11 |
| **语言** | TypeScript |
| **终端 UI** | React + Ink |
| **CLI 解析** | Commander.js |
| **验证** | Zod v4 |

---

## License

原始 Claude Code 源码版权归 Anthropic 所有。本 fork 因源码在 npm 分包中被公开暴露而存在。
