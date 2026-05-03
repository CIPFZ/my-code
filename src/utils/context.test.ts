import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from './context.js'

const tempDirs: string[] = []
const originalConfigDir = process.env.MY_CODE_CONFIG_DIR
const originalModelConfig = process.env.MY_CODE_MODEL_CONFIG

function makeTempDir(): string {
  const dir = join(tmpdir(), `my-code-context-${Date.now()}-${Math.random()}`)
  tempDirs.push(dir)
  return dir
}

function writeModelsConfig(configDir: string): void {
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'models.config.json'),
    JSON.stringify({
      currentProvider: 'custom',
      currentModel: 'custom-model',
      aliases: {
        fast: 'custom-model',
      },
      providers: {
        custom: {
          protocol: 'openai',
          defaultModel: 'custom-model',
          models: [
            {
              id: 'custom-model',
              contextWindow: 345678,
              maxOutputTokens: 45678,
            },
          ],
        },
      },
    }),
  )
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

describe('context provider config integration', () => {
  test('getContextWindowForModel uses configured contextWindow', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG
    writeModelsConfig(configDir)

    expect(getContextWindowForModel('fast')).toBe(345678)
  })

  test('getModelMaxOutputTokens uses configured maxOutputTokens', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG
    writeModelsConfig(configDir)

    expect(getModelMaxOutputTokens('custom-model')).toEqual({
      default: 32000,
      upperLimit: 45678,
    })
  })
})
