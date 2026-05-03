import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { canSelectConfiguredModel } from './model.js'

const tempDirs: string[] = []
const originalConfigDir = process.env.MY_CODE_CONFIG_DIR
const originalModelConfig = process.env.MY_CODE_MODEL_CONFIG

function makeTempDir(): string {
  const dir = join(tmpdir(), `my-code-model-command-${Date.now()}-${Math.random()}`)
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.MY_CODE_CONFIG_DIR
  else process.env.MY_CODE_CONFIG_DIR = originalConfigDir

  if (originalModelConfig === undefined) delete process.env.MY_CODE_MODEL_CONFIG
  else process.env.MY_CODE_MODEL_CONFIG = originalModelConfig

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('/model selection helpers', () => {
  test('allows configured models and aliases', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'models.config.json'),
      JSON.stringify({
        currentProvider: 'custom',
        aliases: { fast: 'custom-model' },
        providers: {
          custom: {
            protocol: 'openai',
            models: [{ id: 'custom-model' }],
          },
        },
      }),
    )

    expect(canSelectConfiguredModel(null)).toBe(true)
    expect(canSelectConfiguredModel('fast')).toBe(true)
    expect(canSelectConfiguredModel('custom-model')).toBe(true)
    expect(canSelectConfiguredModel('missing-model')).toBe(false)
  })
})
