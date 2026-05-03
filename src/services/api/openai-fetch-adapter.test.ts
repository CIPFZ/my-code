import { describe, expect, test } from 'bun:test'
import {
  translateAnthropicToOpenAIChat,
  translateOpenAIChatToAnthropic,
} from './openai-fetch-adapter.js'

describe('openai-fetch-adapter', () => {
  test('translates Anthropic system, messages, tools, and tool results to OpenAI chat', () => {
    const translated = translateAnthropicToOpenAIChat({
      model: 'gpt-test',
      system: [{ type: 'text', text: 'be helpful' }],
      max_tokens: 128,
      temperature: 0.2,
      tools: [
        {
          name: 'lookup',
          description: 'Lookup data',
          input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'checking' },
            { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { query: 'hello' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'world' }],
        },
      ],
    })

    expect(translated).toMatchObject({
      model: 'gpt-test',
      max_tokens: 128,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: 'checking',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"query":"hello"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'toolu_1', content: 'world' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Lookup data',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        },
      ],
    })
  })

  test('translates OpenAI text and tool calls back to Anthropic message shape', () => {
    const translated = translateOpenAIChatToAnthropic({
      id: 'chatcmpl_1',
      model: 'gpt-test',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'checking',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"query":"hello"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    })

    expect(translated).toEqual({
      id: 'chatcmpl_1',
      type: 'message',
      role: 'assistant',
      model: 'gpt-test',
      content: [
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: { query: 'hello' } },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 4 },
    })
  })
})
