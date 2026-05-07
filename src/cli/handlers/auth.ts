import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js'
import { fetchAndStoreClaudeCodeFirstTokenDate } from '../../services/api/firstTokenDate.js'
import { getGroveNoticeConfig, getGroveSettings } from '../../services/api/grove.js'
import {
  createAndStoreApiKey,
  fetchAndStoreUserRoles,
  shouldUseClaudeAIAuth,
  storeOAuthAccountInfo,
} from '../../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js'
import type { OAuthTokens } from '../../services/oauth/types.js'
import { clearPolicyLimitsCache } from '../../services/policyLimits/index.js'
import { clearRemoteManagedSettingsCache } from '../../services/remoteManagedSettings/index.js'
import {
  clearOAuthTokenCache,
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  getOauthAccountInfo,
  getSubscriptionType,
  saveCodexOAuthTokens,
  saveOAuthTokensIfNeeded,
} from '../../utils/auth.js'
import { clearBetasCaches } from '../../utils/betas.js'
import { logForDebugging } from '../../utils/debug.js'
import { isRunningOnHomespace } from '../../utils/envUtils.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { buildAccountProperties } from '../../utils/status.js'
import { clearToolSchemaCache } from '../../utils/toolSchemaCache.js'
import { resetUserCache } from '../../utils/user.js'

function hasAnyAnthropicScope(scopes: string[] | undefined): boolean {
  if (!scopes?.length) return false
  return scopes.some((s) => s.startsWith('user:') || s.startsWith('org:'))
}

async function clearAuthRelatedCaches(): Promise<void> {
  clearOAuthTokenCache()
  clearBetasCaches()
  clearToolSchemaCache()
  resetUserCache()
  refreshGrowthBookAfterAuthChange()
  getGroveNoticeConfig.cache?.clear?.()
  getGroveSettings.cache?.clear?.()
  await clearRemoteManagedSettingsCache()
  await clearPolicyLimitsCache()
}

export async function installOAuthTokens(tokens: OAuthTokens): Promise<void> {
  const profile =
    tokens.profile ?? (await getOauthProfileFromOauthToken(tokens.accessToken))
  if (profile) {
    storeOAuthAccountInfo({
      accountUuid: profile.account.uuid,
      emailAddress: profile.account.email,
      organizationUuid: profile.organization.uuid,
      displayName: profile.account.display_name || undefined,
      hasExtraUsageEnabled:
        profile.organization.has_extra_usage_enabled ?? undefined,
      billingType: profile.organization.billing_type ?? undefined,
      subscriptionCreatedAt:
        profile.organization.subscription_created_at ?? undefined,
      accountCreatedAt: profile.account.created_at,
    })
  } else if (tokens.tokenAccount) {
    storeOAuthAccountInfo({
      accountUuid: tokens.tokenAccount.uuid,
      emailAddress: tokens.tokenAccount.emailAddress,
      organizationUuid: tokens.tokenAccount.organizationUuid,
    })
  }

  const storageResult = saveOAuthTokensIfNeeded(tokens)
  clearOAuthTokenCache()

  if (storageResult.warning) {
    logEvent('tengu_oauth_storage_warning', {
      warning:
        storageResult.warning as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  await fetchAndStoreUserRoles(tokens.accessToken).catch((err) =>
    logForDebugging(String(err), { level: 'error' }),
  )

  if (shouldUseClaudeAIAuth(tokens.scopes)) {
    await fetchAndStoreClaudeCodeFirstTokenDate().catch((err) =>
      logForDebugging(String(err), { level: 'error' }),
    )
  } else if (hasAnyAnthropicScope(tokens.scopes)) {
    const apiKey = await createAndStoreApiKey(tokens.accessToken)
    if (!apiKey) {
      throw new Error(
        'Unable to create API key. The server accepted the request but did not return a key.',
      )
    }
  } else {
    saveCodexOAuthTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? '',
      expiresAt: tokens.expiresAt ?? Date.now() + 3600_000,
      accountId: tokens.tokenAccount?.uuid ?? '',
    })
  }

  await clearAuthRelatedCaches()
}

function getAPIProviderSafely(): string {
  try {
    return getAPIProvider()
  } catch {
    return 'not_configured'
  }
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  const { source: authTokenSource, hasToken } = getAuthTokenSource()
  const { source: apiKeySource } = getAnthropicApiKeyWithSource()
  const hasApiKeyEnvVar =
    !!process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()
  const oauthAccount = getOauthAccountInfo()
  const subscriptionType = getSubscriptionType()
  const loggedIn = hasToken || apiKeySource !== 'none' || hasApiKeyEnvVar

  let authMethod: string = 'none'
  if (authTokenSource === 'claude.ai') {
    authMethod = 'claude.ai'
  } else if (authTokenSource === 'apiKeyHelper') {
    authMethod = 'api_key_helper'
  } else if (authTokenSource !== 'none') {
    authMethod = 'oauth_token'
  } else if (apiKeySource === 'ANTHROPIC_API_KEY' || hasApiKeyEnvVar) {
    authMethod = 'api_key'
  } else if (apiKeySource === 'managed key') {
    authMethod = 'provider_config'
  }

  if (opts.text) {
    const properties = buildAccountProperties()
    let hasAuthProperty = false
    for (const prop of properties) {
      const value =
        typeof prop.value === 'string'
          ? prop.value
          : Array.isArray(prop.value)
            ? prop.value.join(', ')
            : null
      if (value === null || value === 'none') {
        continue
      }
      hasAuthProperty = true
      if (prop.label) {
        process.stdout.write(`${prop.label}: ${value}\n`)
      } else {
        process.stdout.write(`${value}\n`)
      }
    }
    if (!hasAuthProperty && hasApiKeyEnvVar) {
      process.stdout.write('API key: ANTHROPIC_API_KEY\n')
    }
    if (!loggedIn) {
      process.stdout.write(
        'No my-code API credentials configured. Configure ~/.my-code/models.config.json or set provider environment credentials.\n',
      )
    }
  } else {
    const output: Record<string, string | boolean | null> = {
      loggedIn,
      authMethod,
      apiProvider: getAPIProviderSafely(),
    }
    const resolvedApiKeySource =
      apiKeySource !== 'none'
        ? apiKeySource
        : hasApiKeyEnvVar
          ? 'ANTHROPIC_API_KEY'
          : null
    if (resolvedApiKeySource) {
      output.apiKeySource = resolvedApiKeySource
    }
    if (authMethod === 'claude.ai') {
      output.email = oauthAccount?.emailAddress ?? null
      output.orgId = oauthAccount?.organizationUuid ?? null
      output.orgName = oauthAccount?.organizationName ?? null
      output.subscriptionType = subscriptionType ?? null
    }

    process.stdout.write(jsonStringify(output, null, 2) + '\n')
  }

  process.exit(0)
}
