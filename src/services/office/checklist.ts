/**
 * 清单块。
 *
 * 普通的 `- [ ]` markdown 在对话里是只读的，勾不了也存不住。
 * 这个块把清单变成真的能用：可勾选、状态存本地，刷新还在。
 *
 * 为什么存 localStorage 而不是会话里：勾选是「做事」不是「聊天记录」，
 * 关掉页面再回来，「这件我办了」这个事实应该还在。
 */

export type ChecklistItem = {
  text: string
  /** 分组标题，可选；同一份清单里可以有多个分组 */
  group?: string
  checked?: boolean
}

export type ChecklistSpec = {
  title: string
  items: ChecklistItem[]
  /** 来自模型的稳定标识；没有就用标题+条目拼出来 */
  id: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 简单稳定的哈希：同一份清单每次渲染得到同一个 key，勾选状态才不会丢 */
const hash = (input: string): string => {
  let value = 5381
  for (let index = 0; index < input.length; index += 1) {
    value = ((value << 5) + value + input.charCodeAt(index)) | 0
  }
  return Math.abs(value).toString(36)
}

const toItems = (value: unknown): ChecklistItem[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const items: ChecklistItem[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const text = entry.trim()
      if (text) {
        items.push({ text })
      }
      continue
    }
    if (!isObject(entry)) {
      continue
    }
    const text = str(entry.text ?? entry.内容 ?? entry.title ?? entry.item).trim()
    if (!text) {
      continue
    }
    items.push({
      text,
      group: str(entry.group ?? entry.分组 ?? entry.category).trim() || undefined,
      checked: entry.checked === true,
    })
  }
  return items
}

/** 校验并归一化清单。返回 null 表示结构不可用，调用方退回显示原文。 */
export const parseChecklistSpec = (input: string): ChecklistSpec | null => {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch {
    return null
  }
  // 也接受裸数组：模型有时直接吐 ["a","b"]
  const items = Array.isArray(raw) ? toItems(raw) : isObject(raw) ? toItems(raw.items ?? raw.todos ?? raw.条目) : []
  if (items.length === 0) {
    return null
  }
  const title = isObject(raw) ? str(raw.title ?? raw.标题).trim() : ''
  return {
    title: title || '清单',
    items,
    id: (isObject(raw) ? str(raw.id).trim() : '') || hash(title + items.map((item) => item.text).join('|')),
  }
}

const STORAGE_PREFIX = 'checklist:'

export const loadChecked = (id: string): Record<number, boolean> => {
  try {
    const text = localStorage.getItem(STORAGE_PREFIX + id)
    if (!text) {
      return {}
    }
    const parsed: unknown = JSON.parse(text)
    if (!isObject(parsed)) {
      return {}
    }
    const out: Record<number, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const index = Number(key)
      if (Number.isInteger(index) && value === true) {
        out[index] = true
      }
    }
    return out
  } catch {
    // 隐私模式下 localStorage 会抛，勾不了也不该让页面崩
    return {}
  }
}

export const saveChecked = (id: string, checked: Record<number, boolean>): void => {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(checked))
  } catch {
    // 存不下不影响本次勾选
  }
}
