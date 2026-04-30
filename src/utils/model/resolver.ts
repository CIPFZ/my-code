import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { fetchModelsFromEndpoint } from './fetchModels.js'

export const MY_CODE_ENV_PREFIX = 'MY_CODE_'
export const MY_CODE_CONFIG_DIR_ENV = 'MY_CODE_CONFIG_DIR'
export const MY_CODE_PROVIDER_ENV = 'MY_CODE_PROVIDER'
export const MY_CODE_CONFIG_DIR_NAME = '.my-code'
export const MODELS_CONFIG_FILE = 'models.config.json'
export const MODEL_LIST_CACHE_NAMESPACE = 'my-code-provider-models'

export type ProviderProtocol = 'anthropic' | 'openai'

export type ModelMetadata = {
  contextWindow: number
  maxOutputTokens?: number
  displayName?: string
  description?: string
}

export type ModelConfigEntry = ModelMetadata & {
  id: string
}

export type ModelDiscoveryConfig = {
  enabled?: boolean
}

export type ProxyConfig = {
  enable?: boolean
  http?: string
  socks5?: string
}

export type ProviderConfig = {
  protocol?: ProviderProtocol | string
  baseUrl?: string
  apiUrl?: string
  apiKey?: string
  apiKeyEnv?: string
  defaultModel?: string
  models?: ModelConfigEntry[] | Record<string, ModelMetadata> | string[]
  modelDiscovery?: ModelDiscoveryConfig
  proxy?: ProxyConfig
}

export type ModelConfigFile = {
  currentProvider?: string
  default?: string
  proxy?: ProxyConfig
  providers?: Record<string, ProviderConfig>
}

export type ResolverContext = {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  configDir?: string
  config?: ModelConfigFile
}

export type ProviderResolution = {
  providerId: string
  provider: ProviderConfig
  config: ModelConfigFile
  configPath: string
}

export type AuthResolution = {
  apiKey: string
  source: 'provider.apiKey' | 'provider.apiKeyEnv'
  apiKeyEnv?: string
}

export type ModelListResolution = {
  providerId: string
  models: ModelConfigEntry[]
  source: 'config' | 'provider-api'
}

export type ModelMetadataResolution = {
  providerId: string
  model: string
  metadata: ModelMetadata
  source: 'config' | 'provider-api'
}

export type AgentModelResolution = {
  providerId: string
  model: string
  source: 'tool' | 'agent-config' | 'current-provider' | 'frontmatter-alias'
}

export type TeamModelResolution = {
  providerId: string
  model: string
  source:
    | 'tool'
    | 'team-config'
    | 'agent-config'
    | 'current-provider'
    | 'frontmatter-alias'
}

let cachedConfigPath: string | null = null
let cachedConfig: ModelConfigFile | null = null

export function clearRuntimeModelConfigCache(): void {
  cachedConfigPath = null
  cachedConfig = null
}

export function getMyCodeConfigDir(context: ResolverContext = {}): string {
  const env = context.env ?? process.env
  if (context.configDir) return context.configDir
  if (env.MY_CODE_CONFIG_DIR) return env.MY_CODE_CONFIG_DIR
  return join(context.homeDir ?? homedir(), MY_CODE_CONFIG_DIR_NAME)
}

export function getModelsConfigPath(context: ResolverContext = {}): string {
  return join(getMyCodeConfigDir(context), MODELS_CONFIG_FILE)
}

