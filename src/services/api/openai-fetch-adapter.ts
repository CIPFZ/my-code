/**
 * OpenAI Fetch Adapter
 *
 * Intercepts fetch calls from the Anthropic SDK and routes them to
 * OpenAI's chat completions API, translating between Anthropic Messages API
 * format and OpenAI chat completions format.
 *
 * Supports:
 * - Text messages (user/assistant)
 * - System prompts
 * - Tool definitions (Anthropic input_schema → OpenAI functions)
 * - Tool use (tool_use → function_call, tool_result → function_call_output)
 * - Streaming events translation (OpenAI SSE → Anthropic SSE)
 *
 * Endpoint: OpenAI base URL + /v1/chat/completions
 */

import { getConfigDefaultModel } from '../../utils/model/configs.js'
import { getOpenAIApiKey } from '../../utils/auth.js'

// ── Available OpenAI models ─────────────────────────────────────────

export const OPENAI_MODELS = [
  { id: 'gpt-4.5', label: 'GPT-4.5', description: 'Latest GPT-4.5 model' },
  { id: 'gpt-4.1', label: 'GPT-4.1', description: 'GPT-4.1 model' },
  { id: 'gpt-4o', label: 'GPT-4o', description: 'GPT-4o model' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fast GPT-4o variant' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', description: 'Turbocharged GPT-4' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', description: 'Fast and efficient' },
] as const

export const DEFAULT_OPENAI_MODEL = 'gpt-4o'

/**
 * Maps Claude model names to corresponding OpenAI model names.
 * @param claudeModel - The Claude model name to map
 * @returns The corresponding OpenAI model ID
 */
export function mapClaudeModelToOpenAI(claudeModel: string | null): string {
  const configuredDefaultModel = getConfigDefaultModel()
  if (!claudeModel) return configuredDefaultModel ?? DEFAULT_OPENAI_MODEL

  // If already an OpenAI-format model name, pass through as-is
  const lower = claudeModel.toLowerCase()
  if (lower.startsWith('gpt-') || lower.startsWith('o1-') || lower.startsWith('o3-')) {
    return claudeModel
  }

  if (configuredDefaultModel) {
    return configuredDefaultModel
  }

  // Map Claude model families to OpenAI equivalents
  if (lower.includes('opus')) return 'gpt-4.5'
  if (lower.includes('sonnet')) return 'gpt-4o'
  if (lower.includes('haiku')) return 'gpt-4o-mini'
  return DEFAULT_OPENAI_MODEL
}

// ── Types ───────────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: { type: string; media_type?: string; data?: string }
  [key: string]: unknown
}

interface AnthropicMessage {
  role: string
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

// ── Tool translation: Anthropic → OpenAI ─────────────────────────────

/**
 * Translates Anthropic tool definitions to OpenAI format.
 * @param anthropicTools - Array of Anthropic tool definitions
 * @returns Array of OpenAI-compatible function objects
 */
function translateTools(anthropicTools: AnthropicTool[]): Array<Record<string, unknown>> {
  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }))
}

// ── Message translation: Anthropic → OpenAI ──────────────────────────

/**
 * Translates Anthropic message format to OpenAI chat completions format.
 * Handles text content, tool results, and image attachments.
 * @param anthropicMessages - Array of messages in Anthropic format
 * @returns Array of OpenAI-compatible messages
 */
