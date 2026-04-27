import axios from 'axios'
import { createAxiosInstance } from '../proxy.js'

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
 */
export function getCachedCustomApiModels(): FetchedModel[] | undefined {
  // Dynamically import to avoid circular dependency
  const { getGlobalConfig } = require('../config.js')
  return getGlobalConfig().customApiConfig?.models as FetchedModel[] | undefined
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