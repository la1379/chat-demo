/**
 * 生成 .xlsx。
 *
 * 手写 OOXML 而不是引第三方表格库：这里只需要「一张带样式的表」，
 * xlsx 的最小可用结构就是 5 个 XML 文件打进一个 zip，可预测、可审阅。
 * zip 用项目已有的 fflate，不新增依赖。
 */
import { strToU8, zipSync } from 'fflate'
import type { Column, Row, SheetSpec, WorkbookSpec } from './spec.js'
import { toFileName } from './spec.js'

/** XML 文本转义；& 必须最先替换，否则会二次转义 */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** 列序号转字母：0 -> A, 25 -> Z, 26 -> AA */
const colLetter = (index: number): string => {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Excel 1900 日期系统的纪元；用 UTC 运算避开本地时区偏移 */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000

/** 只认 YYYY-MM-DD / YYYY/MM/DD 这类明确写法，其余保持文本，不猜 */
const parseDateSerial = (value: string): number | null => {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const time = Date.UTC(year, month - 1, day)
  const probe = new Date(time)
  // 2 月 30 日这类会被 Date 顺延，回读对不上就判为无效
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null
  }
  return Math.round((time - EXCEL_EPOCH) / DAY_MS)
}

/** 一个单元格的落盘形态：以内联字符串或数值写入 */
type Cell =
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'date'; serial: number }

const toCell = (value: string | number | null, column: Column | undefined): Cell => {
  const type = column?.type ?? 'text'
  if (value === null || value === '') {
    return { kind: 'text', text: '' }
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'text', text: '' }
  }
  const trimmed = value.trim()
  if (type === 'date') {
    const serial = parseDateSerial(trimmed)
    return serial === null ? { kind: 'text', text: trimmed } : { kind: 'date', serial }
  }
  if (type === 'number' || type === 'currency' || type === 'percent') {
    // 允许 "1,234.5"、"12%"、"¥88" 这类带装饰的数字，去掉后再判
    const cleaned = trimmed.replace(/[,¥$€£\s%]/g, '')
    const parsed = Number(cleaned)
    if (cleaned !== '' && Number.isFinite(parsed)) {
      const value = type === 'percent' && /%/.test(trimmed) ? parsed / 100 : parsed
      return { kind: 'number', value }
    }
    // 解析不了就按文本放进去，不静默丢数据
    return { kind: 'text', text: trimmed }
  }
  return { kind: 'text', text: value }
}

/** 样式下标；顺序必须与 buildStyles 里的 cellXfs 一致 */
const STYLE = {
  header: 1,
  text: 0,
  number: 2,
  currency: 3,
  percent: 4,
  date: 5,
  totalText: 6,
  totalNumber: 7,
  totalCurrency: 8,
  totalPercent: 9,
  totalDate: 10,
} as const

const styleFor = (type: Column['type'], isTotal: boolean): number => {
  const normalized = type ?? 'text'
  if (isTotal) {
    switch (normalized) {
      case 'number':
        return STYLE.totalNumber
      case 'currency':
        return STYLE.totalCurrency
      case 'percent':
        return STYLE.totalPercent
      case 'date':
        return STYLE.totalDate
      default:
        return STYLE.totalText
    }
  }
  switch (normalized) {
    case 'number':
      return STYLE.number
    case 'currency':
      return STYLE.currency
    case 'percent':
      return STYLE.percent
    case 'date':
      return STYLE.date
    default:
      return STYLE.text
  }
}

/** 中日韩字符按两个字符宽估算，列宽才不会挤 */
const displayWidth = (text: string): number => {
  let width = 0
  for (const char of text) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(
      char
    )
      ? 2
      : 1
  }
  return width
}

const autoWidth = (sheet: SheetSpec, columnIndex: number): number => {
  const header = sheet.columns[columnIndex]?.title ?? ''
  let max = displayWidth(header)
  for (const row of sheet.rows) {
    const cell = row[columnIndex]
    if (cell !== null && cell !== undefined) {
      max = Math.max(max, displayWidth(String(cell)))
    }
  }
  // 留 2 个字符的余量，限制在合理区间
  return Math.min(50, Math.max(8, max + 2))
}

/** 数值列求和；百分比直接相加会失真，这里仍旧相加并在表头层面由人判断 */
const sumColumn = (sheet: SheetSpec, columnIndex: number, column: Column): number | null => {
  if (column.type !== 'number' && column.type !== 'currency' && column.type !== 'percent') {
    return null
  }
  let total = 0
  let found = false
  for (const row of sheet.rows) {
    const cell = toCell(row[columnIndex] ?? null, column)
    if (cell.kind === 'number') {
      total += cell.value
      found = true
    }
  }
  return found ? total : null
}

