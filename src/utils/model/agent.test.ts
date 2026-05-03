import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getAgentModel,
  getAgentModelOptions,
  getDefaultSubagentModel,
  getDefaultTeamModel,
} from './agent.js'

const tempDirs: string[] = []
const originalConfigDir = process.env.MY_CODE_CONFIG_DIR
const originalModelConfig = process.env.MY_CODE_MODEL_CONFIG
const originalSubagentModel = process.env.CLAUDE_CODE_SUBAGENT_MODEL

function makeTempDir(): string {
  const dir = join(tmpdir(), `my-code-agent-model-${Date.now()}-${Math.random()}`)
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeModelsConfig(config: unknown): void {
  const dir = makeTempDir()
  const configPath = join(dir, 'models.config.json')
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  process.env.MY_CODE_MODEL_CONFIG = configPath
}

function resetEnv(): void {
  if (originalConfigDir === undefined) delete process.env.MY_CODE_CONFIG_DIR
  else process.env.MY_CODE_CONFIG_DIR = originalConfigDir

  if (originalModelConfig === undefined) delete process.env.MY_CODE_MODEL_CONFIG
  else process.env.MY_CODE_MODEL_CONFIG = originalModelConfig

  if (originalSubagentModel === undefined) delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  else process.env.CLAUDE_CODE_SUBAGENT_MODEL = originalSubagentModel
}

afterEach(() => {
  resetEnv()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const baseConfig = {
  currentProvider: 'custom',
  currentModel: 'main-model',
  aliases: {
    fast: 'fast-model',
    reasoning: 'reasoning-model',
  },
  providers: {
    custom: {
      protocol: 'openai',
      defaultModel: 'main-model',
      models: [
        { id: 'main-model' },
        { id: 'fast-model' },
        { id: 'reasoning-model' },
        { id: 'team-model' },
      ],
    },
  },
  agents: {
    defaultModel: 'fast',
    models: {
      executor: 'reasoning',
      verifier: 'verifier-model',
    },
  },
  teams: {
    defaultModel: 'team-model',
    models: {
      main: 'reasoning',
    },
  },
}

describe('agent model configuration', () => {
  test('resolves tool-specified aliases and arbitrary model strings', () => {
    writeModelsConfig(baseConfig)

    expect(getAgentModel(undefined, 'parent-model', 'fast')).toBe('fast-model')
    expect(getAgentModel(undefined, 'parent-model', 'custom-model-id')).toBe(
      'custom-model-id',
    )
  })

  test('resolves agent frontmatter through agents.models and aliases', () => {
    writeModelsConfig(baseConfig)

    expect(getAgentModel('executor', 'parent-model')).toBe('reasoning-model')
    expect(getAgentModel('verifier', 'parent-model')).toBe('verifier-model')
  })

  test('inherits parent model by default and when requested', () => {
    writeModelsConfig(baseConfig)

    expect(getDefaultSubagentModel(undefined, 'parent-model')).toBe('inherit')
    expect(getAgentModel(undefined, 'parent-model')).toBe('parent-model')
    expect(getAgentModel('inherit', 'parent-model')).toBe('parent-model')
  })

  test('uses agents.defaultModel when no parent model is available', () => {
    writeModelsConfig(baseConfig)

    expect(getDefaultSubagentModel()).toBe('fast')
  })

  test('environment override resolves through configured aliases', () => {
    writeModelsConfig(baseConfig)
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'reasoning'

    expect(getAgentModel(undefined, 'parent-model')).toBe('reasoning-model')
  })

  test('team model inherits parent before falling back to teams config', () => {
    writeModelsConfig(baseConfig)

    expect(getDefaultTeamModel('parent-model')).toBe('parent-model')
    expect(getDefaultTeamModel()).toBe('reasoning-model')
  })

  test('agent model options come from configured agent routes', () => {
    writeModelsConfig(baseConfig)

    expect(getAgentModelOptions().map(option => option.value)).toEqual([
      'inherit',
      'executor',
      'verifier',
    ])
  })
})
