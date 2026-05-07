import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _migrateLegacyGlobalConfigIfNeededForTesting,
} from './config.js'
import { clearGlobalClaudeFileCacheForTesting } from './env.js'
import {
  clearClaudeConfigHomeDirCacheForTesting,
} from './envUtils.js'

const originalEnv = { ...process.env }
const tempDirs: string[] = []

afterEach(() => {
  process.env = { ...originalEnv }
  clearClaudeConfigHomeDirCacheForTesting()
  clearGlobalClaudeFileCacheForTesting()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'my-code-config-migration-'))
  tempDirs.push(dir)
  return dir
}

describe('legacy global config migration', () => {
  it('does not read ~/.claude.json unless migration is explicitly enabled', () => {
    const homeDir = tempHome()
    const configDir = join(homeDir, '.my-code')
    mkdirSync(configDir, { recursive: true })
    process.env.HOME = homeDir
    process.env.USERPROFILE = homeDir
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MIGRATE_LEGACY_CLAUDE_CONFIG
    process.env.MY_CODE_LEGACY_CLAUDE_CONFIG_FILE = join(homeDir, '.claude.json')
    clearClaudeConfigHomeDirCacheForTesting()
    clearGlobalClaudeFileCacheForTesting()
    writeFileSync(join(homeDir, '.claude.json'), '{"theme":"dark"}')

    _migrateLegacyGlobalConfigIfNeededForTesting()

    expect(existsSync(join(configDir, '.config.json'))).toBe(false)
  })

  it('can migrate ~/.claude.json when explicitly enabled', () => {
    const homeDir = tempHome()
    const configDir = join(homeDir, '.my-code')
    mkdirSync(configDir, { recursive: true })
    process.env.HOME = homeDir
    process.env.USERPROFILE = homeDir
    process.env.MY_CODE_CONFIG_DIR = configDir
    process.env.MY_CODE_MIGRATE_LEGACY_CLAUDE_CONFIG = '1'
    process.env.MY_CODE_LEGACY_CLAUDE_CONFIG_FILE = join(homeDir, '.claude.json')
    clearClaudeConfigHomeDirCacheForTesting()
    clearGlobalClaudeFileCacheForTesting()
    writeFileSync(join(homeDir, '.claude.json'), '{"theme":"dark"}')

    _migrateLegacyGlobalConfigIfNeededForTesting()

    expect(existsSync(join(configDir, '.config.json'))).toBe(true)
  })
})