function translateMessages(
  anthropicMessages: AnthropicMessage[],
): Array<Record<string, unknown>> {
  const openaiMessages: Array<Record<string, unknown>> = []
  let toolCallCounter = 0

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      openaiMessages.push({ role: msg.role, content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) continue

    if (msg.role === 'user') {
      const contentArr: Array<Record<string, unknown>> = []
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const callId = block.tool_use_id || `call_${toolCallCounter++}`
          let outputText = ''
          if (typeof block.content === 'string') {
            outputText = block.content
          } else if (Array.isArray(block.content)) {
            outputText = block.content
              .map(c => {
                if (c.type === 'text') return c.text
                if (c.type === 'image') return '[Image data attached]'
                return ''
              })
              .join('\n')
          }
          openaiMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: outputText || '',
          })
        } else if (block.type === 'text' && typeof block.text === 'string') {
          contentArr.push({ type: 'text', text: block.text })
        } else if (
          block.type === 'image' &&
          typeof block.source === 'object' &&
          block.source !== null &&
          (block.source as any).type === 'base64'
        ) {
          contentArr.push({
            type: 'image_url',
            image_url: {
              url: `data:${(block.source as any).media_type};base64,${(block.source as any).data}`,
            },
          })
        }
      }
      if (contentArr.length > 0) {
        if (contentArr.length === 1 && contentArr[0].type === 'text') {
          openaiMessages.push({ role: 'user', content: (contentArr[0] as any).text })
        } else {
          openaiMessages.push({ role: 'user', content: contentArr })
        }
      }
    } else if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          openaiMessages.push({
            role: 'assistant',
            content: block.text,
          })
        } else if (block.type === 'tool_use') {
          const callId = block.id || `call_${toolCallCounter++}`
          openaiMessages.push({
            role: 'assistant',
            tool_calls: [
              {
                id: callId,
                type: 'function',
                function: {
                  name: block.name || '',
                  arguments: JSON.stringify(block.input || {}),
                },
              },
            ],
          })
        }
      }
    }
  }

  return openaiMessages
}

// ── Full request translation ────────────────────────────────────────

/**
 * Translates a complete Anthropic API request body to OpenAI format.
 * @param anthropicBody - The Anthropic request body to translate
 * @returns Object containing the translated OpenAI body and model
 */
function translateToOpenAIBody(anthropicBody: Record<string, unknown>): {
  openaiBody: Record<string, unknown>
  openaiModel: string
} {
  const anthropicMessages = (anthropicBody.messages || []) as AnthropicMessage[]
  const systemPrompt = anthropicBody.system as
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined
  const claudeModel = anthropicBody.model as string
  const anthropicTools = (anthropicBody.tools || []) as AnthropicTool[]

  const openaiModel = mapClaudeModelToOpenAI(claudeModel)

  // Build system message
  let systemMessage = ''
  if (systemPrompt) {
    systemMessage =
      typeof systemPrompt === 'string'
        ? systemPrompt
        : Array.isArray(systemPrompt)
          ? systemPrompt
              .filter(b => b.type === 'text' && typeof b.text === 'string')
              .map(b => b.text!)
              .join('\n')
          : ''
  }

  // Convert messages
  const messages = translateMessages(anthropicMessages)

  const openaiBody: Record<string, unknown> = {
    model: openaiModel,
    stream: true,
    messages: systemMessage ? [{ role: 'system', content: systemMessage }, ...messages] : messages,
  }

  // Add tools if present
  if (anthropicTools.length > 0) {
    openaiBody.tools = translateTools(anthropicTools)
    openaiBody.tool_choice = 'auto'
  }

  return { openaiBody, openaiModel }
}

// ── Response translation: OpenAI SSE → Anthropic SSE ─────────────────

/**
 * Formats data as Server-Sent Events (SSE) format.
 * @param event - The event type
 * @param data - The data payload
 * @returns Formatted SSE string
 */
function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

/**
 * Translates OpenAI streaming response to Anthropic format.
 * Converts OpenAI chat completions SSE events into Anthropic-compatible streaming events.
 * @param openaiResponse - The streaming response from OpenAI API
 * @param openaiModel - The OpenAI model used for the request
 * @returns Transformed Response object with Anthropic-format stream
 */
