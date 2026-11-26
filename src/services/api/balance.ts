import { API_ORIGIN } from './client.js'
import { getProvider, type ProviderId } from './providers.js'

/**
 * 余额查询。
 *
 * 用的是 DeepSeek 开放平台的 /user/balance，和聊天走同一个 Key。
 * 放在这里而不是聊天里：她看到额度快没了才是最有用的时刻，
 * 等额度真用完了才报错就晚了。
 *
 * 注意这是「账户余额」，不是「本次会话花了多少」—— 后者要自己记 token
 * 用量再换算，和余额不是一个来源，这里不做。
 */

export type BalanceInfo = {
  /** 可用余额，货币单位 */
  available: number
  currency: string
  /** 余额是否充足；平台会返回 is_available */
  isAvailable: boolean
}

type RawBalance = {
  is_available?: boolean
  balance_infos?: { currency?: string; total_balance?: string }[]
}

/** 查询余额。失败时抛错，调用方决定是静默还是提示。 */
export const fetchBalance = async (
  apiKey: string,
  signal?: AbortSignal,
  providerId: ProviderId = 'deepseek'
): Promise<BalanceInfo> => {
  // 只有 DeepSeek 有余额接口；其他服务商这里直接说明，不发无谓的请求
  const url = getProvider(providerId).balanceUrl ?? `${API_ORIGIN}/user/balance`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(`余额查询失败（HTTP ${response.status}）`)
  }
  const raw = (await response.json()) as RawBalance
  const info = raw.balance_infos?.[0]
  const available = Number(info?.total_balance ?? 0)
  return {
    available: Number.isFinite(available) ? available : 0,
    currency: info?.currency ?? 'CNY',
    isAvailable: raw.is_available === true,
  }
}

/**
 * 显示用：金额固定两位小数。
 * 只写 maximumFractionDigits 的话 128.50 会显示成 128.5 —— 金额少一位看着不专业。
 */
export const formatBalance = (info: BalanceInfo): string => {
  const symbol = info.currency === 'CNY' ? '¥' : info.currency === 'USD' ? '$' : ''
  const value = info.available.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${value}`
}
