import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getAnthropicClient } from './client.js'

const tempDirs: string[] = []
const originalModelConfig = process.env.MY_CODE_MODEL_CONFIG

beforeAll(() => {
  ;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = { VERSION: 'test' }
})

function makeConfigPath(protocol: 'openai' | 'anthropic'): string {
  const dir = join(tmpdir(), `my-code-client-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  const path = join(dir, 'models.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      currentProvider: 'test',
      currentModel: 'test-model',
      providers: {
        test: {
          protocol,
          apiUrl: 'https://provider.example/v1',
          apiKey: 'provider-key',
          headers: { 'x-provider': 'true' },
          models: [{ id: 'test-model' }],
        },
      },
    }),
  )
  return path
}

afterEach(() => {
  if (originalModelConfig === undefined) delete process.env.MY_CODE_MODEL_CONFIG
  else process.env.MY_CODE_MODEL_CONFIG = originalModelConfig
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('api client provider config branch', () => {
  test('uses OpenAI fetch adapter for openai protocol providers', async () => {
    process.env.MY_CODE_MODEL_CONFIG = makeConfigPath('openai')
    let requestedURL = ''
    let requestedAuth = ''
    const fetchOverride = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedURL = String(input)
      requestedAuth = new Headers(init?.headers).get('Authorization') ?? ''
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_1',
          model: 'test-model',
          choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof globalThis.fetch

    const client = await getAnthropicClient({ maxRetries: 0, fetchOverride })
    const message = await client.messages.create({
      model: 'test-model',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(requestedURL).toBe('https://provider.example/v1/chat/completions')
    expect(requestedAuth).toBe('Bearer provider-key')
    expect(message.content).toEqual([{ type: 'text', text: 'ok' }])
  })

  test('uses configured baseURL for anthropic protocol providers', async () => {
    process.env.MY_CODE_MODEL_CONFIG = makeConfigPath('anthropic')
    let requestedURL = ''
    let requestedProviderHeader = ''
    const fetchOverride = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedURL = String(input)
      requestedProviderHeader = new Headers(init?.headers).get('x-provider') ?? ''
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'test-model',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof globalThis.fetch

    const client = await getAnthropicClient({ maxRetries: 0, fetchOverride })
    await client.messages.create({
      model: 'test-model',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(requestedURL).toBe('https://provider.example/v1/messages')
    expect(requestedProviderHeader).toBe('true')
  })
})
