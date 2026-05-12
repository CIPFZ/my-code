import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ModelName } from './model.js'
export { ALL_MODEL_CONFIGS } from './modelConfigs.js'
import type { APIProvider } from './providers.js'
import {
  clearRuntimeModelConfigCache,
  getModelsConfigPath,
  loadDiscoveredProviderModelsCache,
  loadModelConfig,
  resolveProviderModels as resolveProviderModelsAsync,
  resolveCurrentProvider as resolveCurrentProviderAsync,
  resolveProviderAuth,
  resolveProviderProtocol as resolveProviderProtocolAsync,
  saveDiscoveredProviderModels,
  type ModelConfigFile,
  type ModelMetadata,
  type ProviderConfig,
  type ProviderProtocol,
  type ProviderResolution as RuntimeProviderResolution,
} from './resolver.js'

export { getDiscoveredProviderModelsCachePath } from './resolver.js'

export type ModelConfig = Record<APIProvider, ModelName>

export type ProviderResolution = {
  id: string
  config: ProviderConfig
}

export type ProviderModel = {
  id: string
  name?: string
  description?: string
  metadata?: Partial<ModelMetadata>
}

type ProviderScopedConfig = ModelConfigFile & {
  aliases?: Record<string, string>
  agents?: {
    defaultModel?: string
    models?: Record<string, string>
  }
  teams?: {
    defaultModel?: string
    models?: Record<string, string>
  }
}

function normalizeProviderResolution(
  resolution: RuntimeProviderResolution,
): ProviderResolution {
  return {
    id: resolution.providerId,
    config: resolution.provider,
  }
}

function getScopedConfig(): ProviderScopedConfig {
  return loadModelConfig() as ProviderScopedConfig
}

function getRuntimeProviderResolution(): RuntimeProviderResolution {
  return resolveCurrentProviderAsync()
}

function normalizeConfiguredModels(
  provider: ProviderConfig,
): ProviderModel[] {
  const models = provider.models
  if (!models) return []

  if (Array.isArray(models)) {
    return models.map(model =>
      typeof model === 'string'
        ? { id: model, name: model, description: model }
        : {
            id: model.id,
            name: model.displayName ?? model.id,
            description: model.description ?? model.id,
            metadata: {
              contextWindow: model.contextWindow,
              maxOutputTokens: model.maxOutputTokens,
            },
          },
    )
  }

  return Object.entries(models).map(([id, metadata]) => ({
    id,
    name: metadata.displayName ?? id,
    description: metadata.description ?? id,
    metadata: {
      contextWindow: metadata.contextWindow,
      maxOutputTokens: metadata.maxOutputTokens,
    },
  }))
}

function getProviderModelDefaults(
  provider: ProviderConfig,
): Partial<ModelMetadata> | undefined {
  return provider.modelDefaults
}

function normalizeDiscoveredModels(
  providerId: string,
  provider: ProviderConfig,
): ProviderModel[] {
  const cache = loadDiscoveredProviderModelsCache()
  const discovered = cache.providers?.[providerId]?.models
  if (!Array.isArray(discovered)) return []
  const defaults = getProviderModelDefaults(provider)

  return discovered
    .filter(model => typeof model.id === 'string' && model.id.length > 0)
    .map(model => ({
      id: model.id,
      name: model.name ?? model.displayName ?? model.id,
      description: model.description ?? model.id,
      metadata: {
        contextWindow: model.contextWindow ?? defaults?.contextWindow,
        maxOutputTokens: model.maxOutputTokens ?? defaults?.maxOutputTokens,
      },
    }))
}

function normalizeFallbackModels(provider: ProviderConfig): ProviderModel[] {
  const ids = [
    provider.defaultModel,
    provider.compactModel,
    provider.fallbackModel,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0)

  return [...new Set(ids)].map(id => ({
    id,
    name: id,
    description: id,
  }))
}

function normalizeProviderModels(
  providerId: string,
  provider: ProviderConfig,
): ProviderModel[] {
  const configuredModels = normalizeConfiguredModels(provider)
  if (configuredModels.length > 0) return configuredModels

  if (provider.modelDiscovery?.enabled) {
    const discoveredModels = normalizeDiscoveredModels(providerId, provider)
    if (discoveredModels.length > 0) return discoveredModels

    const fallbackModels = normalizeFallbackModels(provider)
    if (fallbackModels.length > 0) return fallbackModels
  }

  return []
}

