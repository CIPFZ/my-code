type AnthropicContentBlock = {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  [key: string]: unknown
}

type AnthropicMessage = {
  role: string
  content: string | AnthropicContentBlock[]
}

type AnthropicTool = {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

type OpenAIMessage = Record<string, unknown>

type OpenAIFetchOptions = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, '')
}

function textFromContent(content: string | AnthropicContentBlock[] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (block.type === 'text') return block.text ?? ''
      if (block.type === 'image') return '[Image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function systemToMessages(system: unknown): OpenAIMessage[] {
  if (!system) return []
  const content =
    typeof system === 'string'
      ? system
      : Array.isArray(system)
        ? system
            .map(block =>
              block &&
              typeof block === 'object' &&
              (block as AnthropicContentBlock).type === 'text'
                ? (block as AnthropicContentBlock).text ?? ''
                : '',
            )
            .filter(Boolean)
            .join('\n')
        : ''
  return content ? [{ role: 'system', content }] : []
}

function anthropicMessagesToOpenAI(messages: AnthropicMessage[]): OpenAIMessage[] {
  const openaiMessages: OpenAIMessage[] = []

  for (const message of messages) {
    if (typeof message.content === 'string') {
      openaiMessages.push({ role: message.role, content: message.content })
      continue
    }

    if (!Array.isArray(message.content)) continue

    if (message.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: OpenAIMessage[] = []

      for (const block of message.content) {
        if (block.type === 'text' && block.text) textParts.push(block.text)
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name ?? '',
              arguments: JSON.stringify(block.input ?? {}),
            },
          })
        }
      }

      openaiMessages.push({
        role: 'assistant',
        content: textParts.join('\n') || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    let userText = ''
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: textFromContent(block.content),
        })
      } else if (block.type === 'text' && block.text) {
        userText += `${userText ? '\n' : ''}${block.text}`
      }
    }
    if (userText) openaiMessages.push({ role: 'user', content: userText })
  }

  return openaiMessages
}

function anthropicToolsToOpenAI(tools: AnthropicTool[] | undefined): OpenAIMessage[] {
  if (!tools?.length) return []
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    },
  }))
}

export function translateAnthropicToOpenAIChat(
  anthropicBody: Record<string, unknown>,
): Record<string, unknown> {
  const tools = anthropicToolsToOpenAI(anthropicBody.tools as AnthropicTool[] | undefined)
  const body: Record<string, unknown> = {
    model: anthropicBody.model,
    messages: [
      ...systemToMessages(anthropicBody.system),
      ...anthropicMessagesToOpenAI((anthropicBody.messages ?? []) as AnthropicMessage[]),
    ],
    stream: anthropicBody.stream === true,
  }

  if (anthropicBody.max_tokens) body.max_tokens = anthropicBody.max_tokens
  if (anthropicBody.temperature !== undefined) body.temperature = anthropicBody.temperature
  if (anthropicBody.top_p !== undefined) body.top_p = anthropicBody.top_p
  if (anthropicBody.stop_sequences) body.stop = anthropicBody.stop_sequences
  if (tools.length > 0) body.tools = tools
  if (anthropicBody.tool_choice) body.tool_choice = 'auto'

  return body
}

function mapStopReason(reason: unknown, hasToolCalls = false): string {
  if (hasToolCalls) return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'stop') return 'end_turn'
  return 'end_turn'
}

