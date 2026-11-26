/**
 * 生成 .pptx。
 *
 * 这里用 PptxGenJS 而不是手写 OOXML：pptx 的 theme / slideMaster / slideLayout
 * 是三份互相引用的 XML，手写极易产出 PowerPoint 打不开的文件。
 *
 * 版面（16:9，13.333 × 7.5 英寸）与配色在这里集中定义，模版通过 layout 字段选择。
 */
import PptxGenJS from 'pptxgenjs'
import type { Column, DeckSpec, Row, SlideSpec } from './spec.js'
import { toFileName } from './spec.js'

/** 讲稿正文配色；与 Office 默认主题差异明显，避免看起来像没做过设计 */
const C = {
  primary: '1F3864',
  accent: 'C9A227',
  ink: '333333',
  muted: '7F7F7F',
  line: 'D9D9D9',
  soft: 'F2F5FA',
  white: 'FFFFFF',
} as const

const FONT = '微软雅黑'
const W = 13.333
const H = 7.5
const MARGIN = 0.75
const CONTENT_W = W - MARGIN * 2

/** 每页都要有的页脚：细线 + 页码 */
const addFooter = (slide: PptxGenJS.Slide, pageNo: number, deckTitle: string | undefined) => {
  slide.addShape('line', {
    x: MARGIN,
    y: H - 0.62,
    w: CONTENT_W,
    h: 0,
    line: { color: C.line, width: 0.75 },
  })
  if (deckTitle) {
    slide.addText(deckTitle, {
      x: MARGIN,
      y: H - 0.55,
      w: CONTENT_W - 1,
      h: 0.32,
      fontFace: FONT,
      fontSize: 10,
      color: C.muted,
      valign: 'middle',
    })
  }
  slide.addText(String(pageNo), {
    x: W - MARGIN - 0.6,
    y: H - 0.55,
    w: 0.6,
    h: 0.32,
    fontFace: FONT,
    fontSize: 10,
    color: C.muted,
    align: 'right',
    valign: 'middle',
  })
}

/** 页眉：小标题条，给正文页一个统一的开头 */
const addHeader = (slide: PptxGenJS.Slide, title: string | undefined) => {
  if (!title) {
    return 1.35
  }
  slide.addText(title, {
    x: MARGIN,
    y: 0.52,
    w: CONTENT_W,
    h: 0.7,
    fontFace: FONT,
    fontSize: 28,
    bold: true,
    color: C.primary,
    valign: 'middle',
  })
  slide.addShape('line', {
    x: MARGIN,
    y: 1.28,
    w: 1.5,
    h: 0,
    line: { color: C.accent, width: 3 },
  })
  return 1.6
}

