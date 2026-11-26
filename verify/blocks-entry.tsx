/**
 * 对话块渲染验证页（不进构建产物）。
 *
 * 图表 / 邮件 / 清单这些块由模型输出的 JSON 驱动，而 JSON 是模型写的、
 * 形状千奇百怪。这个页面把准备好的样本一次性渲染出来，用来确认：
 * 1. 正常数据画得对
 * 2. 畸形数据退回显示原文，而不是把整页搞崩
 * 3. 暗色主题下 SVG 里的文字仍然可读
 *
 * 用法见 verify/README.md。
 */
import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { ChartCard } from '../src/components/markdown/ChartCard.js'
import { MailCard } from '../src/components/markdown/MailCard.js'
import { ChecklistCard } from '../src/components/markdown/ChecklistCard.js'
import { setupTheme } from '../src/app/theme.js'
import '../src/app/theme.css'
import '../src/app/global.css'

// 暗色不是靠 prefers-color-scheme 的媒体查询，而是靠 body 上的 data 属性，
// 所以必须走应用自己的 setupTheme，否则截图永远只看到亮色
setupTheme()

const LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary)',
  margin: '18px 0 0',
}

/** 每个样本：标签 + 代码块内容 */
const SAMPLES: { label: string; code: string }[] = [
  {
    label: '柱状图 · 单系列',
    code: JSON.stringify({
      kind: 'bar',
      title: '分月销售额',
      labels: ['7月', '8月', '9月', '10月'],
      series: [{ name: '销售额', values: [128000, 156500, 143200, 189000] }],
      unit: '元',
    }),
  },
  {
    label: '柱状图 · 多系列',
    code: JSON.stringify({
      kind: '柱状图',
      title: '线上线下对比',
      labels: ['一季度', '二季度', '三季度'],
      series: [
        { name: '线上', values: [820, 932, 901] },
        { name: '线下', values: [320, 302, 401] },
      ],
    }),
  },
  {
    label: '折线图 · 负值',
    code: JSON.stringify({
      kind: 'line',
      title: '利润变化',
      labels: ['1月', '2月', '3月', '4月', '5月'],
      series: [{ name: '利润', values: [-120, 80, 240, -40, 310] }],
      unit: '万',
    }),
  },
  {
    label: '饼图 · 显示百分比',
    code: JSON.stringify({
      kind: 'pie',
      title: '费用构成',
      labels: ['人工', '材料', '运输', '其他'],
      series: [188888, 66666, 33333, 11111],
      showPercent: true,
    }),
  },
  {
    label: '畸形：不是 JSON',
    code: '{这不是 JSON',
  },
  {
    label: '畸形：没有 series',
    code: JSON.stringify({ kind: 'bar', title: '空数据' }),
  },
  {
    label: '畸形：type 不认识',
    code: JSON.stringify({ kind: 'radar', labels: ['a'], series: [1, 2] }),
  },
  {
    label: '容错：series 是裸数组 + 字符串数值',
    code: JSON.stringify({
      kind: 'bar',
      title: '字符串数值',
      labels: ['A', 'B'],
      series: ['1,200', '¥3,400'],
      unit: '元',
    }),
  },
]

/** 换行常量：在模板里写转义反斜杠容易出错，统一用它拼 */
const STRING_NL = String.fromCharCode(10)

const MAILS: { label: string; code: string }[] = [
  {
    label: '邮件 · 完整字段',
    code: JSON.stringify({
      to: ['zhang@example.com', 'li@example.com'],
      cc: 'wang@example.com',
      subject: '关于十月份对账的说明',
      body: ['张经理：', '', '附件是十月份的对账单，其中第 3 笔金额有调整，请复核。', '', '如有疑问随时联系我。', '', '谢谢！'].join(STRING_NL),
      note: '记得附上对账单文件',
    }),
  },
  {
    label: '邮件 · 只有正文',
    code: JSON.stringify({ body: '收到，我今天下午处理。' }),
  },
  { label: '畸形：不是 JSON', code: '{"to": "x@y.com"' },
]

const LISTS: { label: string; code: string }[] = [
  {
    label: '清单 · 分组',
    code: JSON.stringify({
      title: '本周待办',
      items: [
        { text: '核对十月对账单', group: '财务' },
        { text: '提交季度报表', group: '财务', checked: true },
        { text: '联系供应商确认交期', group: '采购' },
        { text: '安排下周例会', group: '行政' },
      ],
    }),
  },
  {
    label: '清单 · 裸数组',
    code: JSON.stringify(['买菜', '取快递', '交水电费']),
  },
  { label: '畸形：空对象', code: '{}' },
]

const App = () => (
  <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
    <h1 style={{ fontSize: 20, marginBottom: 20 }}>对话块渲染验证</h1>
    <h2 style={{ fontSize: 14, marginTop: 24 }}>图表</h2>
    {SAMPLES.map((sample) => (
      <section key={sample.label} style={{ marginBottom: 8 }}>
        <h3 style={LABEL}>{sample.label}</h3>
        <ChartCard code={sample.code} />
      </section>
    ))}
    <h2 style={{ fontSize: 14, marginTop: 24 }}>邮件</h2>
    {MAILS.map((sample) => (
      <section key={sample.label} style={{ marginBottom: 8 }}>
        <h3 style={LABEL}>{sample.label}</h3>
        <MailCard code={sample.code} />
      </section>
    ))}
    <h2 style={{ fontSize: 14, marginTop: 24 }}>清单</h2>
    {LISTS.map((sample) => (
      <section key={sample.label} style={{ marginBottom: 8 }}>
        <h3 style={LABEL}>{sample.label}</h3>
        <ChecklistCard code={sample.code} />
      </section>
    ))}
  </div>
)

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
document.title = 'blocks-probe-ready'
