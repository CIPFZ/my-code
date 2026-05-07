import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getModelOptions, getProviderScopedModelOptions } from './modelOptions.js'
import { clearModelConfigCache } from './configs.js'

function withConfigAndCache(config: object, cache?: object): string {
  const dir = join(tmpdir(), `my-code-model-options-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'models.config.json'), JSON.stringify(config))
  if (cache) {
    writeFileSync(join(dir, 'provider-models.json'), JSON.stringify(cache))
  }
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

describe('provider scoped model options', () => {
  it('uses discovered provider cache when provider enables modelDiscovery', () => {
    withConfigAndCache(
      {
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
      },
      {
        providers: {
          'custom-openai': {
            models: [
              { id: 'gpt-dynamic', name: 'GPT Dynamic' },
              { id: 'gpt-fast', name: 'GPT Fast' },
            ],
          },
        },
      },
    )

    expect(getProviderScopedModelOptions()).toEqual([
      {
        value: 'gpt-dynamic',
        label: 'GPT Dynamic',
        description: 'gpt-dynamic',
      },
      {
        value: 'gpt-fast',
        label: 'GPT Fast',
        description: 'gpt-fast',
      },
    ])
  })

  it('falls back to configured model ids before discovery cache is populated', () => {
    withConfigAndCache({
      currentProvider: 'custom-openai',
      providers: {
        'custom-openai': {
          protocol: 'openai',
          apiUrl: 'https://example.com/v1',
          apiKey: 'key',
          defaultModel: 'gpt-default',
          compactModel: 'gpt-compact',
          fallbackModel: 'gpt-fallback',
          modelDiscovery: { enabled: true },
        },
      },
    })

    expect(getProviderScopedModelOptions().map(option => option.value)).toEqual([
      'gpt-default',
      'gpt-compact',
      'gpt-fallback',
    ])
  })

  it('does not expose invalid undefined model options', () => {
    withConfigAndCache({
      currentProvider: 'custom-openai',
      providers: {
        'custom-openai': {
          protocol: 'openai',
          apiUrl: 'https://example.com/v1',
          apiKey: 'key',
          defaultModel: 'gpt-default',
        },
      },
    })

    expect(getModelOptions().some(option => option.value === undefined)).toBe(false)
    expect(
      getModelOptions().some(
        option =>
          typeof option.value === 'string' && option.value.includes('undefined'),
      ),
    ).toBe(false)
  })
})
