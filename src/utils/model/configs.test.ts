import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  clearModelConfigCache,
  getDiscoveredProviderModelsCachePath,
  resolveAgentModel,
  resolveCurrentProvider,
  resolveModelMetadata,
  resolveProviderModels,
  resolveTeamModel,
} from './configs.js'

function withConfig(config: object): string {
  const dir = join(tmpdir(), `my-code-model-config-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'models.config.json'), JSON.stringify(config))
  process.env.MY_CODE_CONFIG_DIR = dir
  delete process.env.MY_CODE_PROVIDER
  clearModelConfigCache()
  return dir
}

afterEach(() => {
  const dir = process.env.MY_CODE_CONFIG_DIR
  delete process.env.MY_CODE_CONFIG_DIR
  delete process.env.MY_CODE_PROVIDER
  clearModelConfigCache()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('model resolver config', () => {
  const config = {
    currentProvider: 'openai',
    aliases: { sonnet: 'gpt-4o' },
    providers: {
      openai: {
        protocol: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'key',
        defaultModel: 'gpt-4o',
        models: [
          { id: 'gpt-4o', contextWindow: 128000, maxOutputTokens: 16384 },
          { id: 'gpt-4o-mini', contextWindow: 128000 },
        ],
      },
      anthropic: {
        protocol: 'anthropic',
        apiUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        defaultModel: 'claude-opus-4-6',
        models: [{ id: 'claude-opus-4-6', contextWindow: 200000 }],
      },
    },
  }

  it('scopes provider models to the current provider', () => {
    withConfig(config)
    expect(resolveCurrentProvider().id).toBe('openai')
    expect(resolveProviderModels().map(model => model.id)).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ])
  })

  it('uses configured metadata and errors when metadata is missing', () => {
    withConfig(config)
    expect(resolveModelMetadata('gpt-4o').contextWindow).toBe(128000)
    expect(() => resolveModelMetadata('missing-model')).toThrow(/not configured|Missing contextWindow/)
  })

  it('routes agents through current model before frontmatter aliases', () => {
    withConfig(config)
    expect(
      resolveAgentModel({ agentName: 'reviewer', agentModel: 'sonnet', currentModel: 'gpt-4o-mini' }),
    ).toBe('gpt-4o-mini')
  })

  it('rejects unmapped team aliases instead of Claude defaults', () => {
    withConfig(config)
    expect(() =>
      resolveTeamModel({ teamName: 'qa', role: 'lead', toolSpecifiedModel: 'opus' }),
    ).toThrow(/not configured/)
  })

  it('uses cached discovered models when modelDiscovery is enabled', () => {
    const dir = withConfig({
      currentProvider: 'custom-openai',
      providers: {
        'custom-openai': {
          protocol: 'openai',
          apiUrl: 'https://example.com/v1',
          apiKey: 'key',
          defaultModel: 'gpt-dynamic',
          modelDiscovery: { enabled: true },
        },
      },
    })

    writeFileSync(
      getDiscoveredProviderModelsCachePath(),
      JSON.stringify({
        providers: {
          'custom-openai': {
            models: [
              { id: 'gpt-dynamic', name: 'GPT Dynamic' },
              { id: 'gpt-fast', name: 'GPT Fast' },
            ],
          },
        },
      }),
    )

    clearModelConfigCache()

    expect(dir).toBe(process.env.MY_CODE_CONFIG_DIR)
    expect(resolveProviderModels().map(model => model.id)).toEqual([
      'gpt-dynamic',
      'gpt-fast',
    ])
  })

  it('uses provider model defaults for discovered models without metadata', () => {
    withConfig({
      currentProvider: 'custom-openai',
      providers: {
        'custom-openai': {
          protocol: 'openai',
          apiUrl: 'https://example.com/v1',
          apiKey: 'key',
          defaultModel: 'gpt-dynamic',
          modelDiscovery: { enabled: true },
          modelDefaults: {
            contextWindow: 128000,
            maxOutputTokens: 8192,
          },
        },
      },
    })

    writeFileSync(
      getDiscoveredProviderModelsCachePath(),
      JSON.stringify({
        providers: {
          'custom-openai': {
            models: [{ id: 'gpt-dynamic', name: 'GPT Dynamic' }],
          },
        },
      }),
    )

    clearModelConfigCache()

    expect(resolveModelMetadata('gpt-dynamic').contextWindow).toBe(128000)
    expect(resolveModelMetadata('gpt-dynamic').maxOutputTokens).toBe(8192)
  })
})