async function translateOpenAIStreamToAnthropic(
  openaiResponse: Response,
  openaiModel: string,
): Promise<Response> {
  const messageId = `msg_openai_${Date.now()}`

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let contentBlockIndex = 0
      let outputTokens = 0
      let inputTokens = 0

      // Emit Anthropic message_start
      controller.enqueue(
        encoder.encode(
          formatSSE(
            'message_start',
            JSON.stringify({
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model: openaiModel,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
          ),
        ),
      )

      // Emit ping
      controller.enqueue(
        encoder.encode(
          formatSSE('ping', JSON.stringify({ type: 'ping' })),
        ),
      )

      // Track state for tool calls
      let currentTextBlockStarted = false
      let currentToolCallId = ''
      let currentToolCallName = ''
      let currentToolCallArgs = ''
      let emittedToolCallArgsLength = 0
      let inToolCall = false
      let hadToolCalls = false
      let toolCallIndex = 0
      const reader = openaiResponse.body?.getReader()

      function emitToolCallStart(id: string, name: string) {
        currentToolCallId = id || `call_${Date.now()}_${toolCallIndex++}`
        currentToolCallName = name || ''
        currentToolCallArgs = ''
        emittedToolCallArgsLength = 0
        inToolCall = true
        hadToolCalls = true

        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_start', JSON.stringify({
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: currentToolCallId,
                name: currentToolCallName,
                input: '',
              },
            })),
          ),
        )
      }

      function emitToolArgDelta(argDelta: string) {
        currentToolCallArgs += argDelta
        emittedToolCallArgsLength = currentToolCallArgs.length
        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_delta', JSON.stringify({
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: argDelta,
              },
            })),
          ),
        )
      }

      function emitMissingToolArgs(args: string) {
        const missingArgs = args.slice(emittedToolCallArgsLength)
        if (missingArgs.length > 0) {
          emitToolArgDelta(missingArgs)
        }
        currentToolCallArgs = args
      }

      function closeToolCallBlock() {
        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_stop', JSON.stringify({
              type: 'content_block_stop',
              index: contentBlockIndex,
            })),
          ),
        )
        contentBlockIndex++
        inToolCall = false
      }

      try {
        if (!reader) {
          controller.enqueue(
            encoder.encode(
              formatSSE(
                'content_block_start',
                JSON.stringify({
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: 'Error: No response body' },
                }),
              ),
            ),
          )
          finishStream(controller, encoder, outputTokens, inputTokens, false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            if (trimmed.startsWith('event: ')) continue

            if (!trimmed.startsWith('data: ')) continue
            const dataStr = trimmed.slice(6)
            if (dataStr === '[DONE]') continue

            let event: Record<string, unknown>
            try {
              event = JSON.parse(dataStr)
            } catch {
              continue
            }

            const eventType = (event.event || event.type) as string

            // ── Text content events ─────────────────────────────
            if (eventType === 'content_block.delta') {
              const delta = event.delta as Record<string, unknown>
              if (delta?.type === 'input_text_delta') {
                const text = delta.text as string
                if (typeof text === 'string' && text.length > 0) {
                  if (!currentTextBlockStarted) {
                    controller.enqueue(
                      encoder.encode(
                        formatSSE('content_block_start', JSON.stringify({
                          type: 'content_block_start',
                          index: contentBlockIndex,
                          content_block: { type: 'text', text: '' },
                        })),
                      ),
                    )
                    currentTextBlockStarted = true
                  }
                  controller.enqueue(
                    encoder.encode(
                      formatSSE('content_block_delta', JSON.stringify({
                        type: 'content_block_delta',
                        index: contentBlockIndex,
                        delta: { type: 'text_delta', text },
                      })),
                    ),
                  )
                  outputTokens += 1
                }
              }
            }

            // Content block started
            else if (eventType === 'content_block.started') {
              const contentBlock = event.content_block as Record<string, unknown>
              if (contentBlock?.type === 'function_call') {
                emitToolCallStart(
                  (contentBlock.id as string) || (contentBlock.call_id as string) || '',
                  contentBlock.name as string,
                )
              } else if (contentBlock?.type === 'text') {
                currentTextBlockStarted = true
              }
            }

            // Content block stopped
            else if (eventType === 'content_block.stopped') {
              if (inToolCall) {
                closeToolCallBlock()
              }
              if (currentTextBlockStarted) {
                controller.enqueue(
                  encoder.encode(
                    formatSSE('content_block_stop', JSON.stringify({
                      type: 'content_block_stop',
                      index: contentBlockIndex,
                    })),
                  ),
                )
                contentBlockIndex++
                currentTextBlockStarted = false
              }
            }

            // Tool call delta
            else if (eventType === 'function_call_arguments.delta') {
              const fnName = event.name as string
              const argDelta = event.delta as string

              if (fnName && !currentToolCallName) {
                emitToolCallStart('', fnName)
              }

              if (inToolCall && typeof argDelta === 'string') {
                emitToolArgDelta(argDelta)
              }
            }

            // Tool call done
            else if (eventType === 'function_call_arguments.done') {
              const fnName = event.name as string
              const args = event.arguments as string

              if (inToolCall && fnName) {
                currentToolCallName = fnName
              }
              if (inToolCall && args) {
                emitMissingToolArgs(args)
              }
            }

            else if (eventType === 'response.output_item.added') {
              const item = event.item as Record<string, unknown>
              if (item?.type === 'function_call') {
                emitToolCallStart(
                  (item.call_id as string) || (item.id as string) || '',
                  item.name as string,
                )
                const args = item.arguments as string
                if (typeof args === 'string' && args.length > 0) {
                  emitMissingToolArgs(args)
                }
              }
            }

            else if (eventType === 'response.function_call_arguments.delta') {
              const argDelta = event.delta as string
              if (typeof argDelta === 'string' && inToolCall) {
                emitToolArgDelta(argDelta)
              }
            }

            else if (eventType === 'response.function_call_arguments.done') {
              const args = event.arguments as string
              if (typeof args === 'string' && inToolCall) {
                emitMissingToolArgs(args)
              }
            }

            else if (eventType === 'response.output_item.done') {
              const item = event.item as Record<string, unknown>
              if (item?.type === 'function_call' && inToolCall) {
                const args = item.arguments as string
                if (typeof args === 'string' && args.length > 0) {
                  emitMissingToolArgs(args)
                }
                closeToolCallBlock()
              }
            }

            else if (eventType === 'response.completed') {
              const response = event.response as Record<string, unknown>
              const usage = response?.usage as Record<string, number> | undefined
              if (usage) {
                outputTokens = usage.output_tokens || outputTokens
                inputTokens = usage.input_tokens || inputTokens
              }
            }

            // Message delta (completion delta)
            else if (eventType === 'message_delta') {
              const delta = event.delta as Record<string, unknown>
              if (delta?.type === 'content_block_delta') {
                const contentDelta = delta.content_block_delta as Record<string, unknown>
                if (contentDelta?.type === 'input_text_delta') {
                  const text = contentDelta.text as string
                  if (typeof text === 'string' && text.length > 0) {
                    if (!currentTextBlockStarted) {
                      controller.enqueue(
                        encoder.encode(
                          formatSSE('content_block_start', JSON.stringify({
                            type: 'content_block_start',
                            index: contentBlockIndex,
                            content_block: { type: 'text', text: '' },
                          })),
                        ),
                      )
                      currentTextBlockStarted = true
                    }
                    controller.enqueue(
                      encoder.encode(
                        formatSSE('content_block_delta', JSON.stringify({
                          type: 'content_block_delta',
                          index: contentBlockIndex,
                          delta: { type: 'text_delta', text },
                        })),
                      ),
                    )
                    outputTokens += 1
                  }
                }
              }
            }

            // Message stopped
            else if (eventType === 'message.stopped') {
              // Extract usage if available
              const usage = event.usage as Record<string, number> | undefined
              if (usage) {
                outputTokens = usage.completion_tokens || outputTokens
                inputTokens = usage.prompt_tokens || inputTokens
              }

              // Stop reason
              const stopReason = event.stop_reason as string
              if (stopReason) {
                const anthropicStopReason = stopReason === 'function_call' ? 'tool_use' : stopReason
                controller.enqueue(
                  encoder.encode(
                    formatSSE('message_delta', JSON.stringify({
                      type: 'message_delta',
                      delta: { stop_reason: anthropicStopReason, stop_sequence: null },
                      usage: { output_tokens: outputTokens },
                    })),
                  ),
                )
              }
            }

            // Handle chat.completion events (non-SSE OpenAI format)
            else if (event.id) {
              // This looks like a chat.completion.chunk event
              const choices = event.choices as Array<Record<string, unknown>> | undefined
              if (choices && choices.length > 0) {
                const choice = choices[0] as Record<string, unknown>
                const delta = choice.delta as Record<string, unknown>

                if (delta) {
                  // Text content
                  const text = delta.content as string
                  if (typeof text === 'string' && text.length > 0) {
                    if (!currentTextBlockStarted) {
                      controller.enqueue(
                        encoder.encode(
                          formatSSE('content_block_start', JSON.stringify({
                            type: 'content_block_start',
                            index: contentBlockIndex,
                            content_block: { type: 'text', text: '' },
                          })),
                        ),
                      )
                      currentTextBlockStarted = true
                    }
                    controller.enqueue(
                      encoder.encode(
                        formatSSE('content_block_delta', JSON.stringify({
                          type: 'content_block_delta',
                          index: contentBlockIndex,
                          delta: { type: 'text_delta', text },
                        })),
                      ),
                    )
                    outputTokens += 1
                  }

                  // Tool calls
                  const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
                  if (toolCalls) {
                    for (const tc of toolCalls) {
                      const fn = tc.function as Record<string, unknown>
                      if (!inToolCall && fn) {
                        emitToolCallStart(
                          (tc.id as string) || '',
                          fn.name as string,
                        )
                      }

                      if (inToolCall) {
                        const argDelta = fn.arguments as string
                        if (typeof argDelta === 'string') {
                          emitToolArgDelta(argDelta)
                        }
                      }
                    }
                  }
                }

                // Finish reason
                const finishReason = choice.finish_reason as string
                if (finishReason && finishReason !== 'null') {
                  const anthropicStopReason = finishReason === 'tool_calls' ? 'tool_use' : finishReason
                  controller.enqueue(
                    encoder.encode(
                      formatSSE('message_delta', JSON.stringify({
                        type: 'message_delta',
                        delta: { stop_reason: anthropicStopReason, stop_sequence: null },
                        usage: { output_tokens: outputTokens },
                      })),
                    ),
                  )
                }
              }

              // Usage (from completion event)
              const usage = event.usage as Record<string, number> | undefined
              if (usage) {
                outputTokens = usage.completion_tokens || outputTokens
                inputTokens = usage.prompt_tokens || inputTokens
              }
            }
          }
        }
      } catch (err) {
        if (!currentTextBlockStarted) {
          controller.enqueue(
            encoder.encode(
              formatSSE('content_block_start', JSON.stringify({
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' },
              })),
            ),
          )
          currentTextBlockStarted = true
        }
        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_delta', JSON.stringify({
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: { type: 'text_delta', text: `\n\n[Error: ${String(err)}]` },
            })),
          ),
        )
      }

      // Close any remaining open blocks
      if (currentTextBlockStarted) {
        controller.enqueue(
          encoder.encode(
            formatSSE('content_block_stop', JSON.stringify({
              type: 'content_block_stop',
              index: contentBlockIndex,
            })),
          ),
        )
      }
      if (inToolCall) {
        closeToolCallBlock()
      }

      finishStream(controller, encoder, outputTokens, inputTokens, hadToolCalls)
    },
  })

  function finishStream(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    outputTokens: number,
    inputTokens: number,
    hadToolCalls: boolean,
  ) {
    const stopReason = hadToolCalls ? 'tool_use' : 'end_turn'

    controller.enqueue(
      encoder.encode(
        formatSSE(
          'message_delta',
          JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: outputTokens },
          }),
        ),
      ),
    )
    controller.enqueue(
      encoder.encode(
        formatSSE(
          'message_stop',
          JSON.stringify({
            type: 'message_stop',
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          }),
        ),
      ),
    )
    controller.close()
  }

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': messageId,
    },
  })
}

