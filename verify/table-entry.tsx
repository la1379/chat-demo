/**
 * 表格增强验证页（不进构建产物）：排序 + 合计行。
 */
import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { MarkdownAstRenderer } from '../src/components/markdown/MarkdownAstRenderer.js'
import { toMdAst } from '../src/services/markdown/parse.js'
import { setupTheme } from '../src/app/theme.js'
import '../src/app/theme.css'
import '../src/app/global.css'
import '../src/components/markdown/markdown.css'

setupTheme()

const CASES: { label: string; md: string }[] = [
  {
    label: '数字列 + 文本列',
    md: `| 月份 | 销售额 | 备注 |
|---|---|---|
| 7月 | 128000 | 正常 |
| 8月 | 156500 | 促销 |
| 9月 | 143200 | 正常 |`,
  },
  {
    label: '带货币符号与单位',
    md: `| 项目 | 金额 |
|---|---|
| 人工 | ¥18,000.50 |
| 材料 | ¥6,666.00 |`,
  },
  {
    label: '百分比列',
    md: `| 渠道 | 占比 |
|---|---|
| 线上 | 62% |
| 线下 | 38% |`,
  },
  {
    label: '年份列不该求和',
    md: `| 年份 | 说明 |
|---|---|
| 2024 | 旧版 |
| 2025 | 新版 |`,
  },
  {
    label: '空表格',
    md: `| A | B |
|---|---|`,
  },
]

const LABEL: CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', margin: '18px 0 0',
}

const App = () => (
  <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
    <h1 style={{ fontSize: 20 }}>表格增强验证</h1>
    {CASES.map((c) => (
      <section key={c.label}>
        <h2 style={LABEL}>{c.label}</h2>
        <MarkdownAstRenderer
          ast={toMdAst(c.md, { sources: undefined, disableLink: false })}
          onUpdate={() => {}}
        />
      </section>
    ))}
  </div>
)

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
document.title = 'table-probe-ready'
