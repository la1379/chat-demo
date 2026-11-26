/**
 * 改配色引擎的浏览器验证入口（不进构建产物）。
 *
 * 为什么需要独立入口：改配色跑在浏览器 API 上（Blob / OffscreenCanvas /
 * createImageBitmap），Node 里走不了同一条代码路径。Python 侧的等效实现只能
 * 证明算法思路成立，证明不了交付给用户的这份 TS 产物能跑。
 *
 * 用法见 verify/README.md。
 */
import {
  analyzeColors,
  analyzeTheme,
  applyColorMapping,
  buildPaletteMapping,
} from '../src/services/pptx/recolor.js'
import { analyzeMedia } from '../src/services/pptx/media.js'
import { profileImages, recolorImages } from '../src/services/pptx/imageRecolor.js'

const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(out)
}

const g = globalThis as unknown as Record<string, unknown>

/**
 * 在页面里跑一遍「读 pptx → 平移色相 → 回写 zip」的完整流程。
 * 返回结果里带 outB64，调用方据此落盘，再用 LibreOffice / PowerPoint 复查。
 */
g.__runRecolor = async (b64: string, targetHue: number, withImages: boolean) => {
  const bin = atob(b64)
  const raw = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) {
    raw[i] = bin.charCodeAt(i)
  }

  const colors = analyzeColors(raw)
  const theme = analyzeTheme(raw)
  const media = analyzeMedia(raw)
  const mapping = buildPaletteMapping(colors, targetHue, [])

  let out = applyColorMapping(raw, mapping)
  let images = {
    changed: 0,
    skipped: [] as { path: string; reason: string }[],
    profiles: [] as unknown[],
  }
  if (withImages) {
    const profiles = await profileImages(out)
    const result = await recolorImages(out, mapping)
    out = result.data
    images = { changed: result.changed, skipped: result.skipped, profiles }
  }

  return {
    beforeCount: colors.length,
    mappingSize: Object.keys(mapping).length,
    themeSlots: theme.length,
    mediaRisks: media.length,
    afterCount: analyzeColors(out).length,
    images,
    outSize: out.length,
    outB64: toBase64(out),
  }
}

document.title = 'recolor-probe-ready'
