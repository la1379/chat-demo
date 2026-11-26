import { createElement, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  BlockContent,
  DefinitionContent,
  List as ListNode,
  PhrasingContent,
  Root,
  Table as TableNode,
} from 'mdast'
import { CitationLink } from '../search/CitationLink.js'
import { CodeBlock } from './CodeBlock.js'
import { ImageAsLink, Link } from './Link.js'
import { InlineMath, MathBlock } from './MathFormula.js'
import { compareCells, formatSum, profileColumn } from '../../services/markdown/tableEnhance.js'

const Html = memo(function Html({ value }: { value: string }) {
  if (/^<br\s*\/?>$/i.test(value)) {
    return <br />
  }
  return <span className="ds-markdown-html">{value}</span>
})

const List = memo(function List({ node, loading }: { node: ListNode; loading: boolean }) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag start={node.ordered ? node.start || undefined : undefined}>
      {node.children.map((child, index) => {
        // GFM: task item 的 checked 为 boolean；普通 listItem 为 null
        const checked = child.checked
        const isTaskItem = typeof checked === 'boolean'
        return (
          <li key={index} className={isTaskItem ? 'ds-markdown-task-list-item' : undefined}>
            {isTaskItem ? (
              // □ U+25A1 / ☑ U+2611
              <span className="ds-markdown-task-checkbox">{checked ? '☑  ' : '□  '}</span>
            ) : null}
            <MarkdownBlockContentOrDefinitionContent nodes={child.children} loading={loading} />
          </li>
        )
      })}
    </ListTag>
  )
})

/** 把 mdast 的单元格取成纯文本；排序与合计都基于这个 */
const cellText = (cell: { children: PhrasingContent[] }): string =>
  cell.children
    .map((child) => {
      if ('value' in child && typeof child.value === 'string') {
        return child.value
      }
      if (child.type === 'inlineCode') {
        return child.value
      }
      return ''
    })
    .join('')
    .trim()

