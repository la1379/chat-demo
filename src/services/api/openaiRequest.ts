/**
 * 把本项目的请求体翻译成 OpenAI 的 chat/completions 格式。
 *
 * 只做必要的映射，不追求覆盖全部能力：
 * - system 字符串 → 一条 system 消息
 * - user 的 text / image 块 → OpenAI 的 content 数组（图片走 image_url + data URL）
 * - assistant 的 text 块 → 一条 assistant 消息（思考块不回传，各家行为不一致）
 * - latest_reminder 是 Chat Engine 的扩展角色，OpenAI 没有 → 并进下一条 user 的正文
 * - thinking / safety_check / tools 是 DeepSeek 扩展 → 不下发
 *
 * 不支持的块直接丢，不让整段对话因为一个陌生块失败。
 */

import type { CreateMessageRequest, FileBlockParam, MessageParam, TextBlockParam } from './types.js'

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string }

const fileToPart = (block: FileBlockParam): OpenAIContentPart | null => {
  if (block.type !== 'image') {
    // 文档内联各家支持不一，这条路上不尝试
    return null
  }
  if (block.source.type === 'base64') {
    return {
      type: 'image_url',
      image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
    }
  }
  // file_id 是 Anthropic Files API 的产物，OpenAI 这边没有对应概念
  return null
}

const userContent = (
  content: string | (FileBlockParam | TextBlockParam)[],
  carry: string
): string | OpenAIContentPart[] => {
  const prefix = carry ? `${carry}\n\n` : ''
  if (typeof content === 'string') {
    return prefix + content
  }
  const parts: OpenAIContentPart[] = []
  for (const block of content) {
    if (block.type === 'text') {
      const text = prefix + block.text
      if (text.trim()) {
        parts.push({ type: 'text', text })
      }
      continue
    }
    const part = fileToPart(block)
    if (part) {
      parts.push(part)
    }
  }
  // 只有一张图、没有文字时，补上 carry（如果有），否则是空数组
  if (prefix && !parts.some((part) => part.type === 'text')) {
    parts.push({ type: 'text', text: carry })
  }
  return parts.length > 0 ? parts : prefix
}

/** 正文块的文字拼起来；思考块不回传 */
const assistantText = (blocks: Extract<MessageParam, { role: 'assistant' }>['content']): string =>
  blocks
    .filter((block): block is TextBlockParam => block.type === 'text')
    .map((block) => block.text)
    .join('')

export type OpenAIRequest = {
  model: string
  messages: OpenAIMessage[]
  stream: true
  stream_options: { include_usage: true }
  max_tokens?: number
}

/**
 * 转换请求体。
 *
 * `latest_reminder` 不是 OpenAI 的角色，但内容不能丢 —— 它是「当前时间/位置」
 * 这类信息，并进紧随其后的那条 user 消息里最自然。
 */
export const toOpenAIRequest = (
  body: CreateMessageRequest,
  model: string,
  maxTokens?: number
): OpenAIRequest => {
  const messages: OpenAIMessage[] = []
  if (body.system.trim()) {
    messages.push({ role: 'system', content: body.system })
  }

  let carry = ''
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      carry = carry ? `${carry}\n${message.content}` : message.content
      continue
    }
    if (message.role === 'user') {
      messages.push({ role: 'user', content: userContent(message.content, carry) })
      carry = ''
      continue
    }
    const text = assistantText(message.content).trim()
    // 空的 assistant 消息会让部分服务商报错，直接跳过
    if (text) {
      messages.push({ role: 'assistant', content: text })
    }
  }
  // 末尾剩的 carry 没有对应的 user，单独补一条，别丢
  if (carry) {
    messages.push({ role: 'user', content: carry })
  }

  return {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  }
}
