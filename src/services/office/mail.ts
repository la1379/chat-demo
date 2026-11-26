/**
 * 邮件草稿块。
 *
 * 她的用法是「写邮件 + 读邮件审核」。邮件正文从聊天气泡里手动抄出来
 * 很容易漏行或带上无关的对话内容，所以单独成一个块：结构化字段 +
 * 一键复制，正文只放邮件本身。
 *
 * 刻意不做「直接发送」：纯静态网页没有后端，也没有她的邮箱授权。
 * 这里只负责把内容整理好，发送仍由她自己完成。
 */

export type MailSpec = {
  /** 收件人，可能多个 */
  to: string[]
  cc: string[]
  subject: string
  body: string
  /** 可选：给用户的提醒，如「附件别忘了」 */
  note?: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 收件人可能写成数组，也可能是「a@x.com; b@y.com」这样的一串 */
const toList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => str(item).trim()).filter(Boolean)
  }
  const text = str(value)
  if (!text) {
    return []
  }
  return text
    .split(/[;,，；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 校验并归一化邮件大纲。返回 null 表示结构不可用，调用方退回显示原文。
 * subject 与 body 至少有一个，否则视为无效。
 */
export const parseMailSpec = (input: string): MailSpec | null => {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch {
    return null
  }
  if (!isObject(raw)) {
    return null
  }

  const subject = str(raw.subject ?? raw.主题 ?? raw.标题).trim()
  const body = str(raw.body ?? raw.正文 ?? raw.content).trim()
  if (!subject && !body) {
    return null
  }

  return {
    to: toList(raw.to ?? raw.收件人 ?? raw.recipient),
    cc: toList(raw.cc ?? raw.抄送),
    subject,
    body,
    note: str(raw.note ?? raw.备注).trim() || undefined,
  }
}

/** 拼成可直接贴进邮件客户端的全文 */
export const formatMail = (mail: MailSpec): string => {
  const lines: string[] = []
  if (mail.to.length > 0) {
    lines.push(`收件人：${mail.to.join('; ')}`)
  }
  if (mail.cc.length > 0) {
    lines.push(`抄送：${mail.cc.join('; ')}`)
  }
  if (mail.subject) {
    lines.push(`主题：${mail.subject}`)
  }
  if (lines.length > 0) {
    lines.push('')
  }
  lines.push(mail.body)
  return lines.join('\n')
}
