/**
 * 给 PPT 里内嵌的图形改配色。
 *
 * 核心判断：**这一步不需要任何 AI 模型。**
 * "把橙色图变成蓝色"是色彩空间运算，用生成模型重绘会把图的内容改掉
 * （她的素材、照片、截图都会失真），而这里只改颜色，图还是那张图。
 *
 * 处理两类媒体，安全边界完全不同：
 * - PNG 位图：要逐像素判断「是不是真的算有颜色」，只改单色图
 * - EMF 矢量图：颜色写在 CREATEBRUSHINDIRECT 之类的对象定义里，
 *   只改单色图（画刷/画笔颜色全相同）
 * JPEG 一律跳过：有损再编码会累积失真，而且 pptx 里的照片通常不该换色。
 */
import { unzipSync, zipSync } from 'fflate'
import { hueOf, saturationOf, shiftHue } from './recolor.js'
import type { ColorMapping } from './recolor.js'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
/** EMF 的签名在文件头偏移 40 处，是 ASCII " EMF"（前面一个空格） */
const EMF_SIGNATURE = [0x20, 0x45, 0x4d, 0x46]

const isPng = (data: Uint8Array): boolean =>
  PNG_MAGIC.every((byte, index) => data[index] === byte)

const isEmf = (data: Uint8Array): boolean =>
  data.length > 44 && EMF_SIGNATURE.every((byte, index) => data[40 + index] === byte)

/** 解码后的位图 */
type Bitmap = {
  width: number
  height: number
  /** RGBA，每像素 4 字节 */
  pixels: Uint8Array
}

/**
 * 用浏览器自带的解码器把 PNG 变成像素。
 * 自己实现 PNG 解压要处理全部 filter 类型和位深，得不偿失。
 */
const decodePng = async (bytes: Uint8Array<ArrayBuffer>): Promise<Bitmap> => {
  const blob = new Blob([bytes], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('无法创建绘图上下文')
  }
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return {
    width: imageData.width,
    height: imageData.height,
    pixels: new Uint8Array(imageData.data.buffer),
  }
}

/** 像素编码回 PNG */
const encodePng = async (bitmap: Bitmap): Promise<Uint8Array<ArrayBuffer>> => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建绘图上下文')
  }
  const imageData = new ImageData(
    new Uint8ClampedArray(bitmap.pixels),
    bitmap.width,
    bitmap.height
  )
  ctx.putImageData(imageData, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

type PixelShift = {
  /** 色相平移角度；每个像素按自己的色相统一平移 */
  delta: number
  /** 是否补偿亮度：把因换色系导致的明度变化拉回来 */
  preserveLuminance: boolean
  /** 饱和度阈值，低于它的像素（灰阶、白、黑）不动 */
  minSaturation: number
}

/**
 * 像素的 HSV 饱和度。
 *
 * **不要用 HSL 的 S 做这个判断。** HSL 的 S 是 (max-min)/(2-max-min)，
 * 当 (max+min)/2 接近 1 时分母趋近 0，S 反而趋近 1 ——
 * 实测近白像素 F9FBFF 的 HSL S = 1.000，而它的 HSV S 只有 0.0235。
 * 拿 HSL S 配 minSaturation 当「跳过白底」的闸门，闸门在浅色区完全失效，
 * 一整张白底截图会被当成高饱和图整体染色（实测 48% 像素被改）。
 * HSV 的 S = (max-min)/max 在近白区自然趋近 0，才符合「这几乎没颜色」。
 */
const hsvSaturation = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b) / 255
  if (max === 0) {
    return 0
  }
  const min = Math.min(r, g, b) / 255
  return (max - min) / max
}

/**
 * 逐像素改色相。
 *
 * 只改色相，保留每个像素自己的饱和度与明度层次 ——
 * 这样渐变、阴影、抗锯齿边缘都不会坏。
 * 接近灰阶的像素跳过，否则整张图的文字和线条会被染上颜色。
 */
