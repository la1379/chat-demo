/**
 * 在浏览器里读改 pptx 的颜色。
 *
 * .pptx 是一个 zip，颜色写在各个 XML 里，形式是 <a:srgbClr val="RRGGBB"/>。
 * 因此「改配色」= 解压、按映射替换颜色值、重新打包，**文件其余部分一个字节都不动**，
 * 所以内容和排版自动保持不变。
 *
 * 已用真实 107MB / 21 页的 pptx 验证：替换 14 个 XML 后 LibreOffice 仍能完整渲染。
 */
import { unzipSync, zipSync } from 'fflate'

/** 一个颜色的使用统计 */
export type ColorUsage = {
  /** 大写十六进制，不含 # */
  hex: string
  /** 在整个文件里出现多少次 */
  count: number
  /** 出现在哪些 XML 文件里（用于区分主题色还是零散用色） */
  files: string[]
}

/** 颜色的角色，用于给人看懂这个颜色是干什么的 */
export type ColorRole = 'background' | 'text' | 'accent' | 'other'

export type ColorInfo = ColorUsage & {
  role: ColorRole
  /** 相对亮度 0-1，用于判断深浅 */
  luminance: number
}

const XML_ENTRY = /\.(xml|rels)$/i
const SRGB = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/g
/** 系统色，形如 <a:sysClr val="window" lastClr="FFFFFF"/>；lastClr 才是实际颜色 */
const SYSCLR = /<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/g
/** 预设色，形如 <a:prstClr val="orange"/> */
const PRSTCLR = /<a:prstClr\b[^>]*\bval="(\w+)"/g

/** 常见预设色的 RGB，用于把 prstClr 也纳入统计与替换 */
const PRESET_RGB: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  orange: 'FFA500',
  purple: '800080',
  silver: 'C0C0C0',
  maroon: '800000',
  navy: '000080',
  teal: '008080',
  lime: '00FF00',
  aqua: '00FFFF',
  fuchsia: 'FF00FF',
  olive: '808000',
}

/** 两个色相之间的最短角距（0-180） */
const hueDistance = (a: number, b: number): number => {
  const raw = Math.abs(a - b) % 360
  return raw > 180 ? 360 - raw : raw
}

/** 颜色色相（度）；无彩色返回 null */
export const hueOf = (hex: string): number | null => {
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) {
    return null
  }
  let h: number
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6
  } else {
    h = ((r - g) / d + 4) / 6
  }
  return Math.round(h * 360)
}

