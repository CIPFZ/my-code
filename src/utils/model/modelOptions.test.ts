import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getModelOptions } from './modelOptions.js'

const tempDirs: string[] = []
const originalConfigDir = process.env.MY_CODE_CONFIG_DIR
const originalModelConfig = process.env.MY_CODE_MODEL_CONFIG

function makeTempDir(): string {
  const dir = join(tmpdir(), `my-code-model-options-${Date.now()}-${Math.random()}`)
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

describe('modelOptions provider config integration', () => {
  test('generates options from current provider models', () => {
    const configDir = makeTempDir()
    process.env.MY_CODE_CONFIG_DIR = configDir
    delete process.env.MY_CODE_MODEL_CONFIG
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'models.config.json'),
      JSON.stringify({
        currentProvider: 'custom',
        currentModel: 'custom-model',
        providers: {
          custom: {
            protocol: 'openai',
            defaultModel: 'custom-model',
            models: [
              {
                id: 'custom-model',
                name: 'Custom Model',
                description: 'Configured custom model',
              },
            ],
          },
        },
      }),
    )

    expect(getModelOptions()).toEqual([
      expect.objectContaining({ value: null }),
      expect.objectContaining({
        value: 'custom-model',
        label: 'Custom Model',
        description: 'Configured custom model',
      }),
    ])
  })
})
