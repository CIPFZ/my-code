import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'
import { getConfigApiUrl, getConfigApiKey, getConfigDefaultModel } from './configs.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'openai' | 'custom1' | 'custom2' | 'custom3'

export function getAPIProvider(): APIProvider {
  // 先检查 MY_CODE_PROVIDER 环境变量（支持自定义厂商）
  const myCodeProvider = process.env.MY_CODE_PROVIDER
  if (myCodeProvider && ['custom1', 'custom2', 'custom3'].includes(myCodeProvider)) {
    return myCodeProvider as 'custom1' | 'custom2' | 'custom3'
  }

  // 原有的第三方提供商
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
          ? 'openai'
          : 'firstParty'
}

// 获取当前配置的 API URL（支持多厂商配置）
export function getConfiguredApiUrl(): string | undefined {
  const provider = getAPIProvider()
  if (['custom1', 'custom2', 'custom3'].includes(provider)) {
    // 从 configs.ts 的多厂商配置获取
    const { getProviderApiUrl } = require('./configs.js')
    return getProviderApiUrl(provider as 'custom1' | 'custom2' | 'custom3')
  }
  // 内置厂商使用环境变量
  return process.env.ANTHROPIC_BASE_URL ?? getConfigApiUrl()
}

// 获取当前配置的 API Key（支持多厂商配置）
export function getConfiguredApiKey(): string | undefined {
  const provider = getAPIProvider()
  if (['custom1', 'custom2', 'custom3'].includes(provider)) {
    const { getProviderApiKey } = require('./configs.js')
    return getProviderApiKey(provider as 'custom1' | 'custom2' | 'custom3')
  }
  return process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? getConfigApiKey()
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