const Table = memo(function Table({ node }: { node: TableNode }) {
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null)
  const header = node.children[0]
  const bodyRows = node.children.slice(1)
  const columnCount = header?.children.length ?? 0

  // 先取纯文本，排序和列分析都要用
  const rowTexts = bodyRows.map((row) => row.children.map(cellText))

  const profiles = Array.from({ length: columnCount }, (_, columnIndex) =>
    profileColumn(rowTexts.map((cells) => cells[columnIndex] ?? ''))
  )

  const order = useMemo(() => {
    if (!sort) {
      return null
    }
    return rowTexts
      .map((_, index) => index)
      .sort((a, b) => {
        const result = compareCells(rowTexts[a][sort.column] ?? '', rowTexts[b][sort.column] ?? '')
        return sort.desc ? -result : result
      })
  }, [sort, rowTexts])

  const visibleRows = order ? order.map((index) => bodyRows[index]) : bodyRows
  const hasAnySum = profiles.some((profile) => profile.sum !== null)

  const onSort = (columnIndex: number) => {
    setSort((prev) =>
      prev && prev.column === columnIndex ? { column: columnIndex, desc: !prev.desc } : { column: columnIndex, desc: false }
    )
  }

  return (
    <div className="markdown-table-wrapper">
      <table>
        {header ? (
          <thead>
            <tr>
              {header.children.map((cell, cellIndex) => {
                const active = sort?.column === cellIndex
                return (
                  <th key={cellIndex} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                    <button
                      type="button"
                      className={clsx('markdown-table-sort', active && 'is-active')}
                      onClick={() => onSort(cellIndex)}
                      title="点击排序"
                    >
                      <MarkdownPhrasingContent nodes={cell.children} />
                      <span className="markdown-table-sort-icon" aria-hidden="true">
                        {active ? (sort.desc ? '↓' : '↑') : '↕'}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
        ) : null}
        {visibleRows.length > 0 ? (
          <tbody>
            {visibleRows.map((row, rowIndex) => {
              const curColumnCount = row.children.length || 0
              return (
                <tr key={order ? order[rowIndex] : rowIndex}>
                  {row.children.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <MarkdownPhrasingContent nodes={cell.children} />
                    </td>
                  ))}
                  {/* 补齐到列数 */}
                  {Array.from({ length: columnCount - curColumnCount }).map((_, idx) => (
                    <td key={`ptd_${idx}`} />
                  ))}
                </tr>
              )
            })}
          </tbody>
        ) : null}
        {/*
          合计只在整列都是数字时出现。把年份、编号这类列相加没有任何意义，
          给出一个看着像真的、其实错的数字比不给更糟。
        */}
        {hasAnySum ? (
          <tfoot>
            <tr className="markdown-table-sum">
              {Array.from({ length: columnCount }).map((_, cellIndex) => (
                <td key={cellIndex}>
                  {cellIndex === 0
                    ? '合计'
                    : profiles[cellIndex]?.sum !== null
                      ? formatSum(profiles[cellIndex])
                      : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
})

const MarkdownPhrasingContent = memo(function MarkdownPhrasingContent({
  nodes,
}: {
  nodes: PhrasingContent[]
}) {
  return (
    <>
      {nodes.map((node, index) => {
        return <MarkdownPhrasingContentItem key={index} node={node} />
      })}
    </>
  )
})

const MarkdownPhrasingContentItem = memo(function MarkdownPhrasingContentItem({
  node,
}: {
  node: PhrasingContent
}) {
  switch (node.type) {
    case 'inlineMath':
      return <InlineMath value={node.value} />
    case 'break':
      return <br />
    case 'emphasis':
      return (
        <em>
          <MarkdownPhrasingContent nodes={node.children} />
        </em>
      )
    case 'image':
      return <ImageAsLink node={node} />
    case 'html':
      return <Html value={node.value} />
    case 'inlineCode':
      return <code>{node.value}</code>
    case 'link':
      return (
        <Link node={node}>
          <MarkdownPhrasingContent nodes={node.children} />
        </Link>
      )
    case 'strong':
      return (
        <strong>
          <MarkdownPhrasingContent nodes={node.children} />
        </strong>
      )
    case 'text':
      return <TextContent>{node.value}</TextContent>
    case 'citation':
      return <CitationLink source={node.source} />
    default:
      // 删除线、脚注、引用式链接已在解析时换成文本
      return null
  }
})

// 按 \n 拆行插 <br>：源文每个换行（含软换行）都渲染为视觉换行
const TextContent = memo(function TextContent({ children }: { children: string }) {
  const result: ReactNode[] = []
  children.split(/\r?\n/).forEach((line, index) => {
    result.push(<span key={index + 's'}>{line}</span>, <br key={index + 'br'} />)
  })
  result.pop()
  return result
})

const MarkdownBlockContentOrDefinitionContent = memo(
  function MarkdownBlockContentOrDefinitionContent({
    nodes,
    loading,
  }: {
    nodes: Array<BlockContent | DefinitionContent>
    loading: boolean
  }) {
    return nodes.map((node, index) => {
      switch (node.type) {
        case 'math':
          return <MathBlock key={index} value={node.value} />
        case 'thematicBreak':
          return <hr key={index} />
        case 'blockquote':
          return (
            <blockquote key={index}>
              <MarkdownBlockContentOrDefinitionContent nodes={node.children} loading={loading} />
            </blockquote>
          )
        case 'html':
          return <Html key={index} value={node.value} />
        case 'heading':
          return node.children.length === 0
            ? null
            : createElement(
                `h${node.depth}`,
                { key: index },
                <MarkdownPhrasingContent nodes={node.children} />
              )
        case 'paragraph':
          return (
            <p key={index} className="ds-markdown-paragraph">
              <MarkdownPhrasingContent nodes={node.children} />
            </p>
          )
        case 'code':
          return (
            <CodeBlock
              key={index}
              code={node.value}
              infostring={node.lang || 'text'}
              loading={loading}
            />
          )
        case 'table':
          return <Table node={node} key={index} />
        case 'list':
          return <List key={index} node={node} loading={loading} />
        default:
          // 脚注与定义已在解析时换成段落
          return null
      }
    })
  }
)

export const MarkdownAstRenderer = memo(function MarkdownAstRenderer({
  ast,
  onUpdate,
  className,
  loading = false,
}: {
  ast: Root
  className?: string
  loading?: boolean
  /**
   * layoutEffect 之后触发 -> 进行页面滚动
   */
  onUpdate: () => void
}) {
  const onUpdateRef = useRef<() => void>(() => 0)
  onUpdateRef.current = onUpdate
  useLayoutEffect(() => {
    onUpdateRef.current()
  }, [ast.children])

  return useMemo(
    () => (
      <div className={clsx('ds-markdown', className)}>
        {/* 解析器在根节点下产出块级内容。 */}
        <MarkdownBlockContentOrDefinitionContent
          nodes={ast.children as Array<BlockContent | DefinitionContent>}
          loading={loading}
        />
      </div>
    ),
    [className, ast.children, loading]
  )
})