const asCellText = (value: string | number | null, column: Column | undefined): string => {
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

/** 表格页：列宽按内容长度分配，至少保证每列可读 */
const addTable = (slide: PptxGenJS.Slide, spec: SlideSpec, top: number) => {
  const columns = spec.columns ?? []
  const rows = spec.rows ?? []
  if (columns.length === 0 || rows.length === 0) {
    return
  }
  // 行数过多会溢出页面，超出部分截断并在页脚提示，不静默丢数据不管
  const maxRows = 12
  const visible = rows.slice(0, maxRows)

  const weights = columns.map((column) => {
    const headerLen = column.title.length * 2
    const bodyLen = Math.max(
      0,
      ...rows.map((row) => {
        const index = columns.indexOf(column)
        const value = asCellText(row[index] ?? null, column)
        return value.length * (column.type === 'text' ? 2 : 1)
      })
    )
    return Math.max(8, Math.min(40, Math.max(headerLen, bodyLen)))
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const colW = weights.map((weight) => (weight / total) * CONTENT_W)

  const header: PptxGenJS.TableRow = columns.map((column) => ({
    text: column.title,
    options: {
      bold: true,
      color: C.white,
      fill: { color: C.primary },
      align: column.type === 'text' ? 'left' : 'right',
      fontFace: FONT,
      fontSize: 12,
      valign: 'middle',
    },
  }))

  const body: PptxGenJS.TableRow[] = visible.map((row, rowIndex) =>
    columns.map((column, colIndex) => ({
      text: asCellText(row[colIndex] ?? null, column),
      options: {
        color: C.ink,
        fill: { color: rowIndex % 2 === 0 ? C.white : C.soft },
        align: column.type === 'text' ? 'left' : 'right',
        fontFace: FONT,
        fontSize: 11,
        valign: 'middle',
      },
    }))
  )

  slide.addTable([header, ...body], {
    x: MARGIN,
    y: top,
    w: CONTENT_W,
    colW,
    rowH: 0.42,
    border: { type: 'solid', color: C.line, pt: 0.75 },
    autoPage: false,
  })

  if (rows.length > maxRows) {
    slide.addText(`表格较长，此处显示前 ${maxRows} 行，完整数据见配套的 Excel 报表`, {
      x: MARGIN,
      y: top + 0.42 * (visible.length + 1) + 0.12,
      w: CONTENT_W,
      h: 0.32,
      fontFace: FONT,
      fontSize: 10,
      color: C.muted,
      italic: true,
    })
  }
}

/** 要点页：首行加粗色块引导，正文用项目符号 */
const addBullets = (slide: PptxGenJS.Slide, bullets: string[], top: number, side?: { x: number; w: number }) => {
  if (bullets.length === 0) {
    return
  }
  const x = side?.x ?? MARGIN
  const w = side?.w ?? CONTENT_W
  // 条目多就缩小字号，避免溢出页面
  const fontSize = bullets.length > 6 ? 16 : bullets.length > 4 ? 18 : 20
  slide.addText(
    bullets.map((text) => ({
      text,
      options: { bullet: { code: '25CF' }, breakLine: true },
    })),
    {
      x,
      y: top,
      w,
      h: H - top - 0.85,
      fontFace: FONT,
      fontSize,
      color: C.ink,
      lineSpacingMultiple: 1.4,
      valign: 'top',
      paraSpaceAfter: 10,
    }
  )
}

const addTitleSlide = (pptx: PptxGenJS.Presentation, spec: SlideSpec, deck: DeckSpec) => {
  const slide = pptx.addSlide()
  slide.background = { color: C.primary }
  // 右下角装饰块，避免整页纯色显得空
  slide.addShape('rect', {
    x: W - 3.6,
    y: H - 3.6,
    w: 3.6,
    h: 3.6,
    fill: { color: '2A4775' },
    line: { color: '2A4775', width: 0 },
  })
  slide.addShape('rect', {
    x: MARGIN,
    y: H / 2 - 0.95,
    w: 1.2,
    h: 0.06,
    fill: { color: C.accent },
    line: { color: C.accent, width: 0 },
  })
  slide.addText(spec.title ?? deck.title ?? '演示文稿', {
    x: MARGIN,
    y: H / 2 - 0.75,
    w: CONTENT_W - 1.5,
    h: 1.3,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: C.white,
    valign: 'middle',
  })
  const subtitle = spec.subtitle ?? deck.subtitle
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN,
      y: H / 2 + 0.6,
      w: CONTENT_W - 1.5,
      h: 0.6,
      fontFace: FONT,
      fontSize: 18,
      color: 'C7D2E4',
      valign: 'middle',
    })
  }
  return slide
}

const addSectionSlide = (pptx: PptxGenJS.Presentation, spec: SlideSpec) => {
  const slide = pptx.addSlide()
  slide.background = { color: C.soft }
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 0.28,
    h: H,
    fill: { color: C.primary },
    line: { color: C.primary, width: 0 },
  })
  slide.addText(spec.title ?? '', {
    x: MARGIN,
    y: H / 2 - 0.7,
    w: CONTENT_W,
    h: 1,
    fontFace: FONT,
    fontSize: 32,
    bold: true,
    color: C.primary,
    valign: 'middle',
  })
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: MARGIN,
      y: H / 2 + 0.35,
      w: CONTENT_W,
      h: 0.5,
      fontFace: FONT,
      fontSize: 16,
      color: C.muted,
      valign: 'middle',
    })
  }
  return slide
}

