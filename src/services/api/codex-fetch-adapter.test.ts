import { describe, expect, it } from 'bun:test'
import { createCodexFetch } from './codex-fetch-adapter.ts'

function makeCodexToken(): string {
  const payload = {
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_test',
    },
  }
  return ['header', btoa(JSON.stringify(payload)), 'signature'].join('.')
}

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

describe('codex fetch adapter', () => {
  it('streams tool call input as JSON deltas instead of leaving input as an object', async () => {
    const originalFetch = globalThis.fetch
    const args = { description: 'Investigate issue', prompt: 'Find root cause' }
    const argJson = JSON.stringify(args)

    globalThis.fetch = (async () => {
      const body = [
        sse('response.output_item.added', {
          type: 'response.output_item.added',
          item: {
            type: 'function_call',
            call_id: 'call_test',
            name: 'Agent',
            arguments: '',
          },
        }),
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          delta: argJson.slice(0, 30),
        }),
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          delta: argJson.slice(30),
        }),
        sse('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          arguments: argJson,
        }),
        sse('response.output_item.done', {
          type: 'response.output_item.done',
          item: { type: 'function_call' },
        }),
        sse('response.completed', {
          type: 'response.completed',
          response: { usage: { input_tokens: 1, output_tokens: 1 } },
        }),
      ].join('')

      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const codexFetch = createCodexFetch(makeCodexToken())
      const response = await codexFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'spawn an agent' }],
          tools: [
            {
              name: 'Agent',
              input_schema: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  prompt: { type: 'string' },
                },
                required: ['description', 'prompt'],
              },
            },
          ],
        }),
      })

      const text = await response.text()
      expect(text).toContain('"type":"tool_use"')
      expect(text).not.toContain('"input":{"description"')
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
