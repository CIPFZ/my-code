import { afterEach, describe, expect, test } from 'bun:test'
import { buildInheritedEnvVars } from './spawnUtils.js'

const originalEnv = {
  MY_CODE_CONFIG_DIR: process.env.MY_CODE_CONFIG_DIR,
  MY_CODE_MODEL_CONFIG: process.env.MY_CODE_MODEL_CONFIG,
  MY_CODE_PROVIDER: process.env.MY_CODE_PROVIDER,
}

function resetEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  resetEnv()
})

describe('spawnUtils', () => {
  test('propagates my-code provider configuration environment variables', () => {
    process.env.MY_CODE_CONFIG_DIR = '/tmp/my code config'
    process.env.MY_CODE_MODEL_CONFIG = '/tmp/models.config.json'
    process.env.MY_CODE_PROVIDER = 'custom-provider'

    const env = buildInheritedEnvVars()

    expect(env).toContain('MY_CODE_CONFIG_DIR=')
    expect(env).toContain('/tmp/my code config')
    expect(env).toContain('MY_CODE_MODEL_CONFIG=/tmp/models.config.json')
    expect(env).toContain('MY_CODE_PROVIDER=custom-provider')
  })
})