/** 工作表名限制 31 字符且不能含 []:*?/\ */
const sheetName = (name: string, index: number, used: Set<string>): string => {
  const cleaned = name.replace(/[[\]:*?/\\]/g, '').trim().slice(0, 31) || `Sheet${index + 1}`
  let candidate = cleaned
  let suffix = 2
  while (used.has(candidate)) {
    const tail = `(${suffix})`
    candidate = `${cleaned.slice(0, 31 - tail.length)}${tail}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

const buildSheetXml = (sheet: SheetSpec): string => {
  const columnCount = Math.max(sheet.columns.length, ...sheet.rows.map((row) => row.length), 0)
  const columns: Column[] = Array.from({ length: columnCount }, (_, index) => {
    return sheet.columns[index] ?? { title: '', type: 'text' }
  })

  const hasTitle = Boolean(sheet.title)
  const titleRow = 1
  const headerRow = hasTitle ? 2 : 1
  const firstDataRow = headerRow + 1

  const rowsXml: string[] = []

  if (hasTitle) {
    const merged = `A${titleRow}:${colLetter(Math.max(columnCount - 1, 0))}${titleRow}`
    rowsXml.push(
      `<row r="${titleRow}" ht="28" customHeight="1">` +
        `<c r="A${titleRow}" s="11" t="inlineStr"><is><t xml:space="preserve">${esc(sheet.title ?? '')}</t></is></c>` +
        `</row>`
    )
    void merged
  }

  // 表头
  rowsXml.push(
    `<row r="${headerRow}" ht="22" customHeight="1">` +
      columns
        .map(
          (column, index) =>
            `<c r="${colLetter(index)}${headerRow}" s="${STYLE.header}" t="inlineStr">` +
            `<is><t xml:space="preserve">${esc(column.title)}</t></is></c>`
        )
        .join('') +
      `</row>`
  )

  // 数据行
  sheet.rows.forEach((row, rowIndex) => {
    const r = firstDataRow + rowIndex
    const cells = columns
      .map((column, index) => {
        const cell = toCell(row[index] ?? null, column)
        const ref = `${colLetter(index)}${r}`
        const style = styleFor(column.type, false)
        if (cell.kind === 'number') {
          return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`
        }
        if (cell.kind === 'date') {
          return `<c r="${ref}" s="${style}"><v>${cell.serial}</v></c>`
        }
        return cell.text === ''
          ? `<c r="${ref}" s="${style}"/>`
          : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.text)}</t></is></c>`
      })
      .join('')
    rowsXml.push(`<row r="${r}">${cells}</row>`)
  })

  // 合计行
  if (sheet.totalRow) {
    const r = firstDataRow + sheet.rows.length
    const cells = columns
      .map((column, index) => {
        const ref = `${colLetter(index)}${r}`
        const style = styleFor(column.type, true)
        if (index === 0) {
          return `<c r="${ref}" s="${STYLE.totalText}" t="inlineStr"><is><t xml:space="preserve">合计</t></is></c>`
        }
        // 合计行用真实公式，用户改数据后 Excel 会自动重算
        const total = sumColumn(sheet, index, column)
        if (total === null) {
          return `<c r="${ref}" s="${style}"/>`
        }
        const lastDataRow = firstDataRow + sheet.rows.length - 1
        if (lastDataRow < firstDataRow) {
          return `<c r="${ref}" s="${style}"><v>0</v></c>`
        }
        const range = `${colLetter(index)}${firstDataRow}:${colLetter(index)}${lastDataRow}`
        return `<c r="${ref}" s="${style}"><f>SUM(${range})</f><v>${total}</v></c>`
      })
      .join('')
    rowsXml.push(`<row r="${r}">${cells}</row>`)
  }

  const widths = columns.map(
    (_, index) => sheet.widths?.[index] ?? autoWidth(sheet, index)
  )
  const colsXml =
    widths.length > 0
      ? `<cols>${widths
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
          )
          .join('')}</cols>`
      : ''

  const lastRow = firstDataRow + sheet.rows.length + (sheet.totalRow ? 1 : 0) - 1
  const dimension = `A1:${colLetter(Math.max(columnCount - 1, 0))}${Math.max(lastRow, 1)}`

  const merges = hasTitle
    ? `<mergeCells count="1"><mergeCell ref="A${titleRow}:${colLetter(Math.max(columnCount - 1, 0))}${titleRow}"/></mergeCells>`
    : ''

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView workbookViewId="0" tabSelected="1">` +
    `<pane ySplit="${headerRow}" topLeftCell="A${firstDataRow}" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/>` +
    colsXml +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    merges +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  )
}

