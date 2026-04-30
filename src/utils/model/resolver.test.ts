import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearRuntimeModelConfigCache,
  getModelsConfigPath,
  resolveCurrentProvider,
  resolveModelMetadata,
  resolveProviderAuth,
  resolveProviderModels,
  resolveProviderProtocol,
  type ModelConfigFile,
} from './resolver.js'

const originalEnv = { ...process.env }
const tempDirs: string[] = []

afterEach(() => {
  process.env = { ...originalEnv }
  clearRuntimeModelConfigCache()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-code-resolver-'))
  tempDirs.push(dir)
  return dir
}

function resolverEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.MY_CODE_PROVIDER
  return { ...env, ...overrides }
}

function writeConfig(homeDir: string, config: ModelConfigFile): void {
  const configDir = join(homeDir, '.my-code')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'models.config.json'), JSON.stringify(config))
}

describe('my-code model resolver', () => {
  it('uses ~/.my-code and ignores Claude model config env vars', () => {
    const homeDir = tempHome()
    const claudeDir = join(homeDir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'models.config.json'),
      JSON.stringify({ currentProvider: 'claude-only', providers: {} }),
    )
    process.env.CLAUDE_CONFIG_DIR = claudeDir
    process.env.CLAUDE_CODE_MODEL_CONFIG = join(claudeDir, 'models.config.json')
    process.env.CLAUDE_CODE_CONFIG_DIR = claudeDir

    writeConfig(homeDir, {
      currentProvider: 'openai',
      providers: {
        openai: {
          protocol: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'configured-key',
          models: {
            'gpt-test': { contextWindow: 128000, maxOutputTokens: 4096 },
          },
        },
      },
    })

    const provider = resolveCurrentProvider({ homeDir, env: resolverEnv() })
    expect(getModelsConfigPath({ homeDir })).toBe(
      join(homeDir, '.my-code', 'models.config.json'),
    )
    expect(provider.providerId).toBe('openai')
  })

  it('allows MY_CODE_PROVIDER to override currentProvider', () => {
    const homeDir = tempHome()
    writeConfig(homeDir, {
      currentProvider: 'anthropic',
      providers: {
        anthropic: {
          protocol: 'anthropic',
          apiKey: 'a-key',
          models: { 'claude-test': { contextWindow: 200000 } },
        },
        openai: {
          protocol: 'openai',
          apiKey: 'o-key',
          models: { 'gpt-test': { contextWindow: 128000 } },
        },
      },
    })

    const provider = resolveCurrentProvider({
      homeDir,
      env: resolverEnv({ MY_CODE_PROVIDER: 'openai' }),
    })

    expect(provider.providerId).toBe('openai')
    expect(resolveProviderProtocol(provider)).toBe('openai')
  })

  it('requires an explicit valid provider protocol', () => {
    expect(() => resolveProviderProtocol({ apiKey: 'key' })).toThrow(
      'Provider protocol is required',
    )
    expect(() =>
      resolveProviderProtocol({ protocol: 'codex', apiKey: 'key' }),
    ).toThrow('Provider protocol is required')
  })

  it('reads auth only from provider apiKey or explicit apiKeyEnv', () => {
    process.env.ANTHROPIC_API_KEY = 'global-anthropic'

    expect(resolveProviderAuth({ protocol: 'anthropic', apiKey: 'inline' }).apiKey).toBe(
      'inline',
    )
    expect(() => resolveProviderAuth({ protocol: 'anthropic' })).toThrow(
      'Provider auth is missing',
    )
    expect(
      resolveProviderAuth(
        { protocol: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
        { env: process.env },
      ).apiKey,
    ).toBe('global-anthropic')
  })

  it('returns provider-scoped models with config metadata', async () => {
    const provider = resolveCurrentProvider({
      env: resolverEnv(),
      config: {
        currentProvider: 'openai',
        providers: {
          openai: {
            protocol: 'openai',
            apiKey: 'key',
            models: {
              'gpt-test': {
                contextWindow: 128000,
                maxOutputTokens: 8192,
                displayName: 'GPT Test',
              },
            },
          },
          anthropic: {
            protocol: 'anthropic',
            apiKey: 'key',
            models: { 'claude-test': { contextWindow: 200000 } },
          },
        },
      },
    })

    const models = await resolveProviderModels(provider)
    expect(models.models.map(model => model.id)).toEqual(['gpt-test'])

    const metadata = await resolveModelMetadata(provider, 'gpt-test')
    expect(metadata.metadata.contextWindow).toBe(128000)
    expect(metadata.metadata.maxOutputTokens).toBe(8192)
  })

  it('errors when metadata is missing instead of using hardcoded defaults', async () => {
    const provider = resolveCurrentProvider({
      env: resolverEnv(),
      config: {
        currentProvider: 'openai',
        providers: {
          openai: {
            protocol: 'openai',
            apiKey: 'key',
            models: ['gpt-test'],
          },
        },
      },
    })

    await expect(resolveProviderModels(provider)).rejects.toThrow(
      'Model metadata is missing',
    )
    await expect(resolveModelMetadata(provider, 'gpt-test')).rejects.toThrow(
      'Model metadata is missing',
    )
  })
})
