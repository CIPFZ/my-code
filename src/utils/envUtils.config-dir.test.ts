import { afterEach, describe, expect, it } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import {
  clearClaudeConfigHomeDirCacheForTesting,
  getClaudeConfigHomeDir,
} from './envUtils.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  clearClaudeConfigHomeDirCacheForTesting()
})

describe('config home directory resolution', () => {
  it('defaults to ~/.claude for upstream-compatible builds', () => {
    delete process.env.MY_CODE_CONFIG_DIR
    delete process.env.MY_CODE_DEFAULT_CONFIG_DIR_NAME

    expect(getClaudeConfigHomeDir()).toBe(join(homedir(), '.claude'))
  })

  it('uses compile-time default directory name when defined', () => {
    delete process.env.MY_CODE_CONFIG_DIR
    process.env.MY_CODE_DEFAULT_CONFIG_DIR_NAME = '.my-code'

    expect(getClaudeConfigHomeDir()).toBe(join(homedir(), '.my-code'))
  })

  it('uses MY_CODE_CONFIG_DIR when explicitly configured at runtime', () => {
    process.env.MY_CODE_CONFIG_DIR = join(homedir(), '.custom-my-code')

    expect(getClaudeConfigHomeDir()).toBe(join(homedir(), '.custom-my-code'))
  })
})