function findProviderModel(
  model: string,
  provider = getRuntimeProviderResolution(),
): ProviderModel | undefined {
  const baseModel = model.replace(/\[1m\]$/i, '')
  return normalizeProviderModels(provider.providerId, provider.provider).find(
    entry => entry.id === model || entry.id === baseModel,
  )
}

function validateProviderModel(
  model: string,
  provider = getRuntimeProviderResolution(),
): string {
  if (findProviderModel(model, provider)) {
    return model
  }
  throw new Error(
    `Model '${model}' is not configured for provider '${provider.providerId}'. Add it to models.config.json.`,
  )
}

function resolveConfiguredAlias(model: string): string | undefined {
  return getScopedConfig().aliases?.[model.toLowerCase()]
}

function resolveConfiguredRoute(
  model: string | undefined,
  provider = getRuntimeProviderResolution(),
): string | undefined {
  if (!model || model === 'inherit') return undefined
  const alias = resolveConfiguredAlias(model)
  return validateProviderModel(alias ?? model, provider)
}

function resolveOptionalConfiguredRoute(
  model: string | undefined,
  provider = getRuntimeProviderResolution(),
): string | undefined {
  if (!model || model === 'inherit') return undefined
  const alias = resolveConfiguredAlias(model)
  const resolvedModel = alias ?? model
  return findProviderModel(resolvedModel, provider) ? resolvedModel : undefined
}

export function clearModelConfigCache(): void {
  clearRuntimeModelConfigCache()
}

export function resolveCurrentProvider(): ProviderResolution {
  return normalizeProviderResolution(getRuntimeProviderResolution())
}

export function resolveProviderProtocol(
  provider = resolveCurrentProvider(),
): ProviderProtocol {
  return resolveProviderProtocolAsync({
    providerId: provider.id,
    provider: provider.config,
    config: getScopedConfig(),
    configPath: '',
  })
}

export function resolveProviderModels(
  provider = resolveCurrentProvider(),
): ProviderModel[] {
  const runtimeProvider: RuntimeProviderResolution = {
    providerId: provider.id,
    provider: provider.config,
    config: getScopedConfig(),
    configPath: '',
  }

  const models = normalizeProviderModels(
    runtimeProvider.providerId,
    runtimeProvider.provider,
  )
  if (models.length > 0) {
    return models
  }

  throw new Error(
    `Provider '${provider.id}' has no models configured. Add provider.models to models.config.json.`,
  )
}

export async function refreshProviderModelsCache(
  provider = resolveCurrentProvider(),
): Promise<ProviderModel[]> {
  const runtimeProvider: RuntimeProviderResolution = {
    providerId: provider.id,
    provider: provider.config,
    config: getScopedConfig(),
    configPath: '',
  }

  const resolution = await resolveProviderModelsAsync(runtimeProvider)
  if (resolution.source === 'provider-api') {
    saveDiscoveredProviderModels(
      runtimeProvider,
      resolution.models.map(model => ({
        id: model.id,
        name: model.displayName ?? model.id,
        description: model.description ?? model.id,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
      })),
    )
  }
  return resolution.models.map(model => ({
    id: model.id,
    name: model.displayName ?? model.id,
    description: model.description ?? model.id,
    metadata: {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    },
  }))
}

export function resolveModelMetadata(
  model: string,
  provider = resolveCurrentProvider(),
): ModelMetadata {
  const found = findProviderModel(model, {
    providerId: provider.id,
    provider: provider.config,
    config: getScopedConfig(),
    configPath: '',
  })

  const defaultContextWindow =
    provider.config.modelDefaults?.contextWindow ??
    found?.metadata?.contextWindow

  if (!defaultContextWindow) {
    throw new Error(
      `Missing contextWindow metadata for model '${model}' in provider '${provider.id}'. Add contextWindow to models.config.json.`,
    )
  }

  return {
    contextWindow: /\[1m\]$/i.test(model)
      ? Math.max(defaultContextWindow, 1_000_000)
      : defaultContextWindow,
    maxOutputTokens:
      found?.metadata?.maxOutputTokens ??
      provider.config.modelDefaults?.maxOutputTokens,
    displayName: found.name,
    description: found.description,
  }
}