export function loadModelConfig(context: ResolverContext = {}): ModelConfigFile {
  if (context.config) return context.config

  const configPath = getModelsConfigPath(context)
  if (cachedConfig !== null && cachedConfigPath === configPath) {
    return cachedConfig
  }

  if (!existsSync(configPath)) {
    cachedConfigPath = configPath
    cachedConfig = {}
    return cachedConfig
  }

  try {
    cachedConfigPath = configPath
    cachedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as ModelConfigFile
    return cachedConfig
  } catch (error) {
    throw new Error(
      `Failed to load my-code model config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function configuredProviderId(config: ModelConfigFile): string | undefined {
  return config.currentProvider ?? config.default
}

export function resolveCurrentProvider(
  context: ResolverContext = {},
): ProviderResolution {
  const env = context.env ?? process.env
  const config = loadModelConfig(context)
  const providerId = env.MY_CODE_PROVIDER ?? configuredProviderId(config)

  if (!providerId) {
    throw new Error(
      `No current model provider configured. Set MY_CODE_PROVIDER or currentProvider in ${getModelsConfigPath(context)}.`,
    )
  }

  const provider = config.providers?.[providerId]
  if (!provider) {
    throw new Error(
      `Model provider "${providerId}" is not configured in ${getModelsConfigPath(context)}. Add providers.${providerId} or choose another currentProvider/MY_CODE_PROVIDER.`,
    )
  }

  return {
    providerId,
    provider,
    config,
    configPath: getModelsConfigPath(context),
  }
}

export function resolveProviderProtocol(
  providerOrResolution: ProviderConfig | ProviderResolution,
): ProviderProtocol {
  const provider = 'provider' in providerOrResolution
    ? providerOrResolution.provider
    : providerOrResolution

  if (provider.protocol !== 'anthropic' && provider.protocol !== 'openai') {
    throw new Error(
      `Provider protocol is required and must be "anthropic" or "openai". Add protocol to the provider config in ${MODELS_CONFIG_FILE}.`,
    )
  }

  return provider.protocol
}

export function resolveProviderAuth(
  providerOrResolution: ProviderConfig | ProviderResolution,
  context: ResolverContext = {},
): AuthResolution {
  const env = context.env ?? process.env
  const provider = 'provider' in providerOrResolution
    ? providerOrResolution.provider
    : providerOrResolution

  if (provider.apiKey) {
    return { apiKey: provider.apiKey, source: 'provider.apiKey' }
  }

  if (provider.apiKeyEnv) {
    const apiKey = env[provider.apiKeyEnv]
    if (!apiKey) {
      throw new Error(
        `Provider apiKeyEnv "${provider.apiKeyEnv}" is set, but that environment variable is empty. Set it or configure provider.apiKey in ${MODELS_CONFIG_FILE}.`,
      )
    }
    return { apiKey, source: 'provider.apiKeyEnv', apiKeyEnv: provider.apiKeyEnv }
  }

  throw new Error(
    `Provider auth is missing. Configure provider.apiKey or explicit provider.apiKeyEnv in ${MODELS_CONFIG_FILE}.`,
  )
}

function normalizeConfiguredModels(
  models: ProviderConfig['models'],
): ModelConfigEntry[] {
  if (!models) return []

  if (Array.isArray(models)) {
    return models.map(model =>
      typeof model === 'string'
        ? { id: model, contextWindow: 0 }
        : model,
    )
  }

  return Object.entries(models).map(([id, metadata]) => ({ id, ...metadata }))
}

function assertModelMetadata(
  providerId: string,
  model: ModelConfigEntry,
): ModelConfigEntry {
  if (!model.contextWindow || model.contextWindow <= 0) {
    throw new Error(
      `Model metadata is missing for provider "${providerId}" model "${model.id}". Add contextWindow (and optionally maxOutputTokens) in ${MODELS_CONFIG_FILE}.`,
    )
  }
  return model
}

export async function resolveProviderModels(
  providerResolution: ProviderResolution,
  context: ResolverContext = {},
): Promise<ModelListResolution> {
  const configuredModels = normalizeConfiguredModels(providerResolution.provider.models)
  if (configuredModels.length > 0) {
    return {
      providerId: providerResolution.providerId,
      models: configuredModels.map(model =>
        assertModelMetadata(providerResolution.providerId, model),
      ),
      source: 'config',
    }
  }

  if (providerResolution.provider.modelDiscovery?.enabled) {
    const baseUrl = providerResolution.provider.baseUrl ?? providerResolution.provider.apiUrl
    if (!baseUrl) {
      throw new Error(
        `Provider "${providerResolution.providerId}" model discovery requires baseUrl in ${MODELS_CONFIG_FILE}.`,
      )
    }
    const auth = resolveProviderAuth(providerResolution, context)
    const result = await fetchModelsFromEndpoint(baseUrl, auth.apiKey)
    if (result.success && result.models?.length) {
      return {
        providerId: providerResolution.providerId,
        models: result.models.map(model => ({ id: model.id, contextWindow: 0 })),
        source: 'provider-api',
      }
    }
    throw new Error(
      `Provider "${providerResolution.providerId}" did not return models: ${result.error ?? 'unknown error'}. Add provider.models to ${MODELS_CONFIG_FILE}.`,
    )
  }

  throw new Error(
    `Provider "${providerResolution.providerId}" has no models configured. Add provider.models to ${MODELS_CONFIG_FILE} or enable provider.modelDiscovery.`,
  )
}

export async function resolveModelMetadata(
  providerResolution: ProviderResolution,
  model: string,
  context: ResolverContext = {},
): Promise<ModelMetadataResolution> {
  const configuredModel = normalizeConfiguredModels(providerResolution.provider.models)
    .find(entry => entry.id === model)
  if (configuredModel) {
    const metadata = assertModelMetadata(
      providerResolution.providerId,
      configuredModel,
    )
    return {
      providerId: providerResolution.providerId,
      model,
      metadata,
      source: 'config',
    }
  }

  const models = await resolveProviderModels(providerResolution, context)
  const fetchedModel = models.models.find(entry => entry.id === model)
  if (fetchedModel?.contextWindow && fetchedModel.contextWindow > 0) {
    return {
      providerId: providerResolution.providerId,
      model,
      metadata: fetchedModel,
      source: models.source,
    }
  }

  throw new Error(
    `Metadata for provider "${providerResolution.providerId}" model "${model}" is missing. Add contextWindow and maxOutputTokens under provider.models in ${MODELS_CONFIG_FILE}.`,
  )
}