const addClosingSlide = (pptx: PptxGenJS.Presentation, spec: SlideSpec) => {
  const slide = pptx.addSlide()
  slide.background = { color: C.primary }
  slide.addText(spec.title ?? '谢谢', {
    x: MARGIN,
    y: H / 2 - 0.8,
    w: CONTENT_W,
    h: 1,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: C.white,
    align: 'center',
    valign: 'middle',
  })
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: MARGIN,
      y: H / 2 + 0.4,
      w: CONTENT_W,
      h: 0.5,
      fontFace: FONT,
      fontSize: 16,
      color: 'C7D2E4',
      align: 'center',
      valign: 'middle',
    })
  }
  return slide
}

/** 生成 pptx Blob。 */
export const buildDeck = async (spec: DeckSpec): Promise<{ blob: Blob; filename: string }> => {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'CUSTOM_16x9', width: W, height: H })
  pptx.layout = 'CUSTOM_16x9'
  pptx.author = ''
  pptx.company = ''
  pptx.title = spec.title ?? ''

  const deckTitle = spec.title
  spec.slides.forEach((slideSpec, index) => {
    const pageNo = index + 1
    // 封面不显示页码，其余页统一加页眉页脚
    switch (slideSpec.layout) {
      case 'title': {
        addTitleSlide(pptx, slideSpec, spec)
        return
      }
      case 'section': {
        addSectionSlide(pptx, slideSpec)
        return
      }
      case 'closing': {
        addClosingSlide(pptx, slideSpec)
        return
      }
      case 'table': {
        const slide = pptx.addSlide()
        const top = addHeader(slide, slideSpec.title)
        addTable(slide, slideSpec, top)
        addFooter(slide, pageNo, deckTitle)
        if (slideSpec.notes) {
          slide.addNotes(slideSpec.notes)
        }
        return
      }
      case 'twoColumn': {
        const slide = pptx.addSlide()
        const top = addHeader(slide, slideSpec.title)
        const gap = 0.5
        const colW = (CONTENT_W - gap) / 2
        const sides = [
          { data: slideSpec.left, x: MARGIN },
          { data: slideSpec.right, x: MARGIN + colW + gap },
        ]
        sides.forEach(({ data, x }) => {
          if (!data) {
            return
          }
          if (data.heading) {
            slide.addText(data.heading, {
              x,
              y: top,
              w: colW,
              h: 0.45,
              fontFace: FONT,
              fontSize: 17,
              bold: true,
              color: C.accent,
              valign: 'middle',
            })
          }
          addBullets(slide, data.bullets, top + (data.heading ? 0.55 : 0), { x, w: colW })
        })
        addFooter(slide, pageNo, deckTitle)
        if (slideSpec.notes) {
          slide.addNotes(slideSpec.notes)
        }
        return
      }
      default: {
        const slide = pptx.addSlide()
        const top = addHeader(slide, slideSpec.title)
        if (slideSpec.subtitle) {
          slide.addText(slideSpec.subtitle, {
            x: MARGIN,
            y: top - 0.15,
            w: CONTENT_W,
            h: 0.4,
            fontFace: FONT,
            fontSize: 14,
            color: C.muted,
            valign: 'middle',
          })
        }
        addBullets(slide, slideSpec.bullets ?? [], top + (slideSpec.subtitle ? 0.4 : 0))
        addFooter(slide, pageNo, deckTitle)
        if (slideSpec.notes) {
          slide.addNotes(slideSpec.notes)
        }
      }
    }
  })

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob
  return {
    blob,
    filename: toFileName(spec.filename ?? spec.title ?? '', '演示文稿', '.pptx'),
  }
}