export function resolveAgentModel(params: {
  agentName?: string
  toolSpecifiedModel?: string
  agentModel?: string
  currentModel?: string | null
}): string {
  const provider = getRuntimeProviderResolution()
  const config = getScopedConfig()
  const configuredModel = params.toolSpecifiedModel
    ? resolveConfiguredRoute(params.toolSpecifiedModel, provider)
    : resolveOptionalConfiguredRoute(
        (params.agentName ? config.agents?.models?.[params.agentName] : undefined) ??
          config.agents?.defaultModel,
        provider,
      )
  if (configuredModel) return configuredModel
  if (params.currentModel) return validateProviderModel(params.currentModel, provider)

  const frontmatterModel = resolveConfiguredRoute(params.agentModel, provider)
  if (frontmatterModel) return frontmatterModel

  throw new Error(
    `Unable to resolve model for agent '${params.agentName ?? 'unknown'}' with provider '${provider.providerId}'.`,
  )
}

export function resolveTeamModel(params: {
  teamName?: string
  role?: string
  toolSpecifiedModel?: string
  agentModel?: string
  currentModel?: string | null
}): string {
  const provider = getRuntimeProviderResolution()
  const config = getScopedConfig()
  const configuredModel = params.toolSpecifiedModel
    ? resolveConfiguredRoute(params.toolSpecifiedModel, provider)
    : resolveOptionalConfiguredRoute(
        (params.role ? config.teams?.models?.[params.role] : undefined) ??
          (params.role ? config.agents?.models?.[params.role] : undefined) ??
          config.teams?.defaultModel ??
          config.agents?.defaultModel,
        provider,
      )
  if (configuredModel) return configuredModel
  if (params.currentModel) return validateProviderModel(params.currentModel, provider)

  const frontmatterModel = resolveConfiguredRoute(params.agentModel, provider)
  if (frontmatterModel) return frontmatterModel

  throw new Error(
    `Unable to resolve model for team '${params.teamName ?? 'unknown'}' role '${params.role ?? 'unknown'}' with provider '${provider.providerId}'.`,
  )
}

export function getCurrentProviderId(): string {
  return getRuntimeProviderResolution().providerId
}

export function getConfiguredCurrentModel(): string | undefined {
  const config = getScopedConfig()
  const provider = getRuntimeProviderResolution()
  return config.currentModel ?? provider.provider.defaultModel
}

export function resolveConfiguredModelForCurrentProvider(
  model: string | undefined | null,
): string | undefined {
  if (!model) return undefined
  const provider = getRuntimeProviderResolution()
  const alias = resolveConfiguredAlias(model)
  const resolvedModel = alias ?? model
  return findProviderModel(resolvedModel, provider) ? model : undefined
}

export function setConfiguredCurrentModel(model: string): void {
  validateProviderModel(model)
  const config = getScopedConfig()
  const configPath = getModelsConfigPath()
  mkdirSync(dirname(configPath), { recursive: true })
  const updated: ProviderScopedConfig = {
    ...config,
    currentModel: model,
  }
  writeFileSync(configPath, JSON.stringify(updated, null, 2))
  clearRuntimeModelConfigCache()
}

export function getProxyConfig() {
  const providerConfig = getRuntimeProviderResolution().provider
  if (providerConfig.proxy) {
    if (providerConfig.proxy.enable === false) {
      return { enable: false }
    }
    return providerConfig.proxy
  }

  const globalProxy = getScopedConfig().proxy
  if (globalProxy?.enable === false) {
    return { enable: false }
  }
  return globalProxy
}

export function getConfigApiUrl(): string | undefined {
  const provider = getRuntimeProviderResolution().provider
  return provider.baseUrl ?? provider.apiUrl
}

export function getConfigApiKey(): string | undefined {
  try {
    return resolveProviderAuth(getRuntimeProviderResolution()).apiKey
  } catch {
    return undefined
  }
}

export function getConfigProtocol(): string | undefined {
  return resolveProviderProtocolAsync(getRuntimeProviderResolution())
}

export function getConfigDefaultModel(): string | undefined {
  return getRuntimeProviderResolution().provider.defaultModel
}

export function getConfigCompactModel(): string | undefined {
  return getRuntimeProviderResolution().provider.compactModel
}

export function getConfigFallbackModel(): string | undefined {
  return getRuntimeProviderResolution().provider.fallbackModel
}
