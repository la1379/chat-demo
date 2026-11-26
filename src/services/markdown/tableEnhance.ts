/**
 * 表格增强：从 mdast 表格里提取纯文本，做排序与合计。
 *
 * 原有的 markdown 表格是只读的，数据一多就没法看。这里不改变渲染的
 * 基本外观，只加两个交互：点表头排序、数值列末尾给合计。
 *
 * 为什么只在「整列都是数字」时才给合计：把「2026」这类年份相加毫无意义，
 * 判断错一次就会给出一个看着像真的、其实是错的数字。
 */

/** 一列是否可以当数字列处理 */
const NUMBER_PATTERN = /^-?[\d,]+(\.\d+)?%?$/

const toNumber = (text: string): number | null => {
  const cleaned = text.replace(/[,\s¥$元%]/g, '')
  if (!NUMBER_PATTERN.test(text.replace(/[¥$元\s]/g, ''))) {
    // 允许带货币符号或单位，但必须先确认主体是数字
    if (!/^-?[\d,]*\.?\d+%?$/.test(cleaned)) {
      return null
    }
  }
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export type ColumnProfile = {
  /** 该列所有数据行都是数字 */
  numeric: boolean
  /** 数字列求和；非数字列为 null */
  sum: number | null
  /** 是否百分比列（合计时按原格式显示） */
  percent: boolean
}

export const profileColumn = (values: string[]): ColumnProfile => {
  const present = values.filter((text) => text.trim() !== '')
  if (present.length === 0) {
    return { numeric: false, sum: null, percent: false }
  }
  const numbers = present.map(toNumber)
  const numeric = numbers.every((value): value is number => value !== null)
  return {
    numeric,
    sum: numeric ? numbers.reduce((total, value) => total + value, 0) : null,
    percent: numeric && present.every((text) => text.includes('%')),
  }
}

/** 合计值按原列格式显示 */
export const formatSum = (profile: ColumnProfile): string => {
  if (profile.sum === null) {
    return ''
  }
  const rounded = Math.round(profile.sum * 100) / 100
  const text = rounded.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return profile.percent ? `${text}%` : text
}

/** 比较两段文本：都像数字就按数值比，否则按本地化字符串比 */
export const compareCells = (a: string, b: string): number => {
  const na = toNumber(a)
  const nb = toNumber(b)
  if (na !== null && nb !== null) {
    return na - nb
  }
  return a.localeCompare(b, 'zh-CN')
}
