/**
 * 模型名解析验证页（不进构建产物）。
 *
 * 换服务商后最容易出的错：会话里记着上一家的模型名，发出去得到
 * 「model does not exist」—— 这个错误看不出根因。这里验证校正逻辑。
 */
import { PROVIDERS } from '../src/services/api/providers.js'

const results: string[] = []

// 复刻 store.ts 里的 resolveModel 逻辑（同一份规则，避免依赖 store 的副作用）
const resolveModel = (recorded: string | null | undefined, providerId: string): string => {
  const provider = PROVIDERS.find((item) => item.id === providerId) ?? PROVIDERS[0]
  if (recorded && provider.models.includes(recorded)) {
    return recorded
  }
  return provider.models[0]
}

const cases: [string | null, string, string][] = [
  ['deepseek-flash', 'deepseek', '官方会话在官方下 -> 保持'],
  ['deepseek-flash', 'bailian', '官方会话切到百炼 -> 应换成百炼模型'],
  ['deepseek-v4-flash-1017', 'bailian', '百炼会话在百炼下 -> 保持'],
  ['deepseek-v4-flash-1017', 'deepseek', '百炼会话切回官方 -> 应换成官方模型'],
  [null, 'bailian', '没有记录 -> 用当前服务商默认'],
  [null, 'deepseek', '没有记录 -> 用当前服务商默认'],
  ['some-unknown-model', 'bailian', '陌生模型名 -> 换成当前默认'],
]

for (const [recorded, provider, desc] of cases) {
  results.push(`${desc}\n  记录=${recorded} 服务商=${provider} -> ${resolveModel(recorded, provider)}`)
}

results.push('')
results.push('各服务商的模型清单：')
for (const p of PROVIDERS) {
  results.push(`  ${p.id}: ${p.models.join(', ')}  (protocol=${p.protocol})`)
}

const el = document.getElementById('root')
if (el) {
  el.style.cssText = 'font: 12px/1.7 ui-monospace, monospace; padding: 16px; white-space: pre-wrap'
  el.textContent = results.join('\n')
}
;(window as unknown as Record<string, unknown>).__results = results
document.title = 'model-probe-ready'
