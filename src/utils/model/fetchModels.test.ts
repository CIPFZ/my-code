import { describe, expect, it } from 'bun:test'
import { getOpenAIModelsEndpoint } from './fetchModels.js'

describe('model discovery endpoint normalization', () => {
  it('does not append a second /v1 when baseUrl already includes it', () => {
    expect(getOpenAIModelsEndpoint('https://cch.fkcodex.com/v1')).toBe(
      'https://cch.fkcodex.com/v1/models',
    )
    expect(getOpenAIModelsEndpoint('https://cch.fkcodex.com')).toBe(
      'https://cch.fkcodex.com/v1/models',
    )
  })
})
