// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Ensure that any model codenames introduced here are also added to
 * scripts/excluded-strings.txt to avoid leaking them. Wrap any codename string
 * literals with process.env.USER_TYPE === 'ant' for Bun to remove the codenames
 * during dead code elimination
 */
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import {
  getSubscriptionType,
  isClaudeAISubscriber,
  isCodexSubscriber,
  isMaxSubscriber,
  isProSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getAntModelOverrideConfig, resolveAntModel } from './antModels.js'
import {
  has1mContext,
  is1mContextDisabled,
  modelSupports1M,
} from '../context.js'
import { isEnvTruthy } from '../envUtils.js'
import { getModelStrings, resolveOverriddenModel } from './modelStrings.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getAPIProvider } from './providers.js'
import { LIGHTNING_BOLT } from '../../constants/figures.js'
import { isModelAllowed } from './modelAllowlist.js'
import { type ModelAlias, isModelAlias } from './aliases.js'
import { capitalize } from '../stringUtils.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelAlias | null

// =============================================================================
// FILE-BASED CONFIG SUPPORT
// =============================================================================

interface ProxyConfig {
  enable?: boolean  // 是否启用代理，默认 true
  http?: string
  socks5?: string
}

export type ProviderProtocol = 'anthropic' | 'openai'

export interface ModelMetadata {
  contextWindow: number
  maxOutputTokens?: number
}

interface ProviderModelConfig {
  id?: string
  name?: string
  description?: string
  contextWindow?: number
  maxOutputTokens?: number
}

interface ProviderConfig {
  baseUrl?: string
  apiUrl?: string
  apiKey?: string
  apiKeyEnv?: string
  protocol: ProviderProtocol
  defaultModel?: string
  models?: (string | ProviderModelConfig)[]
  proxy?: ProxyConfig  // 可选，覆盖全局 proxy
}

