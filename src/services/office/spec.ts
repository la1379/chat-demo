/**
 * 报表 / PPT 的结构化大纲。
 *
 * 模型不写程序、也不直接生成二进制，只输出这份受约束的 JSON；
 * 真正的排版由前端完成。这样输出天然可校验，出错时也能退回显示原文。
 */

/** 单元格值的呈现方式 */
export type CellType = 'text' | 'number' | 'currency' | 'percent' | 'date'

export type Column = {
  title: string
  type?: CellType
}

/** 一行单元格；值可以是字符串或数字 */
export type Row = (string | number | null)[]

export type SheetSpec = {
  name: string
  columns: Column[]
  rows: Row[]
  /** 末尾自动加一行合计（数值列求和），比让模型自己写公式可靠 */
  totalRow?: boolean
  /** 列宽（字符数），缺省按内容自适应 */
  widths?: number[]
}

export type WorkbookSpec = {
  filename?: string
  title?: string
  sheets: SheetSpec[]
}

export type SlideLayout = 'title' | 'section' | 'bullets' | 'table' | 'twoColumn' | 'closing'

export type SlideSpec = {
  layout?: SlideLayout
  title?: string
  subtitle?: string
  bullets?: string[]
  columns?: Column[]
  rows?: Row[]
  /** twoColumn 布局的左右两栏，各是一组要点 */
  left?: { heading?: string; bullets: string[] }
  right?: { heading?: string; bullets: string[] }
  /** 演讲备注 */
  notes?: string
}

export type DeckSpec = {
  filename?: string
  title?: string
  subtitle?: string
  slides: SlideSpec[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const strOrUndef = (value: unknown): string | undefined => {
  const text = str(value).trim()
  return text ? text : undefined
}

const CELL_TYPES = new Set<CellType>(['text', 'number', 'currency', 'percent', 'date'])

/** 模型偶尔把类型写成 "金额"、"数字" 这类中文，统一映射回标准值 */
const normalizeCellType = (value: unknown): CellType => {
  const raw = str(value).trim().toLowerCase()
  if (CELL_TYPES.has(raw as CellType)) {
    return raw as CellType
  }
  if (/金额|货币|价格|薪|工资|元/.test(raw)) {
    return 'currency'
  }
  if (/百分|比率|比例|率/.test(raw)) {
    return 'percent'
  }
  if (/日期|时间/.test(raw)) {
    return 'date'
  }
  if (/数|值|量/.test(raw)) {
    return 'number'
  }
  return 'text'
}

const toRow = (value: unknown): Row => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((cell) => {
    if (cell === null || cell === undefined) {
      return null
    }
    if (typeof cell === 'number') {
      return Number.isFinite(cell) ? cell : null
    }
    if (typeof cell === 'boolean') {
      return cell ? '是' : '否'
    }
    if (typeof cell === 'string') {
      return cell
    }
    // 嵌套结构退化成 JSON 文本，至少不丢信息
    return JSON.stringify(cell)
  })
}

const toColumns = (value: unknown): Column[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((column) => {
    // 允许 "列名" 或 { title, type } 两种写法
    if (typeof column === 'string') {
      return { title: column, type: 'text' as CellType }
    }
    if (isObject(column)) {
      return {
        title: str(column.title ?? column.name ?? column.列名).trim() || '未命名',
        type: normalizeCellType(column.type ?? column.类型),
      }
    }
    return { title: String(column ?? ''), type: 'text' as CellType }
  })
}

/**
 * 校验并归一化报表大纲。返回 null 表示结构不可用，调用方应退回显示原文，
 * 绝不能让一段畸形 JSON 把整个对话渲染搞崩。
 */
export const parseWorkbookSpec = (input: string): WorkbookSpec | null => {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch {
    return null
  }
  if (!isObject(raw)) {
    return null
  }
  const list = Array.isArray(raw.sheets) ? raw.sheets : []
  const sheets: SheetSpec[] = []
  for (const item of list) {
    if (!isObject(item)) {
      continue
    }
    const columns = toColumns(item.columns)
    const rows = (Array.isArray(item.rows) ? item.rows : []).map(toRow)
    // 没有任何列也没有任何行，视为无效表
    if (columns.length === 0 && rows.length === 0) {
      continue
    }
    const widths = Array.isArray(item.widths)
      ? item.widths.map((width) => Number(width)).filter((width) => Number.isFinite(width) && width > 0)
      : undefined
    sheets.push({
      name: strOrUndef(item.name ?? item.标题) ?? `工作表 ${sheets.length + 1}`,
      columns,
      rows,
      totalRow: item.totalRow === true || item.total === true,
      widths: widths && widths.length > 0 ? widths : undefined,
    })
  }
  if (sheets.length === 0) {
    return null
  }
  return {
    filename: strOrUndef(raw.filename),
    title: strOrUndef(raw.title),
    sheets,
  }
}

const LAYOUTS = new Set<SlideLayout>(['title', 'section', 'bullets', 'table', 'twoColumn', 'closing'])

const normalizeLayout = (value: unknown, hasTable: boolean): SlideLayout => {
  const raw = str(value).trim().toLowerCase()
  if (LAYOUTS.has(raw as SlideLayout)) {
    return raw as SlideLayout
  }
  const zh = str(value)
  if (/封面|标题页/.test(zh)) {
    return 'title'
  }
  if (/章节|过渡/.test(zh)) {
    return 'section'
  }
  if (/表格|数据/.test(zh)) {
    return 'table'
  }
  if (/结尾|结束|感谢/.test(zh)) {
    return 'closing'
  }
  if (hasTable) {
    return 'table'
  }
  return 'bullets'
}

const toBullets = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim()
      }
      if (isObject(item)) {
        return str(item.text ?? item.内容 ?? item.title).trim()
      }
      return String(item ?? '').trim()
    })
    .filter(Boolean)
}

