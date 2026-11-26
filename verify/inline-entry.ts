/**
 * 内联图片验证页（不进构建产物）。
 *
 * 内联上传不经过网络就能测：编码一张图 → 检查生成的块结构。
 * 真正能否被百炼接受要靠真 Key，这里只能证明「结构对、该跳过的不硬塞」。
 */
import { createRoot } from 'react-dom/client'
import { toInlineImage } from '../src/services/api/inlineImage.js'

const results: string[] = []
const log = (line: string) => {
  results.push(line)
}

/** 造一张指定 MIME、指定大小的假图 */
const fakeImage = (type: string, bytes: number): Blob => {
  const buffer = new Uint8Array(bytes)
  // PNG 头，让内容看起来像真图
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Blob([buffer], { type })
}

const run = async () => {
  // 1) 正常 PNG
  const png = await toInlineImage(fakeImage('image/png', 1024), 'image/png')
  log(`PNG 1KB -> ${png ? 'mediaType=' + png.mediaType + ', data 长度=' + png.data.length : 'null'}`)
  log(`  纯 base64（无 data: 前缀）= ${png !== null && !png.data.startsWith('data:')}`)

  // 2) JPEG
  const jpg = await toInlineImage(fakeImage('image/jpeg', 2048), 'image/jpeg')
  log(`JPEG 2KB -> ${jpg ? jpg.mediaType : 'null'}`)

  // 3) 超大图应当跳过
  const big = await toInlineImage(fakeImage('image/png', 5 * 1024 * 1024), 'image/png')
  log(`PNG 5MB -> ${big === null ? 'null（超限，正确跳过）' : '未跳过（错）'}`)

  // 4) 不支持的格式应当跳过
  const tiff = await toInlineImage(fakeImage('image/tiff', 1024), 'image/tiff')
  log(`TIFF -> ${tiff === null ? 'null（格式不支持，正确跳过）' : '未跳过（错）'}`)

  // 5) mimeType 为空时回退到 blob.type
  const fallback = await toInlineImage(fakeImage('image/webp', 512), '')
  log(`空 mimeType + blob.type=webp -> ${fallback ? fallback.mediaType : 'null'}`)

  const el = document.getElementById('root')
  if (el) {
    el.style.cssText = 'font: 13px/1.7 ui-monospace, monospace; padding: 20px; white-space: pre-wrap'
    el.textContent = results.join('\n')
  }
  ;(window as unknown as Record<string, unknown>).__results = results
  document.title = 'inline-probe-ready'
}

createRoot(document.getElementById('root') as HTMLElement).render(null)
void run()