const shiftBitmap = (bitmap: Bitmap, shift: PixelShift): number => {
  const { pixels } = bitmap
  let changed = 0

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]
    // 全透明的像素不用管
    if (alpha === 0) {
      continue
    }
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]

    // 转 RGB -> HSL
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const light = (max + min) / 2
    const delta = max - min

    if (delta === 0) {
      continue
    }
    // 用 HSV 的 S 判断「是不是真的算有颜色」，理由见 hsvSaturation 的注释
    const sat = max === 0 ? 0 : delta / max
    if (sat < shift.minSaturation) {
      continue
    }

    let hue: number
    if (max === rn) {
      hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6
    } else if (max === gn) {
      hue = ((bn - rn) / delta + 2) / 6
    } else {
      hue = ((rn - gn) / delta + 4) / 6
    }

    let hueDegrees = hue * 360 + shift.delta
    hueDegrees = ((hueDegrees % 360) + 360) % 360
    hue = hueDegrees / 360

    // 记下原始感知亮度，供补偿用
    const originalLuminance = shift.preserveLuminance
      ? 0.2126 * toLinear(rn) + 0.7152 * toLinear(gn) + 0.0722 * toLinear(bn)
      : 0

    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
    const p = 2 * light - q
    let nr = hue2rgb(p, q, hue + 1 / 3)
    let ng = hue2rgb(p, q, hue)
    let nb = hue2rgb(p, q, hue - 1 / 3)

    if (shift.preserveLuminance) {
      // 换色系后蓝光的感知亮度天然更低，整体提亮把观感拉回来
      const newLuminance = 0.2126 * toLinear(nr) + 0.7152 * toLinear(ng) + 0.0722 * toLinear(nb)
      if (newLuminance > 0.001 && originalLuminance > 0.001) {
        const ratio = Math.min(3, Math.max(0.4, Math.sqrt(originalLuminance / newLuminance)))
        nr = Math.min(1, nr * ratio)
        ng = Math.min(1, ng * ratio)
        nb = Math.min(1, nb * ratio)
      }
    }

    pixels[i] = Math.round(nr * 255)
    pixels[i + 1] = Math.round(ng * 255)
    pixels[i + 2] = Math.round(nb * 255)
    changed += 1
  }

  return changed
}

const toLinear = (value: number): number =>
  value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

const hue2rgb = (p: number, q: number, t: number): number => {
  let tt = t
  if (tt < 0) {
    tt += 1
  }
  if (tt > 1) {
    tt -= 1
  }
  if (tt < 1 / 6) {
    return p + (q - p) * 6 * tt
  }
  if (tt < 1 / 2) {
    return q
  }
  if (tt < 2 / 3) {
    return p + (q - p) * (2 / 3 - tt) * 6
  }
  return p
}

/* ------------------------------------------------------------------ *
 * EMF 矢量图换色
 *
 * EMF 里没有像素，颜色写在若干个「对象定义」记录里：
 *   CREATEBRUSHINDIRECT (39)  lbStyle(4) lbColor(4 COLORREF) ...
 *   CREATEPEN           (38)  fnPenStyle(4) nWidth(4) crColor(4)
 *   EXTCREATEPEN        (95)  ... elpPenStyle(4) nWidth(4) crColor(4) ...
 * 之后由 SELECTOBJECT 反复引用同一支画刷/画笔来填充多个路径。
 *
 * 所以「这张图是什么颜色」不用看像素，只看所有对象定义的颜色即可；
 * 「能不能换」的判据也和 PNG 一致：只有一种颜色才换。
 *
 * COLORREF 是 BGR 顺序（0x00BBGGRR），别按 RGB 读。
 * ------------------------------------------------------------------ */

/** EMF 记录里颜色所在的字节偏移（相对记录起点） */
const EMF_COLOR_OFFSETS: Record<number, number> = {
  38: 12, // CREATEPEN: crColor
  39: 16, // CREATEBRUSHINDIRECT: lbColor
  95: 24, // EXTCREATEPEN: crColor
}

export type EmfColorReport = {
  /** 出现过的颜色（大写 RRGGBB，已从 COLORREF 转成 RGB 顺序） */
  colors: string[]
  /** 有几处对象定义引用了颜色；就是「换色时要改几处」 */
  definitions: number
  /** 解析出的记录总数，用于判断文件结构是否正常 */
  records: number
}