// ── Main fetch interceptor ──────────────────────────────────────────

/**
 * Creates a fetch function that intercepts Anthropic API calls and routes them to OpenAI.
 * @param apiKey - The OpenAI API key for authentication
 * @param baseURL - The OpenAI base URL
 * @returns A fetch function that translates Anthropic requests to OpenAI format
 */
export function createOpenAIFetch(
  apiKey: string,
  baseURL: string,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)

    // Only intercept Anthropic API message calls
    if (!url.includes('/v1/messages')) {
      return globalThis.fetch(input, init)
    }

    // Parse the Anthropic request body
    let anthropicBody: Record<string, unknown>
    try {
      const bodyText =
        init?.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : typeof init?.body === 'string'
            ? init.body
            : '{}'
      anthropicBody = JSON.parse(bodyText)
    } catch {
      anthropicBody = {}
    }

    // Translate to OpenAI format
    const { openaiBody, openaiModel } = translateToOpenAIBody(anthropicBody)

    // Construct OpenAI URL - baseURL may be like https://cch.fkcodex.com/v1 or https://api.openai.com/v1
    const base = baseURL.replace(/\/$/, '')
    const openaiURL = base.includes('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`

    // Call OpenAI API
    const openaiResponse = await globalThis.fetch(openaiURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiBody),
    })

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text()
      const errorBody = {
        type: 'error',
        error: {
          type: 'api_error',
          message: `OpenAI API error (${openaiResponse.status}): ${errorText}`,
        },
      }
      return new Response(JSON.stringify(errorBody), {
        status: openaiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Translate streaming response
    return translateOpenAIStreamToAnthropic(openaiResponse, openaiModel)
  }
}
