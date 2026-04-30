import axios from 'axios'
import { createAxiosInstance } from '../proxy.js'
import { getAPIProvider, getConfiguredApiUrl, getConfiguredApiKey } from './providers.js'

export type FetchedModel = {
  id: string
  name?: string
  description?: string
}

export type FetchModelsResult = {
  success: boolean
  models?: FetchedModel[]
  error?: string
}

/**
 * Fetch available models from an OpenAI-compatible API endpoint.
 * Handles both OpenAI format ({ data: [{ id }] }) and Anthropic format.
 */
export async function fetchModelsFromEndpoint(
  baseUrl: string,
  apiKey: string,
): Promise<FetchModelsResult> {
  if (!baseUrl || !apiKey) {
    return { success: false, error: 'API URL and Key are required' }
  }

  // Normalize base URL - remove trailing slash
  const normalizedUrl = baseUrl.replace(/\/$/, '')

  // Try OpenAI format first (/v1/models)
  const openaiUrl = `${normalizedUrl}/v1/models`

  try {
    const instance = createAxiosInstance()
    const response = await instance.get(openaiUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    })

    // Handle OpenAI format: { data: [{ id: string, ... }] }
    if (response.data && Array.isArray(response.data.data)) {
      const models = response.data.data.map((m: { id: string }) => ({
        id: m.id,
      }))
      return { success: true, models }
    }

    // Handle Anthropic format (list models response)
    if (response.data && Array.isArray(response.data)) {
      const models = response.data.map((m: { id?: string; name?: string }) => ({
        id: m.id || m.name || 'unknown',
      }))
      return { success: true, models }
    }

    return { success: false, error: 'Unexpected response format from API' }
  } catch (error) {
    // Try Anthropic format as fallback (/models endpoint)
    try {
      const anthropicUrl = `${normalizedUrl}/models`
      const instance = createAxiosInstance()
      const response = await instance.get(anthropicUrl, {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      })

      if (response.data && Array.isArray(response.data)) {
        const models = response.data.map(
          (m: { id?: string; name?: string }) => ({
            id: m.id || m.name || 'unknown',
          }),
        )
        return { success: true, models }
      }
    } catch {
      // Fallback failed too
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: `Failed to fetch models: ${errorMessage}`,
    }
  }
}

/**
 * Save custom API config and fetched models to global config.
 */
export async function saveCustomApiConfigAndFetchModels(
  apiUrl: string,
  apiKey: string,
  providerType: 'openai' | 'anthropic',
): Promise<FetchModelsResult> {
  const result = await fetchModelsFromEndpoint(apiUrl, apiKey)

  if (result.success && result.models) {
    // Dynamically import to avoid circular dependency
    const { saveGlobalConfig } = await import('../config.js')
    saveGlobalConfig(current => ({
      ...current,
      customApiConfig: {
        apiUrl,
        apiKey,
        providerType,
        models: result.models,
      },
    }))
  }

  return result
}

/**
 * Get cached models from global config.
 * If no cache exists but a custom provider is configured, triggers a background fetch.
 * Uses ~/.my-code/ directory for persistence (independent from Claude config).
 */
export function getCachedCustomApiModels(): FetchedModel[] | undefined {
  const models = loadCachedModelsFromFile()

  // If we have models in cache, return them
  if (models && models.length > 0) {
    return models
  }

  // No cache - trigger async fetch if provider is configured
  const configuredApiUrl = getConfiguredApiUrl()
  const configuredApiKey = getConfiguredApiKey()
  const provider = getAPIProvider()

  // Only trigger fetch for custom providers (not built-in providers)
  const builtInProviders = ['firstParty', 'bedrock', 'vertex', 'foundry', 'openai']
  if (!builtInProviders.includes(provider) && configuredApiUrl && configuredApiKey) {
    // Fire and forget - the fetch will update the cache via .then()
    fetchModelsFromEndpoint(configuredApiUrl, configuredApiKey)
      .then(result => {
        if (result.models && result.models.length > 0) {
          saveModelsCacheToFile(configuredApiUrl, configuredApiKey, result.models)
        }
      })
      .catch(() => {})
  }

  return models
}

/**
 * Get the path to the custom API cache file in ~/.my-code/
 */
function getCustomApiCachePath(): string {
  const { homedir } = require('os')
  return `${homedir()}/.my-code/customApiConfig.json`
}

/**
 * Load cached models from ~/.my-code/customApiConfig.json
 */
function loadCachedModelsFromFile(): FetchedModel[] | undefined {
  try {
    const fs = require('fs')
    const cachePath = getCustomApiCachePath()
    if (!fs.existsSync(cachePath)) {
      return undefined
    }
    const content = fs.readFileSync(cachePath, 'utf8')
    const data = JSON.parse(content)
    return data.models as FetchedModel[] | undefined
  } catch {
    return undefined
  }
}

/**
 * Save models cache to ~/.my-code/customApiConfig.json
 */
function saveModelsCacheToFile(
  apiUrl: string,
  apiKey: string,
  models: FetchedModel[],
): void {
  try {
    const fs = require('fs')
    const cachePath = getCustomApiCachePath()

    // Ensure ~/.my-code/ directory exists
    const dir = require('path').dirname(cachePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(cachePath, JSON.stringify({
      apiUrl,
      apiKey,
      models,
      updatedAt: new Date().toISOString(),
    }, null, 2))
  } catch (error) {
    console.error(`Failed to save models cache: ${error}`)
  }
}

/**
 * Fetch models and cache them to ~/.my-code/customApiConfig.json
 */
async function fetchAndCacheModels(
  apiUrl: string,
  apiKey: string,
): Promise<{ providerType: 'openai' | 'anthropic' } | null> {
  const result = await fetchModelsFromEndpoint(apiUrl, apiKey)
  if (result.success && result.models) {
    // Save to ~/.my-code/ directory instead of ~/.claude/
    saveModelsCacheToFile(apiUrl, apiKey, result.models)
    return { providerType: 'openai' }
  }
  return null
}

/**
 * Get custom API config from global config.
 */
export function getCustomApiConfig(): {
  apiUrl: string
  apiKey: string
  providerType: 'openai' | 'anthropic'
} | null {
  const { getGlobalConfig } = require('../config.js')
  const config = getGlobalConfig().customApiConfig
  if (!config) return null
  return {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    providerType: config.providerType,
  }
}

/**
 * Clear the fetched models cache.
 * Called when API settings change.
 */
export function clearFetchedModelsCache(): void {
  // Cache is maintained at a higher level if needed
}