/** 扫描 EMF 的对象定义记录，取出所有画刷/画笔颜色 */
export const analyzeEmf = (data: Uint8Array<ArrayBuffer>): EmfColorReport => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // 出现次数不必统计，去重即可 —— 判据是「有几种颜色」
  const seen = new Set<string>()
  let definitions = 0
  let records = 0
  let offset = 0

  while (offset + 8 <= data.length) {
    const type = view.getUint32(offset, true)
    const size = view.getUint32(offset + 4, true)
    // 记录长度至少 8，且不能越界；越界说明这不是我们能安全处理的 EMF
    if (size < 8 || offset + size > data.length) {
      break
    }
    records += 1
    const colorOffset = EMF_COLOR_OFFSETS[type]
    if (colorOffset !== undefined && size >= colorOffset + 4) {
      const colorref = view.getUint32(offset + colorOffset, true)
      // COLORREF 0x00BBGGRR → RRGGBB
      const r = colorref & 0xff
      const g = (colorref >> 8) & 0xff
      const b = (colorref >> 16) & 0xff
      seen.add(
        `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
          .toString(16)
          .padStart(2, '0')}`.toUpperCase()
      )
      definitions += 1
    }
    offset += size
  }

  return { colors: Array.from(seen), definitions, records }
}

/**
 * 把 EMF 里所有对象定义的颜色按色相平移。
 *
 * **不能查表替换。** 矢量图里的颜色和 XML 里写的往往不是同一个色值：
 * 实测这份文件的画刷是 F15C19（橙），而主题里的橙色是 FF6900，
 * 精确匹配一个都换不到。位图那条路本来就是按色相平移的，矢量图照做才对。
 *
 * 只改 COLORREF 那 4 个字节，记录长度和文件长度都不变，
 * 所以不会破坏任何偏移量 —— EMF 里的偏移是绝对地址，长度一变就全废。
 *
 * 返回改了几处；0 表示没有命中的颜色。
 */
export const recolorEmf = (data: Uint8Array<ArrayBuffer>, deltaDegrees: number): number => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let touched = 0
  let offset = 0

  while (offset + 8 <= data.length) {
    const type = view.getUint32(offset, true)
    const size = view.getUint32(offset + 4, true)
    if (size < 8 || offset + size > data.length) {
      break
    }
    const colorOffset = EMF_COLOR_OFFSETS[type]
    if (colorOffset !== undefined && size >= colorOffset + 4) {
      const colorref = view.getUint32(offset + colorOffset, true)
      const r = colorref & 0xff
      const g = (colorref >> 8) & 0xff
      const b = (colorref >> 16) & 0xff
      const hex = `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
        .toString(16)
        .padStart(2, '0')}`.toUpperCase()
      // 灰阶/黑白不动：填白或描黑的对象换了色，整张图会脏掉
      if (saturationOf(hex) < 0.12) {
        offset += size
        continue
      }
      const next = shiftHue(hex, deltaDegrees)
      if (next !== hex) {
        const nr = parseInt(next.slice(0, 2), 16)
        const ng = parseInt(next.slice(2, 4), 16)
        const nb = parseInt(next.slice(4, 6), 16)
        // 写回时仍按 COLORREF 的 BGR 顺序
        view.setUint32(offset + colorOffset, nr | (ng << 8) | (nb << 16), true)
        touched += 1
      }
    }
    offset += size
  }
  return touched
}

export type ImageKind =
  /** 单色或近单色（图标、logo、纯色底）—— 换色安全 */
  | 'flat'
  /** 色彩丰富（照片、复杂插图、多色 logo、截图）—— 整体调色会毁掉它 */
  | 'complex'
  /** 介于两者之间 */
  | 'mixed'

export type ImageProfile = {
  path: string
  bytes: number
  width: number
  height: number
  /** 有彩色像素占比 0-1；越高说明越像照片 */
  vividRatio: number
  /** 有彩色像素里，主色相所占比例；越高说明越接近单色 */
  hueConcentration: number
  /** 占比重够大的色相区间数（每 60 度一桶，阈值 8%）；1 才说明是单色图 */
  significantHues: number
  kind: ImageKind
}

/**
 * 判断一张图属于哪一类。
 *
 * 这是整个图片换色功能的分岔口：
 * 单色图标换色很安全，照片换色就是毁图。
 *
 * **判据只看一件事：这张图是不是只有一种颜色。**
 * 色相桶数 ≤1 才允许换 —— 多色图（品牌 logo、截图、照片）一律不动，
 * 因为色相平移是「所有颜色一起转」，会把 logo 里的红转成青绿、
 * 把截图里的白色底染上色（这两条都在真实文件上实测到过）。
 */
