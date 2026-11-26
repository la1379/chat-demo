/**
 * OpenAI 兼容协议 → 本项目内部事件。
 *
 * 为什么需要这一层：百炼的 Anthropic 兼容层（/apps/anthropic）**不允许浏览器跨域**
 * （预检 OPTIONS 一律 403，没有 Access-Control-Allow-Origin），纯前端调不通。
 * 而它的 OpenAI 兼容层（/compatible-mode/v1）实测 `access-control-allow-origin: *`，
 * 浏览器能直连。所以百炼走这条路，把 OpenAI 的流翻译成本项目认的事件。
 *
 * 只翻译真正用到的部分：文本、思考、停止原因、用量。
 * 工具调用与联网搜索这类扩展，百炼这条路上没有对应实现，遇到就丢弃。
 */

import type {
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'

/** OpenAI 流里的一个 chunk */
export type OpenAIChunk = {
  id?: string
  model?: string
  choices?: {
    index?: number
    delta?: {
      role?: string
      content?: string | null
      /** 部分服务商用 reasoning_content 承载思考过程 */
      reasoning_content?: string | null
      reasoning?: string | null
    }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  } | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** OpenAI 的 finish_reason 映射到本项目的 StopReason */
const mapStopReason = (reason: string | null | undefined): StopReason => {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    default:
      // stop / null / 未知名都当作正常结束，比抛错好
      return 'end_turn'
  }
}

const readUsage = (usage: OpenAIChunk['usage']): MessageUsage | undefined => {
  if (!usage) {
    return undefined
  }
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  return {
    input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: usage.completion_tokens ?? 0,
  } as MessageUsage
}

/**
 * 把一段 OpenAI 流（chunk 序列）翻译成本项目的事件序列。
 *
 * 生成器而不是纯函数：文本是逐段到达的，必须边收边产出，
 * 否则界面上看不到打字效果。
 *
 * 索引约定：思考固定为 block 0，正文固定为 block 1。
 * 这样「先思考后正文」这个顺序能自然表达，也与其他服务商的行为一致。
 */
export async function* translateOpenAIStream(
  chunks: AsyncIterable<OpenAIChunk>,
  fallbackModel: string
): AsyncGenerator<MessageStreamEvent> {
  const THINKING_INDEX = 0
  const TEXT_INDEX = 1
  let started = false
  let thinkingOpen = false
  let textOpen = false
  let stopReason: StopReason = 'end_turn'
  let usage: MessageUsage | undefined
  let model = fallbackModel

  const closeThinking = (): MessageStreamEvent[] => {
    if (!thinkingOpen) {
      return []
    }
    thinkingOpen = false
    return [{ type: 'content_block_stop', index: THINKING_INDEX }]
  }

  for await (const chunk of chunks) {
    if (!isRecord(chunk)) {
      continue
    }
    if (chunk.model) {
      model = chunk.model
    }
    // 第一个 chunk 才发 message_start，之前不知道真实模型名
    if (!started) {
      started = true
      yield { type: 'message_start', message: { id: chunk.id ?? '', model } }
    }
    if (chunk.usage) {
      usage = readUsage(chunk.usage)
    }

    const choice = chunk.choices?.[0]
    if (!choice) {
      continue
    }

    // 思考内容：不同服务商字段名不一致，两个都认
    const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      if (!thinkingOpen) {
        thinkingOpen = true
        yield {
          type: 'content_block_start',
          index: THINKING_INDEX,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield { type: 'content_block_delta', index: THINKING_INDEX, delta: { type: 'thinking_delta', thinking: reasoning } }
    }

    const content = choice.delta?.content
    if (typeof content === 'string' && content.length > 0) {
      // 正文一开始，思考块就该关闭 —— 界面上两者不会并列显示
      for (const event of closeThinking()) {
        yield event
      }
      if (!textOpen) {
        textOpen = true
        yield {
          type: 'content_block_start',
          index: TEXT_INDEX,
          content_block: { type: 'text', text: '' },
        }
      }
      yield { type: 'content_block_delta', index: TEXT_INDEX, delta: { type: 'text_delta', text: content } }
    }

    if (choice.finish_reason) {
      stopReason = mapStopReason(choice.finish_reason)
    }
  }

  // 一个 chunk 都没收到：仍要让上层拿到合法的 message_start + 结束事件，
  // 否则调用方会以为流断了
  if (!started) {
    yield { type: 'message_start', message: { id: '', model } }
  }
  for (const event of closeThinking()) {
    yield event
  }
  if (textOpen) {
    yield { type: 'content_block_stop', index: TEXT_INDEX }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}
