import { memo, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { showToast } from '../base/toastState.js'
import { downloadBlob, toFileName } from '../../services/office/spec.js'
import {
  formatValue,
  niceScale,
  parseChartSpec,
  type ChartKind,
  type ChartSpec,
} from '../../services/office/chart.js'
import styles from './ChartCard.module.css'

/** 分类配色。放在这里而不是 CSS：SVG 的 fill 要直接拿色值 */
const PALETTE = ['#3B6FD4', '#E8A33D', '#3AA675', '#D9534F', '#8E6BC4', '#4BA3C7']

const W = 640
const H = 320
const PAD_TOP = 16
const PAD_RIGHT = 20
const PAD_BOTTOM = 44

/**
 * 左边距不能写死：刻度可能是「50,000元」「-1,200万」这种长文本，
 * 固定 52px 会把标签切掉（真实踩过：截图里只剩 "000元"）。
 * 按最长刻度文字估算字宽（中文字符接近 13px @ 11px 字号）。
 */
const measureLeftPad = (texts: string[]): number => {
  let widest = 0
  for (const text of texts) {
    let width = 0
    for (const char of text) {
      // 按 11px 字号的实测字宽：中文/全角符号约 14px，数字字母约 7px，标点更窄
      if (/[一-鿿＀-￯]/.test(char)) {
        width += 14
      } else if (/[-.,]/.test(char)) {
        width += 4.5
      } else {
        width += 7
      }
    }
    widest = Math.max(widest, width)
  }
  // 估算只能保证「大致够」，所以额外留 20px，宁可绘图区窄一点也别切字
  return Math.min(150, Math.max(48, Math.ceil(widest) + 26))
}

/** 由左边距推出绘图区尺寸 */
const plotBox = (leftPad: number) => ({
  left: leftPad,
  width: W - leftPad - PAD_RIGHT,
  height: H - PAD_TOP - PAD_BOTTOM,
})

const kindLabel = (kind: ChartKind, t: (key: 'chartBar' | 'chartLine' | 'chartPie') => string) =>
  kind === 'bar' ? t('chartBar') : kind === 'line' ? t('chartLine') : t('chartPie')

/** 坐标轴 + 网格线，三种图共用 */
const Axes = memo(function Axes({
  min,
  max,
  step,
  unit,
  left,
  width,
  height,
}: {
  min: number
  max: number
  step: number
  unit?: string
  left: number
  width: number
  height: number
}) {
  const ticks: number[] = []
  for (let value = min; value <= max + step / 2; value += step) {
    ticks.push(value)
  }
  const yOf = (value: number) => PAD_TOP + height - ((value - min) / (max - min || 1)) * height
  return (
    <g>
      {ticks.map((value) => (
        <g key={value}>
          <line
            x1={left}
            x2={left + width}
            y1={yOf(value)}
            y2={yOf(value)}
            className={styles.gridLine}
            strokeWidth={1}
          />
          <text x={left - 8} y={yOf(value) + 4} textAnchor="end" className={styles.tickText}>
            {formatValue(value, unit)}
          </text>
        </g>
      ))}
    </g>
  )
})

const BarChart = memo(function BarChart({ spec }: { spec: ChartSpec }) {
  const all = spec.series.flatMap((series) => series.values)
  const [min, max, step] = niceScale(Math.min(...all), Math.max(...all))
  const ticks: string[] = []
  for (let value = min; value <= max + step / 2; value += step) {
    ticks.push(formatValue(value, spec.unit))
  }
  const left = measureLeftPad(ticks)
  const { width, height } = plotBox(left)
  const yOf = (value: number) => PAD_TOP + height - ((value - min) / (max - min || 1)) * height
  const groups = spec.labels.length
  const seriesCount = spec.series.length
  const groupW = width / Math.max(groups, 1)
  // 组内留 24% 间隙，多系列时柱子不会粘在一起
  const barW = (groupW * 0.76) / seriesCount

  return (
    <>
      <Axes min={min} max={max} step={step} unit={spec.unit} left={left} width={width} height={height} />
      {spec.labels.map((label, groupIndex) =>
        spec.series.map((series, seriesIndex) => {
          const value = series.values[groupIndex] ?? 0
          const x = left + groupIndex * groupW + groupW * 0.12 + seriesIndex * barW
          const y = yOf(Math.max(value, 0))
          const height = Math.abs(yOf(value) - yOf(0))
          return (
            <rect
              key={`${groupIndex}-${seriesIndex}`}
              x={x}
              y={value >= 0 ? y : yOf(0)}
              width={Math.max(barW - 2, 1)}
              height={Math.max(height, 0.5)}
              rx={2}
              fill={PALETTE[seriesIndex % PALETTE.length]}
            >
              <title>{`${label} · ${series.name}：${formatValue(value, spec.unit)}`}</title>
            </rect>
          )
        })
      )}
      {spec.labels.map((label, index) => (
        <text
          key={label + index}
          x={left + index * groupW + groupW / 2}
          y={H - PAD_BOTTOM + 20}
          textAnchor="middle"
          className={styles.tickText}
        >
          {/* 类目多时只显示部分标签，否则会糊成一片 */}
          {spec.labels.length > 12 && index % 2 === 1 ? '' : label}
        </text>
      ))}
    </>
  )
})

const LineChart = memo(function LineChart({ spec }: { spec: ChartSpec }) {
  const all = spec.series.flatMap((series) => series.values)
  const [min, max, step] = niceScale(Math.min(...all), Math.max(...all))
  const ticks: string[] = []
  for (let value = min; value <= max + step / 2; value += step) {
    ticks.push(formatValue(value, spec.unit))
  }
  const left = measureLeftPad(ticks)
  const { width, height } = plotBox(left)
  const yOf = (value: number) => PAD_TOP + height - ((value - min) / (max - min || 1)) * height
  const groups = spec.labels.length
  const xOf = (index: number) => left + (groups <= 1 ? width / 2 : (index / (groups - 1)) * width)

  return (
    <>
      <Axes min={min} max={max} step={step} unit={spec.unit} left={left} width={width} height={height} />
      {spec.series.map((series, seriesIndex) => {
        const color = PALETTE[seriesIndex % PALETTE.length]
        const points = series.values.map((value, index) => `${xOf(index)},${yOf(value)}`).join(' ')
        return (
          <g key={series.name + seriesIndex}>
            <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            {series.values.map((value, index) => (
              <circle key={index} cx={xOf(index)} cy={yOf(value)} r={3} fill={color}>
                <title>{`${spec.labels[index] ?? ''} · ${series.name}：${formatValue(value, spec.unit)}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {spec.labels.map((label, index) => (
        <text key={label + index} x={xOf(index)} y={H - PAD_BOTTOM + 20} textAnchor="middle" className={styles.tickText}>
          {spec.labels.length > 12 && index % 2 === 1 ? '' : label}
        </text>
      ))}
    </>
  )
})

const PieChart = memo(function PieChart({ spec }: { spec: ChartSpec }) {
  const series = spec.series[0]
  const values = series.values.map((value) => Math.max(value, 0))
  const total = values.reduce((sum, value) => sum + value, 0)
  const cx = W / 2
  const cy = H / 2
  const radius = Math.min(H - PAD_TOP - PAD_BOTTOM, W - PAD_RIGHT * 2) / 2 - 8

  if (total <= 0) {
    return (
      <text x={cx} y={cy} textAnchor="middle" className={styles.emptyText}>
        没有可显示的正值
      </text>
    )
  }

  let angle = -Math.PI / 2
  return (
    <>
      {values.map((value, index) => {
        const sweep = (value / total) * Math.PI * 2
        const x1 = cx + radius * Math.cos(angle)
        const y1 = cy + radius * Math.sin(angle)
        const x2 = cx + radius * Math.cos(angle + sweep)
        const y2 = cy + radius * Math.sin(angle + sweep)
        const largeArc = sweep > Math.PI ? 1 : 0
        const percent = ((value / total) * 100).toFixed(1)
        // 只有一个扇区时画整圆，否则 path 会退化成一条线
        const isFull = values.length === 1 || sweep >= Math.PI * 1.999
        const path = isFull
          ? `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
          : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
        angle += sweep
        return (
          <path key={index} d={path} fill={PALETTE[index % PALETTE.length]} className={styles.sliceStroke} strokeWidth={1.5}>
            <title>{`${spec.labels[index] ?? ''}：${formatValue(value, spec.unit)}（${percent}%）`}</title>
          </path>
        )
      })}
      {/* 图例放在右侧，比在扇区里标字更不容易挤 */}
      {values.map((value, index) => {
        const percent = ((value / total) * 100).toFixed(1)
        const y = PAD_TOP + 12 + index * 22
        return (
          <g key={index}>
            <rect x={W - 150} y={y - 9} width={10} height={10} rx={2} fill={PALETTE[index % PALETTE.length]} />
            <text x={W - 134} y={y} className={styles.legendText}>
              {`${spec.labels[index] ?? ''} ${spec.showPercent ? `${percent}%` : formatValue(value, spec.unit)}`}
            </text>
          </g>
        )
      })}
    </>
  )
})

/**
 * 图表卡片。解析失败时退回显示原文 —— 绝不能让一段畸形 JSON
 * 把整个对话渲染搞崩。
 */
export const ChartCard = memo(function ChartCard({
  code,
  loading,
}: {
  code: string
  loading?: boolean
}) {
  const t = useTranslate()
  const [showRaw, setShowRaw] = useState(false)
  const spec = useMemo(() => (loading ? null : parseChartSpec(code)), [code, loading])

  // 流式过程中 JSON 必然不完整，先给个占位，别一闪一闪地报错
  if (loading) {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.title}>{t('chartGenerating')}</span>
        </div>
        <div className={styles.skeleton} />
      </div>
    )
  }

  if (!spec) {
    return <pre className={styles.raw}>{code}</pre>
  }

  const onDownloadSvg = () => {
    const svg = document.getElementById(`chart-svg-${encodeURIComponent(spec.title ?? 'chart')}`)
    if (!svg) {
      showToast(t('chartDownloadFailed'))
      return
    }
    const text = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${text}`], {
      type: 'image/svg+xml;charset=utf-8',
    })
    downloadBlob(blob, toFileName(spec.title ?? 'chart', '图表', '.svg'))
    showToast(t('chartDownloaded'))
  }

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>{spec.title || t('chartUntitled')}</span>
        <span className={styles.meta}>{kindLabel(spec.kind, t)}</span>
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={() => setShowRaw((value) => !value)}>
            {showRaw ? t('chartShowChart') : t('chartShowData')}
          </button>
          <button type="button" className={styles.ghost} onClick={onDownloadSvg}>
            {t('chartDownload')}
          </button>
        </div>
      </div>

      {showRaw ? (
        <pre className={styles.raw}>
          {spec.labels.map((label) => label).join('\t') + '\n'}
          {spec.series
            .map((series) => `${series.name}\t${series.values.join('\t')}`)
            .join('\n')}
        </pre>
      ) : (
        <>
          <div className={styles.plot}>
            <svg
              id={`chart-svg-${encodeURIComponent(spec.title ?? 'chart')}`}
              viewBox={`0 0 ${W} ${H}`}
              className={styles.svg}
              role="img"
              aria-label={spec.title ?? kindLabel(spec.kind, t)}
            >
              {spec.kind === 'bar' ? <BarChart spec={spec} /> : null}
              {spec.kind === 'line' ? <LineChart spec={spec} /> : null}
              {spec.kind === 'pie' ? <PieChart spec={spec} /> : null}
            </svg>
          </div>
          {/* 多系列时柱/线图要说明颜色，饼图自己在图例里标 */}
          {spec.kind !== 'pie' && spec.series.length > 1 ? (
            <div className={styles.legend}>
              {spec.series.map((series, index) => (
                <span key={series.name + index} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: PALETTE[index % PALETTE.length] }} />
                  {series.name}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
})
