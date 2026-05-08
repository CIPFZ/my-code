import { afterEach, describe, expect, it } from 'bun:test'
import { buildInheritedEnvVars } from './spawnUtils.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('buildInheritedEnvVars', () => {
  it('forwards MyCode configuration to tmux teammates', () => {
    process.env.MY_CODE_CONFIG_DIR = '/tmp/my-code config'
    process.env.MY_CODE_DEFAULT_CONFIG_DIR_NAME = '.my-code'
    process.env.MY_CODE_PROVIDER = 'minimax'

    const env = buildInheritedEnvVars()

    expect(env).toContain('MY_CODE_CONFIG_DIR=')
    expect(env).toContain("'/tmp/my-code config'")
    expect(env).toContain('MY_CODE_DEFAULT_CONFIG_DIR_NAME=.my-code')
    expect(env).toContain('MY_CODE_PROVIDER=minimax')
  })
})