/** 十六进制转相对亮度（WCAG 公式），用于区分深色/浅色 */
export const luminanceOf = (hex: string): number => {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = channel(parseInt(hex.slice(0, 2), 16))
  const g = channel(parseInt(hex.slice(2, 4), 16))
  const b = channel(parseInt(hex.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 饱和度（HSL 的 S），用来区分鲜艳的强调色和灰阶 */
export const saturationOf = (hex: string): number => {
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  if (max === min) {
    return 0
  }
  return light > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}

/** 判断颜色在 PPT 里的角色，只做粗略分类，用于界面分组 */
export const roleOf = (hex: string): ColorRole => {
  const lum = luminanceOf(hex)
  const sat = saturationOf(hex)
  // 接近纯白/纯黑且几乎无饱和度 → 背景或文字
  if (lum > 0.9 && sat < 0.12) {
    return 'background'
  }
  if (lum < 0.08 && sat < 0.2) {
    return 'text'
  }
  if (sat > 0.25) {
    return 'accent'
  }
  return 'other'
}

/** 从 pptx 字节里统计所有色值（直接色值 + 系统色 + 预设色） */
export const analyzeColors = (data: Uint8Array<ArrayBuffer>): ColorInfo[] => {
  const files = unzipSync(data)
  const counter = new Map<string, { count: number; files: Set<string> }>()

  const bump = (hex: string, name: string) => {
    const entry = counter.get(hex) ?? { count: 0, files: new Set<string>() }
    entry.count += 1
    entry.files.add(name)
    counter.set(hex, entry)
  }

  for (const [name, content] of Object.entries(files)) {
    if (!XML_ENTRY.test(name)) {
      continue
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content)

    // 直接色值；每次匹配都要重置 lastIndex，正则带 g 时复用会漏
    SRGB.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SRGB.exec(text)) !== null) {
      bump(match[1].toUpperCase(), name)
    }

    // 系统色取 lastClr 作为实际颜色
    SYSCLR.lastIndex = 0
    while ((match = SYSCLR.exec(text)) !== null) {
      bump(match[1].toUpperCase(), name)
    }

    // 预设色换算成 RGB
    PRSTCLR.lastIndex = 0
    while ((match = PRSTCLR.exec(text)) !== null) {
      const rgb = PRESET_RGB[match[1].toLowerCase()]
      if (rgb) {
        bump(rgb, name)
      }
    }
  }

  return Array.from(counter.entries())
    .map(([hex, entry]) => ({
      hex,
      count: entry.count,
      files: Array.from(entry.files),
      role: roleOf(hex),
      luminance: luminanceOf(hex),
    }))
    .sort((a, b) => b.count - a.count)
}

/** 改色方案：原色 -> 新色 */
export type ColorMapping = Record<string, string>

/** 主题里一个语义槽位，如 accent1 / dk2 */
export type ThemeSlot = {
  /** 槽位名，如 accent1 */
  slot: string
  /** 当前颜色 */
  hex: string
  /** 一共被正文引用了多少次；次数越高，改它影响面越大 */
  references: number
}

/** 主题槽位的中文名，给界面用 */
export const THEME_SLOT_LABELS: Record<string, string> = {
  dk1: '深色文字 1',
  lt1: '浅色背景 1',
  dk2: '深色文字 2',
  lt2: '浅色背景 2',
  accent1: '主色 1',
  accent2: '主色 2',
  accent3: '主色 3',
  accent4: '主色 4',
  accent5: '主色 5',
  accent6: '主色 6',
  hlink: '超链接',
  folHlink: '已访问链接',
}

/** 从 theme 文件读出全部语义槽位，并统计每个槽位在正文里的引用次数 */
export const analyzeTheme = (data: Uint8Array<ArrayBuffer>): ThemeSlot[] => {
  const files = unzipSync(data)

  // 先统计 schemeClr 在各处被引用的次数（排除 theme 自身）
  const refs = new Map<string, number>()
  const schemeRe = /<a:schemeClr\b[^>]*\bval="(\w+)"/g
  for (const [name, content] of Object.entries(files)) {
    if (!XML_ENTRY.test(name) || name.includes('/theme/')) {
      continue
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content)
    schemeRe.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = schemeRe.exec(text)) !== null) {
      refs.set(match[1], (refs.get(match[1]) ?? 0) + 1)
    }
  }

  // 再从第一个 theme 文件读槽位定义
  const slots: ThemeSlot[] = []
  for (const [name, content] of Object.entries(files)) {
    if (!name.includes('/theme/') || !name.endsWith('.xml')) {
      continue
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content)
    for (const slotName of Object.keys(THEME_SLOT_LABELS)) {
      // 槽位内部可能是 <a:srgbClr val="..."> 或 <a:sysClr lastClr="...">
      const block = new RegExp(`<a:${slotName}>(.*?)</a:${slotName}>`, 's').exec(text)
      if (!block) {
        continue
      }
      const srgb = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(block[1])
      const sys = /<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/.exec(block[1])
      const hex = (srgb?.[1] ?? sys?.[1])?.toUpperCase()
      if (!hex) {
        continue
      }
      slots.push({
        slot: slotName,
        hex,
        references: refs.get(slotName) ?? 0,
      })
    }
    // 一个演示文稿的配色以第一套主题为准，多余的主题不重复列
    if (slots.length > 0) {
      break
    }
  }
  return slots
}