/**
 * 样式表。cellXfs 的顺序必须与 STYLE 常量一一对应：
 * 0 文本 1 表头 2 数值 3 货币 4 百分比 5 日期
 * 6 合计文本 7 合计数值 8 合计货币 9 合计百分比 10 合计日期 11 标题
 */
const buildStylesXml = (): string => {
  const border = (id: number) => `borderId="${id}" applyBorder="1"`
  const font = (id: number) => `fontId="${id}" applyFont="1"`
  const numFmt = (id: number) => `numFmtId="${id}" applyNumberFormat="1"`

  const xfs = [
    // 0 文本
    `<xf ${numFmt(0)} ${font(0)} fillId="0" ${border(1)} xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`,
    // 1 表头
    `<xf ${numFmt(0)} ${font(2)} fillId="2" ${border(1)} xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
    // 2 数值
    `<xf ${numFmt(4)} ${font(0)} fillId="0" ${border(1)} xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    // 3 货币
    `<xf ${numFmt(164)} ${font(0)} fillId="0" ${border(1)} xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    // 4 百分比
    `<xf ${numFmt(10)} ${font(0)} fillId="0" ${border(1)} xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    // 5 日期
    `<xf ${numFmt(14)} ${font(0)} fillId="0" ${border(1)} xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    // 6 合计文本
    `<xf ${numFmt(0)} ${font(1)} fillId="3" ${border(2)} xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`,
    // 7 合计数值
    `<xf ${numFmt(4)} ${font(1)} fillId="3" ${border(2)} xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    // 8 合计货币
    `<xf ${numFmt(164)} ${font(1)} fillId="3" ${border(2)} xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    // 9 合计百分比
    `<xf ${numFmt(10)} ${font(1)} fillId="3" ${border(2)} xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    // 10 合计日期
    `<xf ${numFmt(14)} ${font(1)} fillId="3" ${border(2)} xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    // 11 标题
    `<xf ${numFmt(0)} ${font(3)} fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
  ]

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    // 164 是自定义格式的起始编号，避开内置格式
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0.00"/></numFmts>` +
    `<fonts count="4">` +
    `<font><sz val="11"/><color theme="1"/><name val="等线"/><charset val="134"/></font>` +
    `<font><b/><sz val="11"/><color theme="1"/><name val="等线"/><charset val="134"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="等线"/><charset val="134"/></font>` +
    `<font><b/><sz val="14"/><color theme="1"/><name val="等线"/><charset val="134"/></font>` +
    `</fonts>` +
    // 两个必需的内置填充：none 与 gray125，第三个才是表头底色
    `<fills count="4">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF44546A"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFEDF1F7"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="3">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="medium"><color rgb="FF44546A"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  )
}

const buildWorkbookXml = (names: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<bookViews><workbookView activeTab="0"/></bookViews>` +
  `<sheets>${names
    .map((name, index) => `<sheet name="${esc(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')}</sheets>` +
  `<calcPr calcId="191029" fullCalcOnLoad="1"/>` +
  `</workbook>`

const buildWorkbookRels = (count: number): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  Array.from(
    { length: count },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join('') +
  `<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`

const buildContentTypes = (count: number): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  Array.from(
    { length: count },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('') +
  `</Types>`

const buildRootRels = (): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`

/** 生成 xlsx Blob。 */
export const buildWorkbook = (spec: WorkbookSpec): { blob: Blob; filename: string } => {
  const used = new Set<string>()
  const names = spec.sheets.map((sheet, index) => sheetName(sheet.name, index, used))

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(buildContentTypes(spec.sheets.length)),
    '_rels/.rels': strToU8(buildRootRels()),
    'xl/workbook.xml': strToU8(buildWorkbookXml(names)),
    'xl/_rels/workbook.xml.rels': strToU8(buildWorkbookRels(spec.sheets.length)),
    'xl/styles.xml': strToU8(buildStylesXml()),
  }
  spec.sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(buildSheetXml(sheet))
  })

  const zipped = zipSync(files, { level: 6 })
  const blob = new Blob([zipped], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return {
    blob,
    filename: toFileName(spec.filename ?? spec.title ?? names[0] ?? '', '报表', '.xlsx'),
  }
}
