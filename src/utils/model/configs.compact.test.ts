import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearModelConfigCache,
  getConfigCompactModel,
  getConfigDefaultModel,
  getConfigFallbackModel,
} from './configs.js'

function withConfig(config: object): string {
  const dir = join(tmpdir(), `my-code-compact-config-${Date.now()}-${Math.random()}`)
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

describe('config-driven compact model options', () => {
  it('reads default, compact, and fallback models from the current provider', () => {
    withConfig({
      currentProvider: 'openai',
      providers: {
        openai: {
          protocol: 'openai',
          apiKey: 'key',
          defaultModel: 'gpt-4o',
          compactModel: 'gpt-4o-mini',
          fallbackModel: 'gpt-4.1-mini',
          models: [
            { id: 'gpt-4o', contextWindow: 128000 },
            { id: 'gpt-4o-mini', contextWindow: 128000 },
            { id: 'gpt-4.1-mini', contextWindow: 128000 },
          ],
        },
      },
    })

    expect(getConfigDefaultModel()).toBe('gpt-4o')
    expect(getConfigCompactModel()).toBe('gpt-4o-mini')
    expect(getConfigFallbackModel()).toBe('gpt-4.1-mini')
  })
})