/**
 * 按映射替换颜色并重新打包。
 *
 * 同时覆盖三种写法，且都只匹配精确的完整色值，不做子串替换 ——
 * 否则 "FF00" 会误伤 "FF00FF" 这类颜色。
 * 1. <a:srgbClr val="RRGGBB"/>        直接色值（绝大多数）
 * 2. <a:sysClr lastClr="RRGGBB"/>     系统色
 * 3. <a:prstClr val="orange"/>        预设色，换成 srgbClr 表达
 */
export const applyColorMapping = (
  data: Uint8Array<ArrayBuffer>,
  mapping: ColorMapping
): Uint8Array<ArrayBuffer> => {
  const files = unzipSync(data)
  // 统一成大写，避免大小写不一致导致漏改
  const normalized = new Map<string, string>()
  for (const [from, to] of Object.entries(mapping)) {
    const key = from.replace('#', '').toUpperCase()
    const value = to.replace('#', '').toUpperCase()
    if (key.length === 6 && value.length === 6 && key !== value) {
      normalized.set(key, value)
    }
  }
  if (normalized.size === 0) {
    return data
  }

  const patterns = Array.from(normalized.keys()).join('|')
  const srgbRe = new RegExp(`<a:srgbClr\\b([^>]*?)\\bval="(${patterns})"`, 'gi')
  const sysRe = new RegExp(`<a:sysClr\\b([^>]*?)\\blastClr="(${patterns})"`, 'gi')

  // 预设色：先把名字映射成 RGB，若该 RGB 在改动范围内就换掉整个标签
  const presetEntries = Object.entries(PRESET_RGB)

  for (const [name, content] of Object.entries(files)) {
    if (!XML_ENTRY.test(name)) {
      continue
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content)
    let next = text

    srgbRe.lastIndex = 0
    if (srgbRe.test(next)) {
      srgbRe.lastIndex = 0
      next = next.replace(srgbRe, (_all, attrs: string, hex: string) => {
        const mapped = normalized.get(hex.toUpperCase())
        return `<a:srgbClr${attrs}val="${mapped ?? hex}"`
      })
    }

    sysRe.lastIndex = 0
    if (sysRe.test(next)) {
      sysRe.lastIndex = 0
      next = next.replace(sysRe, (all, attrs: string, hex: string) => {
        const mapped = normalized.get(hex.toUpperCase())
        return mapped ? `<a:sysClr${attrs}lastClr="${mapped}"` : all
      })
    }

    for (const [presetName, rgb] of presetEntries) {
      const mapped = normalized.get(rgb)
      if (!mapped) {
        continue
      }
      // 预设色没有 RGB 属性，只能换掉整个标签
      const presetRe = new RegExp(`<a:prstClr\\b[^>]*\\bval="${presetName}"[^>]*/>`, 'gi')
      next = next.replace(presetRe, `<a:srgbClr val="${mapped}"/>`)
    }

    // 只有真的变了才写回，避免无谓的内存拷贝
    if (next !== text) {
      files[name] = new TextEncoder().encode(next)
    }
  }

  return zipSync(files, { level: 6 })
}

/**
 * 把整套配色整体平移：保留原来的明暗关系和鲜艳程度，只换色相。
 *
 * 做法是把每个颜色转 HSL，只改 H（色相），S 和 L 基本保留。
 * 这样「紫色系 → 蓝色系」能保持原有的层次，不会全糊成一片。
 */
export const shiftHue = (hex: string, deltaDegrees: number): string => {
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = light > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    } else if (max === g) {
      h = ((b - r) / d + 2) / 6
    } else {
      h = ((r - g) / d + 4) / 6
    }
  }

  // 色相平移后回绕到 [0, 360)。注意 JS 里负数取模仍为负，必须先归一化再转回 0-1
  let hueDegrees = h * 360 + deltaDegrees
  hueDegrees = ((hueDegrees % 360) + 360) % 360
  h = hueDegrees / 360

  const hue2rgb = (p: number, q: number, t: number) => {
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

  let outR = light
  let outG = light
  let outB = light
  if (s !== 0) {
    const q = light < 0.5 ? light * (1 + s) : light + s - light * s
    const p = 2 * light - q
    outR = hue2rgb(p, q, h + 1 / 3)
    outG = hue2rgb(p, q, h)
    outB = hue2rgb(p, q, h - 1 / 3)
  }

  const toHex = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()

  return toHex(outR) + toHex(outG) + toHex(outB)
}

