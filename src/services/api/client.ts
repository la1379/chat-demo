import { translate, type TranslationMessage } from '../../i18n/index.js'
import { resizeUploadImage } from '../../utils/resizeUploadImage.js'
import { readMessageEvent } from './parseEvent.js'
import { translateOpenAIStream, type OpenAIChunk } from './openaiCompat.js'
import { toOpenAIRequest } from './openaiRequest.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/**
 * 校验 API Key。
 *
 * 优先用服务商的无费用接口（DeepSeek 的 GET /models）。
 * 没有这个接口的服务商（如百炼）只能发一个 max_tokens=1 的最小请求 ——
 * 会产生极少量费用，但总比「填对 Key 却永远报错」好。
 */
export const verifyApiKey = async (
  apiKey: string,
  signal?: AbortSignal,
  provider?: {
    verify: { kind: 'models'; url: string; header: 'bearer' | 'x-api-key' } | { kind: 'probe'; model: string }
    baseUrl: string
  }
): Promise<void> => {
  const config = provider?.verify ?? {
    kind: 'models' as const,
    url: `${API_ORIGIN}/models`,
    header: 'bearer' as const,
  }
  if (config.kind === 'models') {
    const headers: Record<string, string> =
      config.header === 'bearer' ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey }
    await request(config.url, { method: 'GET', headers, signal })
    return
  }
  // 没有 /models 的服务商：发一个最小请求，能拿到任何合法响应就说明 Key 可用
  const baseUrl = provider?.baseUrl ?? `${API_ORIGIN}/anthropic/v1`
  const response = await request(`${baseUrl}/messages`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
    signal,
  })
  // request() 非 2xx 会抛错，走到这里说明 Key 有效
  await response.json().catch(() => undefined)
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', purpose === null ? await resizeUploadImage(file, signal) : file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

/**
 * 是否引用了 Files API 上传的文件。
 *
 * 只认 source.type === 'file'：内联的 base64 图片不是 Files API 的产物，
 * 带上 anthropic-beta 头反而可能被服务商拒掉。
 */
const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some(
        (block) =>
          (block.type === 'image' || block.type === 'document') && block.source.type === 'file'
      )
  )

/**
 * OpenAI 兼容端点（百炼等）的流式对话。
 *
 * OpenAI 的 SSE 用 `data: {...}` 且以 `data: [DONE]` 收尾，事件名固定为 message；
 * 这里把它翻译成本项目的事件序列，上层代码不需要知道底下是哪家协议。
 */
async function* streamOpenAI(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  baseUrl: string
): AsyncGenerator<MessageStreamEvent> {
  const payload = toOpenAIRequest(body, body.model)
  const response = await request(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  const chunks = (async function* () {
    for await (const { data } of readServerSentEvents(response.body as ReadableStream, signal)) {
      // OpenAI 用哨兵值表示结束，不是事件类型
      if (data.trim() === '[DONE]') {
        return
      }
      try {
        yield JSON.parse(data) as OpenAIChunk
      } catch {
        // 无法解析的块跳过，不因为一个脏块让整段对话失败
      }
    }
  })()

  yield* translateOpenAIStream(chunks, body.model)
}

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  /** Messages 接口前缀；不传就用构建期默认的 DeepSeek 官方 */
  baseUrl: string = ANTHROPIC_BASE_URL,
  /** openai 时走 chat/completions，并把流翻译成同一套事件 */
  protocol: 'anthropic' | 'openai' = 'anthropic'
): AsyncGenerator<MessageStreamEvent> {
  if (protocol === 'openai') {
    yield* streamOpenAI(apiKey, body, signal, baseUrl)
    return
  }
  const response = await request(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
