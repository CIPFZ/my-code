import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'path'
import {
  getCustomApiCachePath,
  getOpenAIModelsEndpoint,
} from './fetchModels.js'
import { clearClaudeConfigHomeDirCacheForTesting } from '../envUtils.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  clearClaudeConfigHomeDirCacheForTesting()
})

describe('model discovery endpoint normalization', () => {
  it('does not append a second /v1 when baseUrl already includes it', () => {
    expect(getOpenAIModelsEndpoint('https://cch.fkcodex.com/v1')).toBe(
      'https://cch.fkcodex.com/v1/models',
    )
    expect(getOpenAIModelsEndpoint('https://cch.fkcodex.com')).toBe(
      'https://cch.fkcodex.com/v1/models',
    )
  })

  it('stores custom API cache under the configured data directory', () => {
    process.env.MY_CODE_CONFIG_DIR = join('tmp', 'my-code-data')
    clearClaudeConfigHomeDirCacheForTesting()

    expect(getCustomApiCachePath()).toBe(
      join('tmp', 'my-code-data', 'customApiConfig.json'),
    )
  })
})
