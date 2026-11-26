/**
 * 图表块。
 *
 * 模型不直接画图，只输出结构化数据 + 图表类型；真正的 SVG 由这里生成。
 * 这样输出天然可校验，出错时能退回显示原文，也不会把一整段 SVG 塞进对话。
 *
 * 为什么手写 SVG 而不引图表库：
 * 这里只需要柱 / 折线 / 饼三种、不要交互、不要动画。为这点需求引一个
 * 上百 KB 的库，会让首屏体积翻倍，而代码量其实差不多。
 */

export type ChartKind = 'bar' | 'line' | 'pie'

export type ChartSeries = {
  name: string
  values: number[]
}

export type ChartSpec = {
  kind: ChartKind
  /** 图表标题，可选 */
  title?: string
  /** 类目轴（x 轴）标签 */
  labels: string[]
  series: ChartSeries[]
  /** 数值单位后缀，如「元」「%」；只用于显示 */
  unit?: string
  /** 饼图是否显示百分比 */
  showPercent?: boolean
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    // 容忍 "1,234"、"¥1280"、"12.5%"
    const cleaned = value.replace(/[,\s¥$%]/g, '')
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const KINDS = new Set<ChartKind>(['bar', 'line', 'pie'])

const normalizeKind = (value: unknown): ChartKind | null => {
  const raw = str(value).trim().toLowerCase()
  if (KINDS.has(raw as ChartKind)) {
    return raw as ChartKind
  }
  const zh = str(value)
  if (/柱|条形/.test(zh)) {
    return 'bar'
  }
  if (/折线|趋势/.test(zh)) {
    return 'line'
  }
  if (/饼|占比|扇形/.test(zh)) {
    return 'pie'
  }
  return null
}

/**
 * 校验并归一化图表大纲。返回 null 表示结构不可用，调用方应退回显示原文。
 *
 * 兼容几种模型常见的写法：
 * - series: [{name, values}] 或 {数据集名: [值...]}
 * - labels 缺省时用 1..n
 * - 单个数据系列可以写成 series: [1,2,3]（数值数组）
 */
export const parseChartSpec = (input: string): ChartSpec | null => {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch {
    return null
  }
  if (!isObject(raw)) {
    return null
  }

  const kind = normalizeKind(raw.kind ?? raw.type ?? raw.类型 ?? raw.图表类型)
  if (!kind) {
    return null
  }

  const rawLabels = Array.isArray(raw.labels ?? raw.x ?? raw.类目)
    ? ((raw.labels ?? raw.x ?? raw.类目) as unknown[])
    : []
  const labels = rawLabels.map((label) => String(label ?? ''))

  const rawSeries = raw.series ?? raw.data ?? raw.数据
  const series: ChartSeries[] = []

  if (Array.isArray(rawSeries)) {
    // 形态 A：[{name, values}] 或 [{name, data}]
    const objects = rawSeries.filter(isObject)
    if (objects.length > 0) {
      for (const item of objects) {
        const values = ((item.values ?? item.data ?? item.值) as unknown[]) ?? []
        if (!Array.isArray(values)) {
          continue
        }
        const nums = values.map(toNumber).filter((n): n is number => n !== null)
        if (nums.length > 0) {
          series.push({ name: str(item.name ?? item.标签) || `系列 ${series.length + 1}`, values: nums })
        }
      }
    } else {
      // 形态 B：裸数值数组，当作单系列
      const nums = rawSeries.map(toNumber).filter((n): n is number => n !== null)
      if (nums.length > 0) {
        series.push({ name: str(raw.name) || '数值', values: nums })
      }
    }
  } else if (isObject(rawSeries)) {
    // 形态 C：{数据集名: [值...]}
    for (const [name, values] of Object.entries(rawSeries)) {
      if (!Array.isArray(values)) {
        continue
      }
      const nums = values.map(toNumber).filter((n): n is number => n !== null)
      if (nums.length > 0) {
        series.push({ name, values: nums })
      }
    }
  }

  if (series.length === 0) {
    return null
  }

  // 饼图只取第一个系列
  const effective = kind === 'pie' ? series.slice(0, 1) : series
  const pointCount = Math.max(...effective.map((item) => item.values.length))

  return {
    kind,
    title: str(raw.title ?? raw.标题).trim() || undefined,
    labels:
      labels.length >= pointCount
        ? labels.slice(0, pointCount)
        : Array.from({ length: pointCount }, (_, index) => labels[index] ?? `${index + 1}`),
    series: effective,
    unit: str(raw.unit ?? raw.单位).trim() || undefined,
    showPercent: raw.showPercent === true || raw.显示百分比 === true,
  }
}

/** 把数值范围扩到好看的刻度；返回 [最小值, 最大值, 刻度步长] */
export const niceScale = (min: number, max: number, ticks = 4): [number, number, number] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1, 1]
  }
  if (min === max) {
    // 全是同一个值时给个可见的范围，否则图会画成一条贴边的线
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1
    min -= pad
    max += pad
  }
  // 柱状图基线从 0 起，否则视觉上会夸大差异
  if (min > 0) {
    min = 0
  }
  if (max < 0) {
    max = 0
  }
  const span = max - min
  const rough = span / ticks
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step, step]
}

/** 千分位 + 最多两位小数，图上标签用 */
export const formatValue = (value: number, unit?: string): string => {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100
  const text = rounded.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return unit ? `${text}${unit}` : text
}
