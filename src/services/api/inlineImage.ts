/**
 * 图片内联：不走 Files API，直接把图片编码成 base64 放进消息。
 *
 * 为什么需要：百炼的 Anthropic 兼容层没有 /files（实测 404），
 * 但它有 OpenAI 格式的 /compatible-mode/v1/files —— 也就是说它能传文件，
 * 只是不能沿用 file_id 的引用方式。内联是最省的落地方式：
 * 不用多一次上传请求，也不会在服务端留下孤儿的文件对象。
 *
 * 代价是每轮都要重发图片，token 消耗比 file_id 引用高。所以只对
 * 「必须看图的这一轮」内联，历史轮次的图片按原样带 —— 这是 Anthropic
 * 协议本身的行为，不是这里的选择。
 */

/** 内联图片的上限：太大既费 token 又容易被服务商拒绝 */
const MAX_INLINE_BYTES = 4 * 1024 * 1024

/** 这几个格式各家都认 */
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Blob 转 base64（不含 data: 前缀） */
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('读取图片失败'))
        return
      }
      // FileReader 给的是 data:image/png;base64,xxxx
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })

export type InlineImage = { mediaType: string; data: string }

/**
 * 把一张图片编码成可内联的形式。
 *
 * 返回 null 表示这张图不适合内联（格式不支持或太大）——
 * 调用方应当跳过它，而不是让整个请求失败：一张图不合适
 * 不该把整段对话卡死。
 */
export const toInlineImage = async (blob: Blob, mimeType: string): Promise<InlineImage | null> => {
  if (blob.size > MAX_INLINE_BYTES) {
    return null
  }
  const mediaType = mimeType || blob.type || 'image/png'
  if (!SUPPORTED_TYPES.has(mediaType)) {
    return null
  }
  try {
    return { mediaType, data: await blobToBase64(blob) }
  } catch {
    return null
  }
}