const classify = (vividRatio: number, hueConcentration: number, significantHues: number): ImageKind => {
  // 单色图：颜色足够鲜艳、几乎全压在同一个色相桶里
  if (significantHues <= 1 && hueConcentration >= 0.7 && vividRatio >= 0.2) {
    return 'flat'
  }
  // 有多个显著色相，或颜色太杂 —— 换色必毁
  if (significantHues >= 2 || (vividRatio >= 0.6 && hueConcentration < 0.6)) {
    return 'complex'
  }
  return 'mixed'
}

/** 一个色相桶算「显著」的门槛：占全部有彩色像素的比例 */
const SIGNIFICANT_HUE_SHARE = 0.08
/** 色相桶宽度（度）。60 度一桶，把橙和红分开、不与邻近色混桶 */
const HUE_BUCKET_DEGREES = 60
/** 低于这个 HSV 饱和度的像素不算「有颜色」 */
const VIVID_SATURATION = 0.15
/** 太暗的像素不参与分类：深色文字/阴影在任何色相下都像是「有色」的 */
const VIVID_MIN_VALUE = 0.1

/** 分析一张位图的色彩复杂度（抽样，不遍历全部像素） */
const profileBitmap = async (path: string, bytes: Uint8Array<ArrayBuffer>): Promise<ImageProfile> => {
  const bitmap = await decodePng(bytes)
  const { pixels, width, height } = bitmap
  const total = width * height
  // 大图抽样即可，判断类型不需要每个像素
  const step = Math.max(1, Math.floor(total / 20000))

  let vivid = 0
  let sampled = 0
  const hueBuckets = new Map<number, number>()

  for (let index = 0; index < total; index += step) {
    const i = index * 4
    if (pixels[i + 3] < 16) {
      continue
    }
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const max = Math.max(r, g, b) / 255
    sampled += 1
    if (max < VIVID_MIN_VALUE) {
      continue
    }
    // HSV 的 S；用 HSL 的 S 会让近白像素全被判成高饱和（见 hsvSaturation 注释）
    if (hsvSaturation(r, g, b) < VIVID_SATURATION) {
      continue
    }
    vivid += 1
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const delta = max - Math.min(rn, gn, bn)
    let hue: number
    if (max === rn) {
      hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6
    } else if (max === gn) {
      hue = ((bn - rn) / delta + 2) / 6
    } else {
      hue = ((rn - gn) / delta + 4) / 6
    }
    const bucket = Math.floor((hue * 360) / HUE_BUCKET_DEGREES)
    hueBuckets.set(bucket, (hueBuckets.get(bucket) ?? 0) + 1)
  }

  const vividRatio = sampled > 0 ? vivid / sampled : 0
  const topHue = vivid > 0 ? Math.max(0, ...hueBuckets.values()) : 0
  const hueConcentration = vivid > 0 ? topHue / vivid : 0
  const significantHues =
    vivid > 0
      ? Array.from(hueBuckets.values()).filter((count) => count >= vivid * SIGNIFICANT_HUE_SHARE).length
      : 0

  return {
    path,
    bytes: bytes.length,
    width,
    height,
    vividRatio,
    hueConcentration,
    significantHues,
    kind: classify(vividRatio, hueConcentration, significantHues),
  }
}

export type ImageRecolorResult = {
  /** 改好的 pptx */
  data: Uint8Array<ArrayBuffer>
  /** 实际改了几张图 */
  changed: number
  /** 跳过的图片路径与原因 */
  skipped: { path: string; reason: string }[]
  /** 每张图的分析结果，给界面用 */
  profiles: ImageProfile[]
}

/** 先分析所有图片，让界面能显示"哪些能改、哪些会毁图" */
export const profileImages = async (data: Uint8Array<ArrayBuffer>): Promise<ImageProfile[]> => {
  const files = unzipSync(data)
  const profiles: ImageProfile[] = []
  for (const [name, content] of Object.entries(files)) {
    if (!name.startsWith('ppt/media/') || !isPng(content)) {
      continue
    }
    try {
      profiles.push(await profileBitmap(name, content))
    } catch {
      // 解不开的图就当没看见，不影响其他图
    }
  }
  return profiles.sort((a, b) => b.bytes - a.bytes)
}

