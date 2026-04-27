# 测试方案

本文档描述 free-code 项目的测试策略和测试用例。

## 测试框架

项目使用 **Bun 内置测试框架** (`bun:test`)，无需额外配置。

```bash
# 运行所有测试
bun test

# 运行特定测试
bun test src/utils/proxy.test.ts

# 详细输出
bun test --reporter=verbose
```

---

## 测试文件

### 1. src/utils/proxy.test.ts

**目的**: 测试代理配置解析功能（SOCKS5 支持）

**测试用例**:

| 测试名称 | 测试内容 | 状态 |
|----------|----------|------|
| `getProxyUrl - https_proxy uppercase` | 测试大写环境变量解析 | ✅ |
| `getProxyUrl - https_proxy lowercase` | 测试小写环境变量解析 | ✅ |
| `getProxyUrl - with auth` | 测试带认证的代理URL | ✅ |
| `getSocks5ProxyUrl - basic` | 测试 SOCKS5 代理基本解析 | ✅ |
| `getSocks5ProxyUrl - with auth` | 测试带认证的 SOCKS5 | ✅ |
| `getSocks5ProxyUrl - env override` | 测试环境变量覆盖 | ✅ |
| `getNoProxy - comma separated` | 测试逗号分隔的 NO_PROXY | ✅ |
| `getNoProxy - array format` | 测试数组格式 NO_PROXY | ✅ |
| `shouldBypassProxy - exact match` | 测试精确匹配绕过 | ✅ |
| `shouldBypassProxy - wildcard` | 测试通配符绕过 | ✅ |
| `shouldBypassProxy - case insensitive` | 测试大小写不敏感 | ✅ |

### 2. src/utils/auth.test.ts

**目的**: 测试认证和订阅检测功能

**测试用例**:

| 测试名称 | 测试内容 | 状态 |
|----------|----------|------|
| `isClaudeAISubscriber - 3ps detection` | 第三方服务检测 | ✅ |
| `isUsing3PServices - bedrock` | Bedrock 服务检测 | ✅ |
| `getSubscriptionName - mapping` | 订阅名称映射 | ✅ |

### 3. src/utils/model/configs.test.ts

**目的**: 测试模型配置加载

**测试用例**:

| 测试名称 | 测试内容 | 状态 |
|----------|----------|------|
| `getConfigPath - default path` | 默认配置路径 | ✅ |
| `getConfigPath - env override` | 环境变量覆盖 | ✅ |
| `config loading` | 配置文件加载 | ✅ |

### 4. src/services/compact/autoCompact.test.ts

**目的**: 测试 Auto Compact 窗口计算和 token warning

**测试用例**:

| 测试名称 | 测试内容 | 状态 |
|----------|----------|------|
| `context window - standard model` | 标准模型 200K 窗口 | ✅ |
| `context window - 1m model` | 1M 模型大窗口 | ✅ |
| `token warning threshold` | Token 警告阈值 | ✅ |
| `buffer constants` | 缓冲区常量验证 | ✅ |
| `compact trigger calculation` | 压缩触发计算 | ✅ |

---

## 测试执行

### 本地测试

```bash
# 安装依赖
bun install

# 运行所有测试
bun test

# 监听模式（文件变化时自动运行）
bun test --watch
```

### CI/CD 集成

```yaml
# .github/workflows/test.yml 示例
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun test
```

---

## 手动测试清单

### 代理配置测试

- [ ] HTTP 代理正常工作
- [ ] HTTPS 代理正常工作
- [ ] SOCKS5 代理正常工作
- [ ] 带认证的代理正常工作
- [ ] NO_PROXY 正确绕过

### 模型配置测试

- [ ] 默认模型配置加载
- [ ] 自定义配置文件加载
- [ ] Anthropic 协议模型可用
- [ ] OpenAI 协议模型可用

### /model 命令测试

- [ ] `/model` 显示当前模型
- [ ] `/model custom` 进入自定义配置
- [ ] 自定义 API URL/Key 输入
- [ ] 动态获取模型列表

### Auto Compact 测试

- [ ] 标准模型自动压缩
- [ ] 1m 模型大窗口处理
- [ ] Token 警告显示
- [ ] 模型切换后窗口重算

### 登录限制测试

- [ ] 本地 API Key 可用 `/fast`
- [ ] 本地 API Key 可用 `/voice`
- [ ] 本地 API Key 可用 `/usage`
- [ ] 无 claude.ai 订阅时命令可用

---

## 性能基准

当前测试性能：

```
50 pass
0 fail
56 expect() calls
Ran 50 tests across 4 files [127.00ms]
```

---

## 报告问题

如发现测试失败，请在 GitHub Issues 报告，包含：

1. 失败的测试名称
2. 错误信息
3. 复现步骤
4. 环境信息 (`bun --version`, `node --version`)
