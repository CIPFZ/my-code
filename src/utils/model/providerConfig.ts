import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import {
  ensureMyCodeConfigHomeDir,
  getClaudeConfigHomeDir,
  MY_CODE_MODELS_CONFIG_FILE,
} from '../envUtils.js'

const MODELS_CONFIG_FILE = MY_CODE_MODELS_CONFIG_FILE

const proxyConfigSchema = z
  .object({
    enable: z.boolean().optional(),
    socks5: z.string().optional(),
    http: z.string().optional(),
    https: z.string().optional(),
  })
  .passthrough()

const configuredModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    contextWindow: z.number().positive().optional(),
    maxOutputTokens: z.number().positive().optional(),
    supportsTools: z.boolean().optional(),
    supportsStreaming: z.boolean().optional(),
    supportsThinking: z.boolean().optional(),
  })
  .passthrough()

const providerConfigSchema = z
  .object({
    name: z.string().optional(),
    protocol: z.enum(['openai', 'anthropic']),
    apiUrl: z.string().optional(),
    baseURL: z.string().optional(),
    apiKey: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    defaultModel: z.string().optional(),
    models: z.array(configuredModelSchema).default([]),
    proxy: proxyConfigSchema.optional(),
  })
  .passthrough()

const modelRoutingConfigSchema = z
  .object({
    defaultModel: z.string().optional(),
    models: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()

export const modelsConfigSchema = z
  .object({
    currentProvider: z.string().optional(),
    currentModel: z.string().optional(),
    configVersion: z.number().optional(),
    proxy: proxyConfigSchema.optional(),
    aliases: z.record(z.string(), z.string()).default({}),
    providers: z.record(z.string(), providerConfigSchema).default({}),
    agents: modelRoutingConfigSchema.optional(),
    teams: modelRoutingConfigSchema.optional(),
  })
  .passthrough()

export type ModelsConfig = z.infer<typeof modelsConfigSchema>
export type ConfiguredProvider = z.infer<typeof providerConfigSchema>
export type ConfiguredModel = z.infer<typeof configuredModelSchema>
export type ProviderProxyConfig = z.infer<typeof proxyConfigSchema>

function getDefaultConfigDir(): string {
  return getClaudeConfigHomeDir()
}

function createDefaultModelsConfig(): ModelsConfig {
  if (process.env.MY_CODE_DEFAULT_MODELS_CONFIG_JSON) {
    return modelsConfigSchema.parse(
      JSON.parse(process.env.MY_CODE_DEFAULT_MODELS_CONFIG_JSON),
    )
  }

  return {
    configVersion: 1,
    currentProvider: 'example',
    currentModel: 'example-model',
    proxy: {
      enable: false,
    },
    aliases: {
      opus: 'example-model',
      sonnet: 'example-model',
      haiku: 'example-model',
      fast: 'example-model',
      reasoning: 'example-model',
    },
    providers: {
      example: {
        name: 'Example provider',
        protocol: 'openai',
        apiUrl: 'https://api.example.com/v1',
        apiKey: '',
        defaultModel: 'example-model',
        headers: {},
        models: [
          {
            id: 'example-model',
            name: 'example-model',
            description: 'Replace this template with your provider model.',
            contextWindow: 200000,
            maxOutputTokens: 8192,
            supportsTools: true,
            supportsStreaming: true,
            supportsThinking: false,
          },
        ],
        proxy: {
          enable: false,
        },
      },
    },
    agents: {
      defaultModel: 'example-model',
      models: {},
    },
    teams: {
      defaultModel: 'example-model',
      models: {},
    },
  }
}

export function getModelsConfigPath(): string {
  return process.env.MY_CODE_MODEL_CONFIG ?? join(getDefaultConfigDir(), MODELS_CONFIG_FILE)
}

export function ensureModelsConfig(): string {
  ensureMyCodeConfigHomeDir()
  const configPath = getModelsConfigPath()
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(createDefaultModelsConfig(), null, 2)}\n`,
      'utf8',
    )
  }
  return configPath
}

export function loadModelsConfig(): ModelsConfig {
  const configPath = ensureModelsConfig()
  const rawConfig = readFileSync(configPath, 'utf8')
  const parsedConfig = JSON.parse(rawConfig) as unknown
  return modelsConfigSchema.parse(parsedConfig)
}

function getSelectedProviderName(config: ModelsConfig): string | undefined {
  return process.env.MY_CODE_PROVIDER ?? config.currentProvider
}

export function getCurrentProviderConfig(
  config: ModelsConfig = loadModelsConfig(),
): ConfiguredProvider | undefined {
  const providerName = getSelectedProviderName(config)
  if (!providerName) return undefined
  return config.providers[providerName]
}

export function resolveConfiguredModelAlias(
  model: string | undefined,
  config: ModelsConfig = loadModelsConfig(),
): string | undefined {
  if (!model) return undefined

  let resolvedModel = model
  const seenModels = new Set<string>()
  while (config.aliases[resolvedModel] && !seenModels.has(resolvedModel)) {
    seenModels.add(resolvedModel)
    resolvedModel = config.aliases[resolvedModel]
  }
  return resolvedModel
}

export function getConfiguredModels(
  config: ModelsConfig = loadModelsConfig(),
): ConfiguredModel[] {
  return getCurrentProviderConfig(config)?.models ?? []
}

export function getCurrentModelConfig(
  config: ModelsConfig = loadModelsConfig(),
  model?: string,
): ConfiguredModel | undefined {
  const provider = getCurrentProviderConfig(config)
  if (!provider) return undefined

  const selectedModel = resolveConfiguredModelAlias(
    model ?? config.currentModel ?? provider.defaultModel ?? provider.models[0]?.id,
    config,
  )
  if (!selectedModel) return undefined

  return provider.models.find(modelConfig => modelConfig.id === selectedModel)
}

export function isConfiguredModel(
  model: string,
  config: ModelsConfig = loadModelsConfig(),
): boolean {
  const resolvedModel = resolveConfiguredModelAlias(model, config)
  return getConfiguredModels(config).some(modelConfig => modelConfig.id === resolvedModel)
}

export function updateCurrentModelConfig(model: string | null): void {
  const configPath = ensureModelsConfig()
  const config = loadModelsConfig()
  config.currentModel = model ?? getCurrentProviderConfig(config)?.defaultModel
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export function getProviderProxyConfig(
  config: ModelsConfig = loadModelsConfig(),
): ProviderProxyConfig | undefined {
  const providerProxy = getCurrentProviderConfig(config)?.proxy
  const mergedProxy = {
    ...config.proxy,
    ...providerProxy,
  }

  if (mergedProxy.enable !== true) return undefined
  return mergedProxy
}
