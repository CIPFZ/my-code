import { describe, expect, it } from 'bun:test'
import { createOpenAIFetch } from './openai-fetch-adapter.ts'

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

describe('openai fetch adapter', () => {
  it('streams tool call arguments as JSON deltas without duplicating the first chunk', async () => {
    const originalFetch = globalThis.fetch
    const args = { command: 'pwd', description: 'Show working directory' }
    const argJson = JSON.stringify(args)

    globalThis.fetch = (async () => {
      const body = [
        sse({
          id: 'chatcmpl_test',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: 'call_test',
                    type: 'function',
                    function: {
                      name: 'Bash',
                      arguments: argJson.slice(0, 20),
                    },
                  },
                ],
              },
            },
          ],
        }),
        sse({
          id: 'chatcmpl_test',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: argJson.slice(20),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        'data: [DONE]\n\n',
      ].join('')

      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const openaiFetch = createOpenAIFetch('test-key', 'https://api.openai.com/v1')
      const response = await openaiFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'run pwd' }],
          tools: [
            {
              name: 'Bash',
              input_schema: {
                type: 'object',
                properties: {
                  command: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['command'],
              },
            },
          ],
        }),
      })

      const text = await response.text()
      expect(text).toContain('"type":"tool_use"')
      expect(text).toContain('"type":"input_json_delta"')
      const partialJson = [...text.matchAll(/"partial_json":"((?:\\.|[^"])*)"/g)]
        .map(match => JSON.parse(`"${match[1]}"`) as string)
        .join('')
      expect(JSON.parse(partialJson)).toEqual(args)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
