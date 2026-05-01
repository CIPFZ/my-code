import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import {
  resolveCurrentProvider,
  resolveProviderAuth,
  type ProviderProtocol,
} from './resolver.js'

export type APIProvider = string

export function getAPIProvider(): APIProvider {
  try {
    return resolveCurrentProvider().providerId
  } catch {
    return 'not_configured'
  }
}

// 获取当前配置的 API URL（支持多厂商配置）
export function getConfiguredApiUrl(): string | undefined {
  try {
    const provider = resolveCurrentProvider().provider
    return provider.baseUrl ?? provider.apiUrl
  } catch {
    return undefined
  }
}

// 获取当前配置的 API Key（支持多厂商配置）
export function getConfiguredApiKey(): string | undefined {
  try {
    return resolveProviderAuth(resolveCurrentProvider()).apiKey
  } catch {
    return undefined
  }
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if the current configured provider is an Anthropic API URL.
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = getConfiguredApiUrl()
  if (!baseUrl) {
    return false
  }
  try {
    return new URL(baseUrl).host === 'api.anthropic.com'
  } catch {
    return false
  }
}

export type { ProviderProtocol }