/**
 * 生成一套「整体换色相」的映射，保留白色与近黑色不动。
 * 背景和文字通常是无彩色的，改它们只会让文件看起来坏掉。
 *
 * @param lockHexes  不参与改动的颜色（如品牌主色），大小写不敏感
 * @param nearHue    若给出，颜色本身的色相已经离它很近时跳过，避免把对的颜色转坏
 */
export const buildHueShiftMapping = (
  colors: ColorInfo[],
  deltaDegrees: number,
  lockHexes: string[] = [],
  nearHue?: number
): ColorMapping => {
  const locked = new Set(lockHexes.map((hex) => hex.replace('#', '').toUpperCase()))
  const mapping: ColorMapping = {}
  for (const color of colors) {
    const hex = color.hex.toUpperCase()
    if (locked.has(hex)) {
      continue
    }
    const sat = saturationOf(hex)
    // 灰阶、纯白、近黑保持原样
    if (sat < 0.12) {
      continue
    }
    // 已经在目标色相附近，说明它本来就对，不要动
    if (nearHue !== undefined) {
      const hue = hueOf(hex)
      if (hue !== null && hueDistance(hue, nearHue) <= 20) {
        continue
      }
    }
    const next = shiftHue(hex, deltaDegrees)
    if (next !== hex) {
      mapping[hex] = next
    }
  }
  return mapping
}



/** 预设配色：把色相拉到目标区间，供界面上一键选用 */
export type PalettePreset = {
  id: string
  label: string
  /** 目标色相（度） */
  hue: number
}

export const PALETTE_PRESETS: PalettePreset[] = [
  { id: 'navy', label: '商务藏蓝', hue: 215 },
  { id: 'teal', label: '沉稳青绿', hue: 180 },
  { id: 'wine', label: '庄重酒红', hue: 350 },
  { id: 'slate', label: '中性灰蓝', hue: 205 },
]

/**
 * 把整套配色「拉向」一个目标色相：每个颜色平移相同的角度差，
 * 保持原有深浅层次，但整体色系统一。
 *
 * 挑主导色时不能只看出现次数 —— 背景色往往次数最多却毫无视觉存在感。
 * 这里按「次数 × 饱和度²」打分，让真正显眼的品牌色胜出。
 *
 * 已经落在目标色相附近的颜色会被跳过：它们本来就对，再转反而转坏。
 */
export const buildPaletteMapping = (
  colors: ColorInfo[],
  targetHue: number,
  lockHexes: string[] = []
): ColorMapping => {
  const locked = new Set(lockHexes.map((hex) => hex.replace('#', '').toUpperCase()))
  const candidates = colors
    .filter((color) => !locked.has(color.hex.toUpperCase()))
    .filter((color) => saturationOf(color.hex) >= 0.35)
  if (candidates.length === 0) {
    return {}
  }

  // 次数 × 饱和度的平方：饱和度更能代表"存在感"，平方强化这一倾向
  const score = (color: ColorInfo) => color.count * saturationOf(color.hex) ** 2
  const primary = candidates.sort((a, b) => score(b) - score(a))[0]
  const currentHue = hueOf(primary.hex)
  if (currentHue === null) {
    return {}
  }

  let delta = targetHue - currentHue
  // 取最短旋转方向，避免大幅绕圈导致中间色失真
  if (delta > 180) {
    delta -= 360
  }
  if (delta < -180) {
    delta += 360
  }
  return buildHueShiftMapping(colors, delta, lockHexes, targetHue)
}