interface ModelConfigFile {
  default?: string  // 默认 provider 名称，如 "anthropic"
  currentProvider?: string
  currentModel?: string
  proxy?: ProxyConfig  // 全局默认 proxy
  providers?: Record<string, ProviderConfig>
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

function requireProviderModels(config: ModelConfigFile): Record<string, ProviderConfig> {
  if (!config.providers || Object.keys(config.providers).length === 0) {
    throw new Error('No providers configured. Add providers to ~/.my-code/models.config.json.')
  }
  return config.providers
}

function normalizeProviderModel(model: string | ProviderModelConfig): ProviderModel {
  if (typeof model === 'string') {
    return { id: model, name: model, description: model }
  }
  const id = model.id ?? model.name
  if (!id) {
    throw new Error('Provider model entry is missing id. Add id to ~/.my-code/models.config.json.')
  }
  return {
    id,
    name: model.name ?? id,
    description: model.description ?? id,
    metadata: {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    },
  }
}

export function resolveCurrentProvider(): ProviderResolution {
  const config = loadModelConfig()
  const providers = requireProviderModels(config)
  const providerId = process.env.MY_CODE_PROVIDER ?? config.currentProvider ?? config.default
  if (!providerId) {
    throw new Error('No current provider configured. Set MY_CODE_PROVIDER or currentProvider in ~/.my-code/models.config.json.')
  }
  const provider = providers[providerId]
  if (!provider) {
    throw new Error(`Provider '${providerId}' is not configured in ~/.my-code/models.config.json.`)
  }
  return { id: providerId, config: provider }
}

export function resolveProviderProtocol(provider = resolveCurrentProvider()): ProviderProtocol {
  const protocol = provider.config.protocol
  if (protocol !== 'anthropic' && protocol !== 'openai') {
    throw new Error(`Provider '${provider.id}' must set protocol to 'anthropic' or 'openai'.`)
  }
  return protocol
}

export function resolveProviderModels(provider = resolveCurrentProvider()): ProviderModel[] {
  const models = provider.config.models?.map(normalizeProviderModel) ?? []
  if (provider.config.defaultModel && !models.some(model => model.id === provider.config.defaultModel)) {
    models.unshift({
      id: provider.config.defaultModel,
      name: provider.config.defaultModel,
      description: provider.config.defaultModel,
    })
  }
  if (models.length === 0) {
    throw new Error(`Provider '${provider.id}' has no models. Add models or defaultModel to ~/.my-code/models.config.json.`)
  }
  return models
}

export function resolveModelMetadata(model: string, provider = resolveCurrentProvider()): ModelMetadata {
  const baseModel = model.replace(/\[1m\]$/i, '')
  const configured = resolveProviderModels(provider).find(m => m.id === model || m.id === baseModel)
  const contextWindow = configured?.metadata?.contextWindow
  if (!contextWindow || contextWindow <= 0) {
    throw new Error(`Missing contextWindow metadata for model '${model}' in provider '${provider.id}'. Add contextWindow to ~/.my-code/models.config.json.`)
  }
  return {
    contextWindow: /\[1m\]$/i.test(model) ? Math.max(contextWindow, 1_000_000) : contextWindow,
    maxOutputTokens: configured.metadata?.maxOutputTokens,
  }
}

function validateProviderModel(model: string, provider = resolveCurrentProvider()): string {
  const baseModel = model.replace(/\[1m\]$/i, '')
  if (resolveProviderModels(provider).some(m => m.id === model || m.id === baseModel)) {
    return model
  }
  throw new Error(`Model '${model}' is not configured for provider '${provider.id}'. Add it to ~/.my-code/models.config.json.`)
}

function resolveConfiguredAlias(model: string): string | undefined {
  return loadModelConfig().aliases?.[model.toLowerCase()]
}

function resolveConfiguredRoute(model: string | undefined, provider: ProviderResolution): string | undefined {
  if (!model || model === 'inherit') return undefined
  const alias = resolveConfiguredAlias(model)
  return validateProviderModel(alias ?? model, provider)
}

export function resolveAgentModel(params: {
  agentName?: string
  toolSpecifiedModel?: string
  agentModel?: string
  currentModel?: string | null
}): string {
  const provider = resolveCurrentProvider()
  const config = loadModelConfig()
  const configured =
    params.toolSpecifiedModel ??
    (params.agentName ? config.agents?.models?.[params.agentName] : undefined) ??
    config.agents?.defaultModel
  const configuredModel = resolveConfiguredRoute(configured, provider)
  if (configuredModel) return configuredModel
  if (params.currentModel) return validateProviderModel(params.currentModel, provider)
  const frontmatterModel = resolveConfiguredRoute(params.agentModel, provider)
  if (frontmatterModel) return frontmatterModel
  throw new Error(`Unable to resolve model for agent '${params.agentName ?? 'unknown'}' with provider '${provider.id}'. Configure an agent model or current provider model in ~/.my-code/models.config.json.`)
}

export function resolveTeamModel(params: {
  teamName?: string
  role?: string
  toolSpecifiedModel?: string
  agentModel?: string
  currentModel?: string | null
}): string {
  const provider = resolveCurrentProvider()
  const config = loadModelConfig()
  const configured =
    params.toolSpecifiedModel ??
    (params.role ? config.teams?.models?.[params.role] : undefined) ??
    (params.role ? config.agents?.models?.[params.role] : undefined) ??
    config.teams?.defaultModel ??
    config.agents?.defaultModel
  const configuredModel = resolveConfiguredRoute(configured, provider)
  if (configuredModel) return configuredModel
  if (params.currentModel) return validateProviderModel(params.currentModel, provider)
  const frontmatterModel = resolveConfiguredRoute(params.agentModel, provider)
  if (frontmatterModel) return frontmatterModel
  throw new Error(`Unable to resolve model for team '${params.teamName ?? 'unknown'}' role '${params.role ?? 'unknown'}' with provider '${provider.id}'. Configure a team model or current provider model in ~/.my-code/models.config.json.`)
}

export function getCurrentProviderId(): string {
  return resolveCurrentProvider().id
}

export function getConfiguredCurrentModel(): string | undefined {
  const config = loadModelConfig()
  const provider = resolveCurrentProvider()
  return config.currentModel ?? provider.config.defaultModel
}

export function setConfiguredCurrentModel(model: string): void {
  validateProviderModel(model)
}

// 获取当前 provider 的 proxy 配置
export function getProxyConfig(): ProxyConfig | undefined {
  const providerConfig = getCurrentProviderConfig()
  // provider 自带的 proxy 优先
  if (providerConfig?.proxy) {
    // 如果 provider 明确设置 enable=false，禁用代理
    if (providerConfig.proxy.enable === false) {
      return { enable: false }
    }
    return providerConfig.proxy
  }
  // 否则用全局 proxy
  const globalProxy = loadModelConfig().proxy
  // 如果全局设置 enable=false，禁用代理
  if (globalProxy?.enable === false) {
    return { enable: false }
  }
  return globalProxy
}

let cachedConfig: ModelConfigFile | null = null
let configLoadError = false

function getConfigPath(): string | undefined {
  const configPaths = [
    process.env.MY_CODE_MODEL_CONFIG,
    process.env.MY_CODE_CONFIG_DIR
      ? `${process.env.MY_CODE_CONFIG_DIR}/models.config.json`
      : undefined,
  ].filter(Boolean) as string[]

  if (configPaths.length > 0) {
    return configPaths[0]
  }

  // Fallback to ~/.my-code/ directory (隔离 claude 配置)
  try {
    const { homedir } = require('os')
    return `${homedir()}/.my-code/models.config.json`
  } catch {
    return undefined
  }
}

function loadModelConfig(): ModelConfigFile {
  if (cachedConfig !== null) {
    return cachedConfig
  }

  const configPath = getConfigPath()
  if (!configPath) {
    cachedConfig = {}
    return cachedConfig
  }

  try {
    const fs = require('fs')
    const content = fs.readFileSync(configPath, 'utf8')
    cachedConfig = JSON.parse(content) as ModelConfigFile
    return cachedConfig
  } catch (error: unknown) {
    const nodeError = error as { code?: string }
    if (nodeError.code === 'ENOENT') {
      cachedConfig = {}
      return cachedConfig
    }
    throw new Error(
      `Failed to load model config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function clearModelConfigCache(): void {
  cachedConfig = null
  configLoadError = false
}

// 获取当前选中的 provider 名称
function getCurrentProviderName(): string {
  return resolveCurrentProvider().id
}

// 获取当前 provider 的配置
function getCurrentProviderConfig(): ProviderConfig | undefined {
  const providerName = getCurrentProviderName()
  const config = loadModelConfig()
  return config.providers?.[providerName]
}

export function getConfigApiUrl(): string | undefined {
  const providerConfig = getCurrentProviderConfig()
  return providerConfig?.baseUrl ?? providerConfig?.apiUrl
}

export function getConfigApiKey(): string | undefined {
  const providerConfig = getCurrentProviderConfig()
  if (providerConfig?.apiKey) return providerConfig.apiKey
  return providerConfig?.apiKeyEnv ? process.env[providerConfig.apiKeyEnv] : undefined
}

export function getConfigProtocol(): string | undefined {
  return resolveProviderProtocol()
}

export function getConfigDefaultModel(): string | undefined {
  const providerConfig = getCurrentProviderConfig()
  return providerConfig?.defaultModel
}

// 多厂商配置获取
export type ProviderName = 'anthropic' | 'openai' | 'custom1' | 'custom2' | 'custom3'

export function getProviderApiUrl(provider: ProviderName): string | undefined {
  const config = loadModelConfig()
  return config.providers?.[provider]?.apiUrl
}

export function getProviderApiKey(provider: ProviderName): string | undefined {
  const config = loadModelConfig()
  return config.providers?.[provider]?.apiKey
}

export function getProviderDefaultModel(provider: ProviderName): string | undefined {
  const config = loadModelConfig()
  return config.providers?.[provider]?.defaultModel
}

export function getAllProviderNames(): string[] {
  const config = loadModelConfig()
  return Object.keys(config.providers ?? {})
}

export function getModelConfigByKey(_modelKey: string): ModelConfig | undefined {
  // Simplified config format no longer supports per-model configs
  // Model configurations are now hardcoded in modelConfigs.ts
  return undefined
}

// =============================================================================
// HARDCODED MODEL CONFIGS (for backward compatibility)
// Re-exported from modelConfigs.ts to avoid circular dependencies
// =============================================================================

export type ModelConfig = Record<APIProvider, ModelName>

// Re-export all configs from the standalone module
export {
  CLAUDE_3_7_SONNET_CONFIG,
  CLAUDE_3_5_V2_SONNET_CONFIG,
  CLAUDE_3_5_HAIKU_CONFIG,
  CLAUDE_HAIKU_4_5_CONFIG,
  CLAUDE_SONNET_4_CONFIG,
  CLAUDE_SONNET_4_5_CONFIG,
  CLAUDE_SONNET_4_6_CONFIG,
  CLAUDE_OPUS_4_CONFIG,
  CLAUDE_OPUS_4_1_CONFIG,
  CLAUDE_OPUS_4_5_CONFIG,
  CLAUDE_OPUS_4_6_CONFIG,
  GPT_5_4_CONFIG,
  GPT_5_3_CODEX_CONFIG,
  GPT_5_4_MINI_CONFIG,
  ALL_MODEL_CONFIGS,
} from './modelConfigs.js'

import {
  ALL_MODEL_CONFIGS,
  type ModelKey,
} from './modelConfigs.js'

export type { ModelKey }

/** Union of all canonical first-party model IDs */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Runtime list of canonical model IDs */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID to internal short key */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>

// =============================================================================
// MODEL SELECTION FUNCTIONS
// =============================================================================

export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || getDefaultHaikuModel()
}

export function isNonCustomOpusModel(model: ModelName): boolean {
  return (
    model === getModelStrings().opus40 ||
    model === getModelStrings().opus41 ||
    model === getModelStrings().opus45 ||
    model === getModelStrings().opus46
  )
}

export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  let specifiedModel: ModelSetting | undefined

  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) {
    specifiedModel = modelOverride
  } else {
    const settings = getSettings_DEPRECATED() || {}
    specifiedModel = process.env.ANTHROPIC_MODEL || settings.model || undefined
  }

  if (specifiedModel && !isModelAllowed(specifiedModel)) {
    return undefined
  }

  return specifiedModel
}

export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getBestModel(): ModelName {
  return getDefaultOpusModel()
}

export function getDefaultOpusModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  }
  if (getAPIProvider() !== 'firstParty') {
    return getModelStrings().opus46
  }
  return getModelStrings().opus46
}

export function getDefaultSonnetModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  }
  if (getAPIProvider() !== 'firstParty') {
    return getModelStrings().sonnet45
  }
  return getModelStrings().sonnet46
}

export function getDefaultHaikuModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  }
  return getModelStrings().haiku45
}

export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  const { permissionMode, mainLoopModel, exceeds200kTokens = false } = params

  if (
    getUserSpecifiedModelSetting() === 'opusplan' &&
    permissionMode === 'plan' &&
    !exceeds200kTokens
  ) {
    return getDefaultOpusModel()
  }

  if (getUserSpecifiedModelSetting() === 'haiku' && permissionMode === 'plan') {
    return getDefaultSonnetModel()
  }

  return mainLoopModel
}

export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  if (isCodexSubscriber()) {
    return getModelStrings().gpt53codex
  }

  if (process.env.USER_TYPE === 'ant') {
    return (
      getAntModelOverrideConfig()?.defaultModel ??
      getDefaultOpusModel() + '[1m]'
    )
  }

  if (isMaxSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  if (isTeamPremiumSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  return getDefaultSonnetModel()
}

export function getDefaultMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
}

// =============================================================================
// CANONICAL NAME MAPPING
// =============================================================================

export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  name = name.toLowerCase()
  if (name.includes('claude-opus-4-6')) {
    return 'claude-opus-4-6'
  }
  if (name.includes('claude-opus-4-5')) {
    return 'claude-opus-4-5'
  }
  if (name.includes('claude-opus-4-1')) {
    return 'claude-opus-4-1'
  }
  if (name.includes('claude-opus-4')) {
    return 'claude-opus-4'
  }
  if (name.includes('claude-sonnet-4-6')) {
    return 'claude-sonnet-4-6'
  }
  if (name.includes('claude-sonnet-4-5')) {
    return 'claude-sonnet-4-5'
  }
  if (name.includes('claude-sonnet-4')) {
    return 'claude-sonnet-4'
  }
  if (name.includes('claude-haiku-4-5')) {
    return 'claude-haiku-4-5'
  }
  if (name.includes('claude-3-7-sonnet')) {
    return 'claude-3-7-sonnet'
  }
  if (name.includes('claude-3-5-sonnet')) {
    return 'claude-3-5-sonnet'
  }
  if (name.includes('claude-3-5-haiku')) {
    return 'claude-3-5-haiku'
  }
  if (name.includes('claude-3-opus')) {
    return 'claude-3-opus'
  }
  if (name.includes('claude-3-sonnet')) {
    return 'claude-3-sonnet'
  }
  if (name.includes('claude-3-haiku')) {
    return 'claude-3-haiku'
  }
  if (name.includes('gpt-5.4-mini')) {
    return 'gpt-5.4-mini'
  }
  if (name.includes('gpt-5.4')) {
    return 'gpt-5.4'
  }
  if (name.includes('gpt-5.3-codex')) {
    return 'gpt-5.3-codex'
  }
  const match = name.match(/(claude-(\d+-\d+-)?\w+)/)
  if (match && match[1]) {
    return match[1]
  }
  return name
}

export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  return firstPartyNameToCanonical(resolveOverriddenModel(fullModelName))
}

// =============================================================================
// DISPLAY NAMES AND FORMATTING
// =============================================================================

export function getClaudeAiUserDefaultModelDescription(
  fastMode = false,
): string {
  if (isCodexSubscriber()) {
    return 'GPT-5.3 Codex · Optimized for code generation and understanding'
  }
  if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
    if (isOpus1mMergeEnabled()) {
      return `Opus 4.6 with 1M context · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
    }
    return `Opus 4.6 · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
  }
  return 'Sonnet 4.6 · Best for everyday tasks'
}

export function renderDefaultModelSetting(
  setting: ModelName | ModelAlias,
): string {
  if (setting === 'opusplan') {
    return 'Opus 4.6 in plan mode, else Sonnet 4.6'
  }
  return renderModelName(parseUserSpecifiedModel(setting))
}

export async function getOpus46PricingSuffix(fastMode: boolean): Promise<string> {
  if (getAPIProvider() !== 'firstParty') return ''
  const { formatModelPricing, getOpus46CostTier } = await import('../modelCost.js')
  const pricing = formatModelPricing(getOpus46CostTier(fastMode))
  const fastModeIndicator = fastMode ? ` (${LIGHTNING_BOLT})` : ''
  return ` ·${fastModeIndicator} ${pricing}`
}

export function isOpus1mMergeEnabled(): boolean {
  if (
    is1mContextDisabled() ||
    isProSubscriber() ||
    getAPIProvider() !== 'firstParty'
  ) {
    return false
  }
  if (isClaudeAISubscriber() && getSubscriptionType() === null) {
    return false
  }
  return true
}

export function renderModelSetting(setting: ModelName | ModelAlias): string {
  if (setting === 'opusplan') {
    return 'Opus Plan'
  }
  if (isModelAlias(setting)) {
    return capitalize(setting)
  }
  return renderModelName(setting)
}

export function getPublicModelDisplayName(model: ModelName): string | null {
  if (model.includes('gpt-') || model.includes('codex')) {
    if (model === 'gpt-5.2-codex') return 'Codex 5.2'
    if (model === 'gpt-5.1-codex') return 'Codex 5.1'
    if (model === 'gpt-5.1-codex-mini') return 'Codex 5.1 Mini'
    if (model === 'gpt-5.1-codex-max') return 'Codex 5.1 Max'
    if (model === 'gpt-5.4') return 'GPT 5.4'
    if (model === 'gpt-5.2') return 'GPT 5.2'
    return model
  }

  switch (model) {
    case getModelStrings().opus46:
      return 'Opus 4.6'
    case getModelStrings().opus46 + '[1m]':
      return 'Opus 4.6 (1M context)'
    case getModelStrings().opus45:
      return 'Opus 4.5'
    case getModelStrings().opus41:
      return 'Opus 4.1'
    case getModelStrings().opus40:
      return 'Opus 4'
    case getModelStrings().sonnet46 + '[1m]':
      return 'Sonnet 4.6 (1M context)'
    case getModelStrings().sonnet46:
      return 'Sonnet 4.6'
    case getModelStrings().sonnet45 + '[1m]':
      return 'Sonnet 4.5 (1M context)'
    case getModelStrings().sonnet45:
      return 'Sonnet 4.5'
    case getModelStrings().sonnet40:
      return 'Sonnet 4'
    case getModelStrings().sonnet40 + '[1m]':
      return 'Sonnet 4 (1M context)'
    case getModelStrings().sonnet37:
      return 'Sonnet 3.7'
    case getModelStrings().sonnet35:
      return 'Sonnet 3.5'
    case getModelStrings().haiku45:
      return 'Haiku 4.5'
    case getModelStrings().haiku35:
      return 'Haiku 3.5'
    case getModelStrings().gpt54:
      return 'GPT-5.4'
    case getModelStrings().gpt53codex:
      return 'GPT-5.3 Codex'
    case getModelStrings().gpt54mini:
      return 'GPT-5.4 Mini'
    default:
      return null
  }
}

function maskModelCodename(baseName: string): string {
  const [codename = '', ...rest] = baseName.split('-')
  const masked =
    codename.slice(0, 3) + '*'.repeat(Math.max(0, codename.length - 3))
  return [masked, ...rest].join('-')
}

export function renderModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return publicName
  }
  if (process.env.USER_TYPE === 'ant') {
    const resolved = parseUserSpecifiedModel(model)
    const antModel = resolveAntModel(model)
    if (antModel) {
      const baseName = antModel.model.replace(/\[1m\]$/i, '')
      const masked = maskModelCodename(baseName)
      const suffix = has1mContext(resolved) ? '[1m]' : ''
      return masked + suffix
    }
    if (resolved !== model) {
      return `${model} (${resolved})`
    }
    return resolved
  }
  return model
}

export function getPublicModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    if (model.includes('gpt-') || model.includes('codex')) {
      return publicName
    }
    return `Claude ${publicName}`
  }
  return `Claude (${model})`
}

export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias,
): ModelName {
  const modelInputTrimmed = modelInput.trim()
  const normalizedModel = modelInputTrimmed.toLowerCase()

  const has1mTag = has1mContext(normalizedModel)
  const modelString = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel

  if (isModelAlias(modelString)) {
    switch (modelString) {
      case 'opusplan':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '')
      case 'sonnet':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '')
      case 'haiku':
        return getDefaultHaikuModel() + (has1mTag ? '[1m]' : '')
      case 'opus':
        return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
      case 'best':
        return getBestModel()
      default:
    }
  }

  if (
    getAPIProvider() === 'firstParty' &&
    isLegacyOpusFirstParty(modelString) &&
    isLegacyModelRemapEnabled()
  ) {
    return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
  }

  if (process.env.USER_TYPE === 'ant') {
    const has1mAntTag = has1mContext(normalizedModel)
    const baseAntModel = normalizedModel.replace(/\[1m]$/i, '').trim()

    const antModel = resolveAntModel(baseAntModel)
    if (antModel) {
      const suffix = has1mAntTag ? '[1m]' : ''
      return antModel.model + suffix
    }
  }

  if (has1mTag) {
    return modelInputTrimmed.replace(/\[1m\]$/i, '').trim() + '[1m]'
  }
  return modelInputTrimmed
}

export function resolveSkillModelOverride(
  skillModel: string,
  currentModel: string,
): string {
  if (has1mContext(skillModel) || !has1mContext(currentModel)) {
    return skillModel
  }
  if (modelSupports1M(parseUserSpecifiedModel(skillModel))) {
    return skillModel + '[1m]'
  }
  return skillModel
}

const LEGACY_OPUS_FIRSTPARTY = [
  'claude-opus-4-20250514',
  'claude-opus-4-1-20250805',
  'claude-opus-4-0',
  'claude-opus-4-1',
]

function isLegacyOpusFirstParty(model: string): boolean {
  return LEGACY_OPUS_FIRSTPARTY.includes(model)
}

export function isLegacyModelRemapEnabled(): boolean {
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP)
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    if (process.env.USER_TYPE === 'ant') {
      return `Default for Ants (${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})`
    } else if (isClaudeAISubscriber()) {
      return `Default (${getClaudeAiUserDefaultModelDescription()})`
    }
    return `Default (${getDefaultMainLoopModel()})`
  }
  const resolvedModel = parseUserSpecifiedModel(model)
  return model === resolvedModel ? resolvedModel : `${model} (${resolvedModel})`
}

export function getMarketingNameForModel(modelId: string): string | undefined {
  if (getAPIProvider() === 'foundry') {
    return undefined
  }

  const has1m = modelId.toLowerCase().includes('[1m]')
  const canonical = getCanonicalName(modelId)

  if (canonical.includes('claude-opus-4-6')) {
    return has1m ? 'Opus 4.6 (with 1M context)' : 'Opus 4.6'
  }
  if (canonical.includes('claude-opus-4-5')) {
    return 'Opus 4.5'
  }
  if (canonical.includes('claude-opus-4-1')) {
    return 'Opus 4.1'
  }
  if (canonical.includes('claude-opus-4')) {
    return 'Opus 4'
  }
  if (canonical.includes('claude-sonnet-4-6')) {
    return has1m ? 'Sonnet 4.6 (with 1M context)' : 'Sonnet 4.6'
  }
  if (canonical.includes('claude-sonnet-4-5')) {
    return has1m ? 'Sonnet 4.5 (with 1M context)' : 'Sonnet 4.5'
  }
  if (canonical.includes('claude-sonnet-4')) {
    return has1m ? 'Sonnet 4 (with 1M context)' : 'Sonnet 4'
  }
  if (canonical.includes('claude-3-7-sonnet')) {
    return 'Claude 3.7 Sonnet'
  }
  if (canonical.includes('claude-3-5-sonnet')) {
    return 'Claude 3.5 Sonnet'
  }
  if (canonical.includes('claude-haiku-4-5')) {
    return 'Haiku 4.5'
  }
  if (canonical.includes('claude-3-5-haiku')) {
    return 'Claude 3.5 Haiku'
  }
  if (canonical.includes('gpt-5.4-mini')) {
    return 'GPT-5.4 Mini'
  }
  if (canonical.includes('gpt-5.4')) {
    return 'GPT-5.4'
  }
  if (canonical.includes('gpt-5.3-codex')) {
    return 'GPT-5.3 Codex'
  }

  return undefined
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}
