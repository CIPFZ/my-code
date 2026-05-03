import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import {
  ensureModelsConfig,
  getConfiguredModels,
  getCurrentModelConfig,
  getCurrentProviderConfig,
  getModelsConfigPath,
  getProviderProxyConfig,
  loadModelsConfig,
  resolveConfiguredModelAlias,
  isConfiguredModel,
  updateCurrentModelConfig,
  type ModelsConfig,
} from './providerConfig.js'
import { ensureMyCodeConfigHomeDir, getClaudeConfigHomeDir } from '../envUtils.js'

const tempDirs: string[] = []
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalConfigDir = process.env.MY_CODE_CONFIG_DIR
const originalModelConfig = process.env.MY_CODE_MODEL_CONFIG
const originalProvider = process.env.MY_CODE_PROVIDER

function makeTempDir(): string {
  const dir = join(tmpdir(), `my-code-provider-config-${Date.now()}-${Math.random()}`)
  tempDirs.push(dir)
  return dir
}

function resetEnv(): void {
  if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

  if (originalConfigDir === undefined) delete process.env.MY_CODE_CONFIG_DIR
  else process.env.MY_CODE_CONFIG_DIR = originalConfigDir

  if (originalModelConfig === undefined) delete process.env.MY_CODE_MODEL_CONFIG
  else process.env.MY_CODE_MODEL_CONFIG = originalModelConfig

  if (originalProvider === undefined) delete process.env.MY_CODE_PROVIDER
  else process.env.MY_CODE_PROVIDER = originalProvider
}

afterEach(() => {
  resetEnv()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeConfig(): ModelsConfig {
  return {
    currentProvider: 'custom',
    currentModel: 'fast',
    proxy: {
      enable: true,
      http: 'http://global.proxy:7890',
    },
    aliases: {
      fast: 'custom-model',
      nested: 'fast',
    },
    providers: {
      custom: {
        name: 'Custom Provider',
        protocol: 'openai',
        apiUrl: 'https://custom.example/v1',
        apiKey: 'test-key',
        headers: {
          'x-test': 'true',
        },
        defaultModel: 'custom-model',
        models: [
          {
            id: 'custom-model',
            name: 'Custom Model',
            contextWindow: 123456,
            maxOutputTokens: 7890,
          },
        ],
        proxy: {
          enable: true,
          https: 'http://provider.proxy:7890',
        },
      },
    },
    agents: {
      defaultModel: 'fast',
      models: {
        executor: 'custom-model',
      },
    },
    teams: {
      defaultModel: 'custom-model',
      models: {
        main: 'custom-model',
      },
    },
  }
}

describe('providerConfig', () => {
  test('uses ~/.my-code as the default config directory', () => {
    delete process.env.MY_CODE_CONFIG_DIR
    delete process.env.MY_CODE_MODEL_CONFIG
    delete process.env.CLAUDE_CONFIG_DIR

    expect(getClaudeConfigHomeDir()).toBe(join(homedir(), '.my-code'))
    expect(getModelsConfigPath()).toBe(join(homedir(), '.my-code', 'models.config.json'))
  })

  test('creates config home directories on first initialization', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG
    delete process.env.CLAUDE_CONFIG_DIR

    ensureMyCodeConfigHomeDir()

    expect(existsSync(configDir)).toBe(true)
    expect(existsSync(join(configDir, 'sessions'))).toBe(true)
    expect(existsSync(join(configDir, 'projects'))).toBe(true)
    expect(existsSync(join(configDir, 'logs'))).toBe(true)
    expect(existsSync(join(configDir, 'cache'))).toBe(true)
  })


  test('uses CLAUDE_CONFIG_DIR only as a compatibility fallback', () => {
    const legacyConfigDir = makeTempDir()
    process.env.CLAUDE_CONFIG_DIR = legacyConfigDir
    delete process.env.MY_CODE_CONFIG_DIR
    delete process.env.MY_CODE_MODEL_CONFIG

    expect(getClaudeConfigHomeDir()).toBe(legacyConfigDir)
    expect(getModelsConfigPath()).toBe(join(legacyConfigDir, 'models.config.json'))
  })

  test('MY_CODE_CONFIG_DIR takes precedence over CLAUDE_CONFIG_DIR', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    process.env.CLAUDE_CONFIG_DIR = makeTempDir()
    delete process.env.MY_CODE_MODEL_CONFIG

    expect(getClaudeConfigHomeDir()).toBe(configDir)
    expect(getModelsConfigPath()).toBe(join(configDir, 'models.config.json'))
  })

  test('uses MY_CODE_MODEL_CONFIG when provided', () => {
    const configPath = join(makeTempDir(), 'custom-models.json')
    process.env.MY_CODE_MODEL_CONFIG = configPath

    expect(getModelsConfigPath()).toBe(configPath)
  })

  test('uses MY_CODE_CONFIG_DIR for default models config path', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG

    expect(getModelsConfigPath()).toBe(join(configDir, 'models.config.json'))
  })

  test('initializes missing config file and base directories without a real api key', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG

    const configPath = ensureModelsConfig()
    const rawConfig = readFileSync(configPath, 'utf8')
    const loadedConfig = loadModelsConfig()

    expect(configPath).toBe(join(configDir, 'models.config.json'))
    expect(existsSync(configDir)).toBe(true)
    expect(existsSync(join(configDir, 'sessions'))).toBe(true)
    expect(existsSync(join(configDir, 'projects'))).toBe(true)
    expect(existsSync(join(configDir, 'logs'))).toBe(true)
    expect(existsSync(join(configDir, 'cache'))).toBe(true)
    expect(existsSync(configPath)).toBe(true)
    expect(rawConfig).toContain('example')
    expect(rawConfig).not.toContain('sk-')
    expect(loadedConfig.providers.example?.apiKey).toBe('')
  })

  test('loads custom provider config and current model details', () => {
    const config = makeConfig()

    expect(getCurrentProviderConfig(config)?.apiUrl).toBe('https://custom.example/v1')
    expect(getConfiguredModels(config)).toHaveLength(1)
    expect(getCurrentModelConfig(config)?.contextWindow).toBe(123456)
  })

  test('resolves aliases including chained aliases', () => {
    const config = makeConfig()

    expect(resolveConfiguredModelAlias('fast', config)).toBe('custom-model')
    expect(resolveConfiguredModelAlias('nested', config)).toBe('custom-model')
    expect(resolveConfiguredModelAlias('custom-model', config)).toBe('custom-model')
  })

  test('merges global and provider proxy config', () => {
    const config = makeConfig()

    expect(getProviderProxyConfig(config)).toEqual({
      enable: true,
      http: 'http://global.proxy:7890',
      https: 'http://provider.proxy:7890',
    })
  })

  test('checks configured model aliases', () => {
    const config = makeConfig()

    expect(isConfiguredModel('fast', config)).toBe(true)
    expect(isConfiguredModel('missing', config)).toBe(false)
  })

  test('writes selected model back to config', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG
    ensureModelsConfig()

    updateCurrentModelConfig('another-model')

    expect(loadModelsConfig().currentModel).toBe('another-model')
  })
})