export function translateOpenAIChatToAnthropic(
  openaiBody: Record<string, unknown>,
): Record<string, unknown> {
  const choice = ((openaiBody.choices as Record<string, unknown>[] | undefined) ?? [])[0]
  const message = (choice?.message as Record<string, unknown> | undefined) ?? {}
  const content: Record<string, unknown>[] = []
  const text = message.content

  if (typeof text === 'string' && text.length > 0) {
    content.push({ type: 'text', text })
  }

  const toolCalls = (message.tool_calls as Record<string, unknown>[] | undefined) ?? []
  for (const toolCall of toolCalls) {
    const fn = (toolCall.function as Record<string, unknown> | undefined) ?? {}
    let input: Record<string, unknown> = {}
    if (typeof fn.arguments === 'string' && fn.arguments.trim()) {
      try {
        input = JSON.parse(fn.arguments) as Record<string, unknown>
      } catch {
        input = {}
      }
    }
    content.push({
      type: 'tool_use',
      id: String(toolCall.id ?? `toolu_${content.length}`),
      name: String(fn.name ?? ''),
      input,
    })
  }

  const usage = (openaiBody.usage as Record<string, number> | undefined) ?? {}
  return {
    id: openaiBody.id ?? `msg_openai_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: openaiBody.model,
    content,
    stop_reason: mapStopReason(choice?.finish_reason, toolCalls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    },
  }
}

function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function translateOpenAIStreamToAnthropic(
  openaiResponse: Response,
  model: unknown,
): Promise<Response> {
  const messageId = `msg_openai_${Date.now()}`
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(formatSSE(event, data)))
      }
      let blockIndex = 0
      let textStarted = false
      let stopReason = 'end_turn'
      const toolBlocks = new Map<number, { blockIndex: number; id: string; name: string; args: string }>()

      emit('message_start', {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })

      const reader = openaiResponse.body?.getReader()
      if (!reader) {
        emit('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 },
        })
        emit('message_stop', { type: 'message_stop' })
        controller.close()
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === '[DONE]') continue

          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(payload) as Record<string, unknown>
          } catch {
            continue
          }

          const choice = ((parsed.choices as Record<string, unknown>[] | undefined) ?? [])[0]
          const delta = (choice?.delta as Record<string, unknown> | undefined) ?? {}
          const text = delta.content
          if (typeof text === 'string' && text.length > 0) {
            if (!textStarted) {
              emit('content_block_start', {
                type: 'content_block_start',
                index: blockIndex,
                content_block: { type: 'text', text: '' },
              })
              textStarted = true
            }
            emit('content_block_delta', {
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'text_delta', text },
            })
          }

          const toolCalls = (delta.tool_calls as Record<string, unknown>[] | undefined) ?? []
          for (const toolCall of toolCalls) {
            if (textStarted) {
              emit('content_block_stop', { type: 'content_block_stop', index: blockIndex })
              blockIndex++
              textStarted = false
            }
            const index = Number(toolCall.index ?? 0)
            let toolBlock = toolBlocks.get(index)
            const fn = (toolCall.function as Record<string, unknown> | undefined) ?? {}
            if (!toolBlock) {
              toolBlock = {
                blockIndex,
                id: String(toolCall.id ?? `toolu_${index}`),
                name: String(fn.name ?? ''),
                args: '',
              }
              toolBlocks.set(index, toolBlock)
              emit('content_block_start', {
                type: 'content_block_start',
                index: blockIndex,
                content_block: {
                  type: 'tool_use',
                  id: toolBlock.id,
                  name: toolBlock.name,
                  input: {},
                },
              })
              blockIndex++
            }
            if (typeof fn.name === 'string' && fn.name) toolBlock.name = fn.name
            if (typeof fn.arguments === 'string' && fn.arguments) {
              toolBlock.args += fn.arguments
              emit('content_block_delta', {
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'input_json_delta', partial_json: fn.arguments },
              })
            }
          }

          if (choice?.finish_reason) {
            stopReason = mapStopReason(choice.finish_reason, toolBlocks.size > 0)
          }
        }
      }

      if (textStarted) {
        emit('content_block_stop', { type: 'content_block_stop', index: blockIndex })
        blockIndex++
      }
      for (const toolBlock of toolBlocks.values()) {
        emit('content_block_stop', { type: 'content_block_stop', index: toolBlock.blockIndex })
      }
      emit('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 0 },
      })
      emit('message_stop', { type: 'message_stop' })
      controller.close()
    },
  })

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export function createOpenAIFetch({
  baseURL,
  apiKey,
  headers = {},
  fetch = globalThis.fetch,
}: OpenAIFetchOptions): typeof globalThis.fetch {
  const chatCompletionsURL = `${normalizeBaseURL(baseURL)}/chat/completions`

  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/v1/messages')) return fetch(input, init)

    let anthropicBody: Record<string, unknown> = {}
    const body = init?.body
    if (typeof body === 'string') {
      anthropicBody = JSON.parse(body) as Record<string, unknown>
    } else if (body instanceof ReadableStream) {
      anthropicBody = JSON.parse(await new Response(body).text()) as Record<string, unknown>
    }

    const openaiBody = translateAnthropicToOpenAIChat(anthropicBody)
    const response = await fetch(chatCompletionsURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: anthropicBody.stream === true ? 'text/event-stream' : 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
      body: JSON.stringify(openaiBody),
    })

    if (!response.ok) return response
    if (anthropicBody.stream === true) {
      return translateOpenAIStreamToAnthropic(response, anthropicBody.model)
    }

    const openaiResponse = (await response.json()) as Record<string, unknown>
    return new Response(JSON.stringify(translateOpenAIChatToAnthropic(openaiResponse)), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
