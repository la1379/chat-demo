/**
 * 消息构造验证页（不进构建产物）：确认内联图片会被正确塞进请求体。
 */
import { toRequestMessages } from '../src/services/chat/reply.js'
import type { UserMessage } from '../src/services/chat/types.js'

const mkUser = (text: string, files: UserMessage['files']): UserMessage => ({
  id: 'u1', role: 'user', content: text, files, createdAt: 0,
} as unknown as UserMessage)

const results: string[] = []

// 1) 内联：本轮有一张图
const question = mkUser('这张图是什么？', [
  { id: 'f1', serverId: null, name: 'a.png', size: 100, isImage: true, mimeType: 'image/png' },
] as UserMessage['files'])
const inline = new Map([['f1', { mediaType: 'image/png', data: 'AAAA' }]])
const withInline = toRequestMessages([], question, undefined, false, undefined, inline)
const blocks = withInline[0].content
results.push('内联模式 -> ' + JSON.stringify(blocks))

// 2) 不带内联、也没 serverId：这块应当被丢掉
const withoutInline = toRequestMessages([], question, undefined, false, undefined, undefined)
results.push('无内联无 serverId -> ' + JSON.stringify(withoutInline[0].content))

// 3) file_id 模式（官方）
const withFileId = toRequestMessages(
  [],
  mkUser('图', [{ id: 'f2', serverId: 'file-abc', name: 'b.jpg', size: 10, isImage: true, mimeType: 'image/jpeg' }] as UserMessage['files']),
  undefined, false, undefined, undefined,
)
results.push('file_id 模式 -> ' + JSON.stringify(withFileId[0].content))

const el = document.getElementById('root')
if (el) {
  el.style.cssText = 'font: 12px/1.7 ui-monospace, monospace; padding: 20px; white-space: pre-wrap'
  el.textContent = results.join('\n\n')
}
;(window as unknown as Record<string, unknown>).__results = results
document.title = 'message-probe-ready'