/**
 * 给 pptx 里所有能处理的 PNG 换色。
 *
 * 默认只改 flat（单色图标类）。complex 是照片或复杂插图，
 * 整体平移色相会把内容色调搞坏，除非显式要求否则一律跳过。
 *
 * @param mapping 与 XML 共用同一套映射；从映射里推算出整体色相平移量
 * @param options.includeComplex 是否连复杂图像一起改（默认否）
 */
export const recolorImages = async (
  data: Uint8Array<ArrayBuffer>,
  mapping: ColorMapping,
  options: { preserveLuminance?: boolean; minSaturation?: number; includeComplex?: boolean } = {}
): Promise<ImageRecolorResult> => {
  const files = unzipSync(data)
  const skipped: { path: string; reason: string }[] = []
  const profiles: ImageProfile[] = []
  let changed = 0

  // 从映射里找出饱和度最高的一对，用它的色相差作为整体平移量
  let delta = 0
  let bestWeight = 0
  for (const [from, to] of Object.entries(mapping)) {
    const fromHue = hueOf(from)
    const toHue = hueOf(to)
    if (fromHue === null || toHue === null) {
      continue
    }
    let diff = toHue - fromHue
    if (diff > 180) {
      diff -= 360
    }
    if (diff < -180) {
      diff += 360
    }
    const weight = saturationOf(from)
    if (weight > bestWeight) {
      bestWeight = weight
      delta = diff
    }
  }

  if (bestWeight === 0) {
    return { data, changed: 0, skipped, profiles }
  }

  for (const [name, content] of Object.entries(files)) {
    if (!name.startsWith('ppt/media/')) {
      continue
    }

    // ---- EMF 矢量图：颜色在对象定义记录里，不逐像素 ----
    if (isEmf(content)) {
      let report: EmfColorReport
      try {
        report = analyzeEmf(content)
      } catch (error) {
        skipped.push({
          path: name,
          reason: error instanceof Error ? error.message : 'EMF 解析失败',
        })
        continue
      }
      // 和 PNG 同一条判据：只有单色图才换。
      // 多色矢量图（品牌 logo 之类）换色会把内容颜色一起转掉。
      if (report.colors.length > 1) {
        skipped.push({
          path: name,
          reason: `多色矢量图（${report.colors.length} 种颜色），换色会改掉内容`,
        })
        continue
      }
      const touched = recolorEmf(content, delta)
      if (touched === 0) {
        skipped.push({ path: name, reason: '矢量图里没有可换的颜色' })
        continue
      }
      files[name] = content
      changed += 1
      continue
    }

    if (!isPng(content)) {
      skipped.push({ path: name, reason: '非 PNG / EMF 格式，为避免失真而跳过' })
      continue
    }

    let profile: ImageProfile
    try {
      profile = await profileBitmap(name, content)
      profiles.push(profile)
    } catch (error) {
      skipped.push({
        path: name,
        reason: error instanceof Error ? error.message : '解码失败',
      })
      continue
    }

    // 只有单色图才换。
    // complex（照片/多色 logo/截图）和 mixed（说不清）都跳过 ——
    // 色相平移是「所有颜色一起转」，改多色图必然毁内容：
    // 实测一张两色品牌 logo 的红被转成青绿，一张白底截图 48% 像素被染色。
    if (profile.kind !== 'flat' && !options.includeComplex) {
      skipped.push({
        path: name,
        reason:
          profile.kind === 'complex'
            ? `多色图（${profile.significantHues} 个主要色相），换色会改掉内容颜色`
            : '颜色不够单一，换色效果不可控',
      })
      continue
    }

    try {
      const bitmap = await decodePng(content)
      const touched = shiftBitmap(bitmap, {
        delta,
        preserveLuminance: options.preserveLuminance ?? true,
        minSaturation: options.minSaturation ?? 0.15,
      })
      if (touched === 0) {
        skipped.push({ path: name, reason: '图里没有可换的颜色（可能是灰阶图）' })
        continue
      }
      files[name] = await encodePng(bitmap)
      changed += 1
    } catch (error) {
      skipped.push({
        path: name,
        reason: error instanceof Error ? error.message : '编码失败',
      })
    }
  }

  return { data: zipSync(files, { level: 6 }), changed, skipped, profiles }
}
