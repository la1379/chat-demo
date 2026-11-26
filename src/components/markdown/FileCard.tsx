import { useTranslate } from '../../i18n/index.js'
import { memo, useMemo, useState } from 'react'
import { showToast } from '../base/toastState.js'
import { buildDeck } from '../../services/office/deck.js'
import { buildWorkbook } from '../../services/office/workbook.js'
import { downloadBlob, parseDeckSpec, parseWorkbookSpec } from '../../services/office/spec.js'
import type { Column, DeckSpec, WorkbookSpec } from '../../services/office/spec.js'
import styles from './FileCard.module.css'

type Kind = 'xlsx' | 'pptx'

/** 从流式文本里认出文件块标签 */
export const fileKindOf = (infostring: string): Kind | null => {
  const lang = infostring.trim().toLowerCase()
  if (lang === 'xlsx' || lang === 'excel') {
    return 'xlsx'
  }
  if (lang === 'pptx' || lang === 'ppt' || lang === 'slides') {
    return 'pptx'
  }
  return null
}

const fmtCell = (value: string | number | null, column: Column | undefined): string => {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'number') {
    if (column?.type === 'currency') {
      return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    if (column?.type === 'percent') {
      return `${(value * 100).toFixed(1)}%`
    }
    return value.toLocaleString('zh-CN')
  }
  return value
}

/** 表格预览：限制行数，避免超长表格把对话撑爆 */
const TablePreview = memo(function TablePreview({
  columns,
  rows,
}: {
  columns: Column[]
  rows: (string | number | null)[][]
}) {
  const MAX = 8
  const visible = rows.slice(0, MAX)
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} className={column.type === 'text' ? '' : styles.numeric}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column, colIndex) => (
                <td key={colIndex} className={column.type === 'text' ? '' : styles.numeric}>
                  {fmtCell(row[colIndex] ?? null, column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX ? (
        <div className={styles.more}>还有 {rows.length - MAX} 行，下载后查看完整内容</div>
      ) : null}
    </div>
  )
})

const WorkbookPreview = memo(function WorkbookPreview({ spec }: { spec: WorkbookSpec }) {
  const [active, setActive] = useState(0)
  const sheet = spec.sheets[Math.min(active, spec.sheets.length - 1)]
  if (!sheet) {
    return null
  }
  return (
    <div>
      {spec.sheets.length > 1 ? (
        <div className={styles.tabs}>
          {spec.sheets.map((item, index) => (
            <button
              key={index}
              type="button"
              className={index === active ? styles.tabActive : styles.tab}
              onClick={() => setActive(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      <TablePreview columns={sheet.columns} rows={sheet.rows} />
    </div>
  )
})

const DeckPreview = memo(function DeckPreview({ spec }: { spec: DeckSpec }) {
  return (
    <ol className={styles.slideList}>
      {spec.slides.map((slide, index) => {
        const points = slide.bullets?.length ?? 0
        return (
          <li key={index} className={styles.slideItem}>
            <span className={styles.slideNo}>{index + 1}</span>
            <span className={styles.slideTitle}>{slide.title || slide.subtitle || '（无标题页）'}</span>
            {points > 0 ? <span className={styles.slideMeta}>{points} 条要点</span> : null}
            {slide.columns ? <span className={styles.slideMeta}>表格</span> : null}
          </li>
        )
      })}
    </ol>
  )
})

/**
 * 文件卡片：把模型输出的 JSON 大纲变成一个可下载的真实 Office 文件。
 *
 * loading 时只显示「正在生成」，不尝试解析半截 JSON；
 * 解析失败则退回显示原文，绝不让格式错误把对话渲染搞崩。
 */
export const FileCard = memo(function FileCard({
  code,
  kind,
  loading,
}: {
  code: string
  kind: Kind
  loading: boolean
}) {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const parsed = useMemo(() => {
    // 流式过程中 JSON 必然不完整，不做无谓解析
    if (loading) {
      return null
    }
    return kind === 'xlsx' ? parseWorkbookSpec(code) : parseDeckSpec(code)
  }, [code, kind, loading])

  const title = kind === 'xlsx' ? t('fileCardXlsxTitle') : t('fileCardPptxTitle')
  const meta = useMemo(() => {
    if (!parsed) {
      return ''
    }
    if (kind === 'xlsx') {
      return t('fileCardSheets', { count: (parsed as WorkbookSpec).sheets.length })
    }
    return t('fileCardSlides', { count: (parsed as DeckSpec).slides.length })
  }, [parsed, kind, t])

  const onDownload = async () => {
    if (!parsed || busy) {
      return
    }
    setBusy(true)
    try {
      const result =
        kind === 'xlsx'
          ? buildWorkbook(parsed as WorkbookSpec)
          : await buildDeck(parsed as DeckSpec)
      downloadBlob(result.blob, result.filename)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.icon}>{kind === 'xlsx' ? '▦' : '▤'}</span>
          <span className={styles.title}>{title}</span>
          <span className={styles.meta}>{t('fileCardGenerating')}</span>
        </div>
        <div className={styles.skeleton} />
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.icon}>{kind === 'xlsx' ? '▦' : '▤'}</span>
          <span className={styles.title}>{title}</span>
          <span className={styles.meta}>{t('fileCardInvalid')}</span>
        </div>
        <pre className={styles.raw}>{code}</pre>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.icon}>{kind === 'xlsx' ? '▦' : '▤'}</span>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>{meta}</span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : t('fileCardPreview')}
        </button>
        <button type="button" className={styles.button} onClick={onDownload} disabled={busy}>
          {busy ? t('fileCardGenerating') : t('fileCardDownload')}
        </button>
      </div>
      {expanded ? (
        <div className={styles.body}>
          {kind === 'xlsx' ? (
            <WorkbookPreview spec={parsed as WorkbookSpec} />
          ) : (
            <DeckPreview spec={parsed as DeckSpec} />
          )}
        </div>
      ) : null}
    </div>
  )
})
