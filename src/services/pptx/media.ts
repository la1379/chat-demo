/**
 * 检查 pptx 里内嵌图片的颜色。
 *
 * 为什么需要这一步：颜色写在 XML 里的部分可以精确替换，
 * 但图片是二进制，改不了。如果 PPT 的橙色主要来自一张背景大图，
 * 只改 XML 会出现「色块文字都变蓝了，图还是橙的」——比不改更难看。
 *
 * 所以改色前先扫一遍图片：发现可疑的大图有目标色系，就在界面上明确警告，
 * 让人自己决定是继续还是先手动换图。**把不可见的不确定性变成可见的提示。**
 */
import { unzipSync } from 'fflate'

export type MediaColorRisk = {
  /** 文件路径 */
  path: string
  /** 字节数 */
  bytes: number
  /** 判定为「大面积」的图片（可能是背景图或主视觉） */
  prominent: boolean
  /** 能识别格式时给出，用于区分能不能读 */
  readable: boolean
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

const startsWith = (data: Uint8Array, magic: number[]): boolean =>
  magic.every((byte, index) => data[index] === byte)

/** 超过这个体积就认为可能是背景图或主视觉，而不是小图标 */
const PROMINENT_BYTES = 200 * 1024

/**
 * 列出所有内嵌媒体，标出哪些是「改色后可能不一致」的嫌疑对象。
 *
 * 只看元信息，不解码像素 —— 解码全部图片代价太大，
 * 而体积本身已经足够区分「背景大图」和「小图标」。
 */
export const analyzeMedia = (data: Uint8Array): MediaColorRisk[] => {
  const files = unzipSync(data)
  const result: MediaColorRisk[] = []
  for (const [name, content] of Object.entries(files)) {
    if (!name.startsWith('ppt/media/') || content.length === 0) {
      continue
    }
    const readable = startsWith(content, PNG_MAGIC) || startsWith(content, JPEG_MAGIC)
    result.push({
      path: name,
      bytes: content.length,
      prominent: content.length >= PROMINENT_BYTES,
      readable,
    })
  }
  return result.sort((a, b) => b.bytes - a.bytes)
}

/** 汇总成一句人话，给界面直接用 */
export const describeMediaRisk = (media: MediaColorRisk[]): string | null => {
  const prominent = media.filter((item) => item.prominent)
  if (prominent.length === 0) {
    return null
  }
  const totalMB = (prominent.reduce((sum, item) => sum + item.bytes, 0) / 1048576).toFixed(1)
  return `这份 PPT 里有 ${prominent.length} 张大图（共 ${totalMB} MB），很可能是背景图或主视觉。` +
    `图片里的颜色无法自动修改 —— 如果它们本来是主色调，改完会出现「文字和色块变了、图没变」的情况。` +
    `建议先看一眼效果，必要时手动换掉这几张图。`
}
