/**
 * OpenAI 兼容层验证页（不进构建产物）。
 *
 * 分两段：
 * 1. 请求体转换：本项目格式 → OpenAI 格式
 * 2. 流翻译：OpenAI chunk 序列 → 本项目事件序列
 *
 * 用真实的 chunk 形状（百炼/DeepSeek 的 OpenAI 兼容模式产出的样子），
 * 不走网络也能证明映射正确。
 */
import { toOpenAIRequest } from '../src/services/api/openaiRequest.js'
import { translateOpenAIStream, type OpenAIChunk } from '../src/services/api/openaiCompat.js'
import type { CreateMessageRequest } from '../src/services/api/types.js'

const results: string[] = []

const baseRequest = (messages: CreateMessageRequest['messages']): CreateMessageRequest => ({
  model: 'deepseek-v4-flash-1017',
  system: '你是助手',
  messages,
  thinking: { type: 'disabled' },
  tools: [],
  safety_check: { level: 'high' },
})

const run = async () => {
  // ---------- 1. 请求体转换 ----------
  const req = toOpenAIRequest(
    baseRequest([
      { role: 'latest_reminder', content: '当前时间 2026-11-26' },
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          { type: 'text', text: '这张图是什么' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: '是一张截图' }] },
      { role: 'user', content: '再说说' },
    ]),
    'deepseek-v4-flash-1017'
  )
  results.push('【请求体】')
  results.push(JSON.stringify(req, null, 1))

  // ---------- 2. 流翻译：思考 + 正文 ----------
  const chunks: OpenAIChunk[] = [
    { id: 'req-1', model: 'deepseek-v4-flash-1017', choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { reasoning_content: '先想想…' } }] },
    { choices: [{ delta: { reasoning_content: '想好了。' } }] },
    { choices: [{ delta: { content: '这是' } }] },
    { choices: [{ delta: { content: '一段回答。' } }] },
    {
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } },
    },
  ]

  async function* gen() {
    for (const chunk of chunks) {
      yield chunk
    }
  }

  results.push('')
  results.push('【流翻译】')
  for await (const event of translateOpenAIStream(gen(), 'fallback')) {
    results.push(JSON.stringify(event))
  }

  // ---------- 3. 边界：空流 ----------
  async function* empty() {}
  results.push('')
  results.push('【空流】')
  for await (const event of translateOpenAIStream(empty(), 'fallback')) {
    results.push(JSON.stringify(event))
  }

  const el = document.getElementById('root')
  if (el) {
    el.style.cssText = 'font: 11px/1.6 ui-monospace, monospace; padding: 16px; white-space: pre-wrap'
    el.textContent = results.join('\n')
  }
  ;(window as unknown as Record<string, unknown>).__results = results
  document.title = 'openai-probe-ready'
}

void run()