const toSide = (value: unknown): { heading?: string; bullets: string[] } | undefined => {
  if (!isObject(value)) {
    return undefined
  }
  const bullets = toBullets(value.bullets ?? value.items ?? value.内容)
  if (bullets.length === 0 && !strOrUndef(value.heading)) {
    return undefined
  }
  return { heading: strOrUndef(value.heading ?? value.title), bullets }
}

/** 校验并归一化 PPT 大纲；失败返回 null。 */
export const parseDeckSpec = (input: string): DeckSpec | null => {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch {
    return null
  }
  if (!isObject(raw)) {
    return null
  }
  const list = Array.isArray(raw.slides) ? raw.slides : []
  const slides: SlideSpec[] = []
  for (const item of list) {
    if (!isObject(item)) {
      continue
    }
    const columns = toColumns(item.columns)
    const rows = (Array.isArray(item.rows) ? item.rows : []).map(toRow)
    const hasTable = columns.length > 0 && rows.length > 0
    const slide: SlideSpec = {
      layout: normalizeLayout(item.layout ?? item.布局, hasTable),
      title: strOrUndef(item.title ?? item.标题),
      subtitle: strOrUndef(item.subtitle ?? item.副标题),
      bullets: toBullets(item.bullets ?? item.要点 ?? item.content),
      notes: strOrUndef(item.notes ?? item.备注),
    }
    if (hasTable) {
      slide.columns = columns
      slide.rows = rows
    }
    const left = toSide(item.left ?? item.左栏)
    const right = toSide(item.right ?? item.右栏)
    if (left) {
      slide.left = left
    }
    if (right) {
      slide.right = right
    }
    // 整页没有任何可显示内容就丢掉，避免出现空白页
    const hasContent =
      slide.title || slide.subtitle || (slide.bullets && slide.bullets.length > 0) || slide.columns || slide.left || slide.right
    if (hasContent) {
      slides.push(slide)
    }
  }
  if (slides.length === 0) {
    return null
  }
  return {
    filename: strOrUndef(raw.filename),
    title: strOrUndef(raw.title),
    subtitle: strOrUndef(raw.subtitle),
    slides,
  }
}

/** 把用户可见的标题变成安全的文件名（去掉路径分隔符与保留字符）。 */
export const toFileName = (name: string, fallback: string, ext: string): string => {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 60)
  const base = cleaned || fallback
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`
}

/** 触发浏览器下载 */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 立即释放会让部分浏览器的下载中断，留一点余量
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
