import { useTranslate } from '../../i18n/index.js'
import { memo, useMemo, useRef, useState } from 'react'
import { showToast } from '../base/toastState.js'
import {
  analyzeColors,
  analyzeTheme,
  applyColorMapping,
  buildPaletteMapping,
  PALETTE_PRESETS,
  saturationOf,
  THEME_SLOT_LABELS,
} from '../../services/pptx/recolor.js'
import type { ColorInfo, ColorMapping, ThemeSlot } from '../../services/pptx/recolor.js'
import { analyzeMedia, describeMediaRisk } from '../../services/pptx/media.js'
import type { MediaColorRisk } from '../../services/pptx/media.js'
import { recolorImages } from '../../services/pptx/imageRecolor.js'
import { downloadBlob, toFileName } from '../../services/office/spec.js'
import styles from './RecolorPanel.module.css'

/** 单个颜色的编辑行 */
const ColorRow = memo(function ColorRow({
  color,
  value,
  locked,
  onLock,
  onChange,
}: {
  color: ColorInfo
  value: string | undefined
  locked: boolean
  onLock: () => void
  onChange: (hex: string) => void
}) {
  return (
    <li className={locked ? styles.rowLocked : styles.row}>
      <input
        type="color"
        className={styles.swatch}
        value={`#${value ?? color.hex}`}
        disabled={locked}
        onChange={(event) => onChange(event.target.value.replace('#', '').toUpperCase())}
        aria-label={`颜色 ${color.hex}`}
      />
      <span className={styles.hex}>#{value ?? color.hex}</span>
      {value && value !== color.hex ? (
        <span className={styles.arrow}>← #{color.hex}</span>
      ) : null}
      <span className={styles.count}>×{color.count}</span>
      <button
        type="button"
        className={locked ? styles.lockOn : styles.lock}
        onClick={onLock}
        title={locked ? '取消锁定（该颜色不变）' : '锁定此颜色不变'}
      >
        {locked ? '🔒' : '🔓'}
      </button>
    </li>
  )
})

/**
 * 配色面板：读取用户上传的 pptx，分析用色，改色后重新打包下载。
 *
 * 只动颜色值，文件其他部分原样保留，所以内容和排版自动不变 ——
 * 这正是「内容和排版均未改动，只改配色」这个需求的实现方式。
 */
export const RecolorPanel = memo(function RecolorPanel({ loading }: { loading?: boolean }) {
  const t = useTranslate()
  const [fileName, setFileName] = useState('')
  const [raw, setRaw] = useState<Uint8Array | null>(null)
  const [colors, setColors] = useState<ColorInfo[]>([])
  const [theme, setTheme] = useState<ThemeSlot[]>([])
  const [media, setMedia] = useState<MediaColorRisk[]>([])
  // 图片换色：默认开启，但让用户能关掉（照片类素材不该换色）
  const [withImages, setWithImages] = useState(true)
  const [mapping, setMapping] = useState<ColorMapping>({})
  const [locked, setLocked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      showToast('目前只支持 .pptx 文件（.ppt 请先用 PowerPoint 另存为 .pptx）')
      return
    }
    setBusy(true)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const found = analyzeColors(data)
      setRaw(data)
      setFileName(file.name)
      setColors(found)
      setTheme(analyzeTheme(data))
      setMedia(analyzeMedia(data))
      setMapping({})
      setLocked(new Set())
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** 应用预设配色；锁定的颜色不参与 */
  const applyPreset = (targetHue: number) => {
    const next = buildPaletteMapping(colors, targetHue, Array.from(locked))
    if (Object.keys(next).length === 0) {
      showToast('没有找到可调整的颜色')
      return
    }
    setMapping(next)
  }

  /** 常用的鲜艳色，方便用户锁定品牌色 */
  const brandCandidates = useMemo(
    () => colors.filter((color) => saturationOf(color.hex) >= 0.5 && color.count >= 10).slice(0, 4),
    [colors]
  )

  const onDownload = async () => {
    if (!raw) {
      return
    }
    if (Object.keys(mapping).length === 0) {
      showToast('还没有任何颜色被改动')
      return
    }
    setBusy(true)
    try {
      let out = applyColorMapping(raw, mapping)
      // 图片里的颜色是纯像素运算，不需要任何 AI 模型；
      // 但照片类素材换色会失真，所以交给用户决定要不要一起改
      if (withImages) {
        const result = await recolorImages(out, mapping)
        out = result.data
        if (result.changed > 0) {
          showToast(`同时调整了 ${result.changed} 张图片的配色`)
        }
        const complexSkipped = result.skipped.filter((item) => item.reason.includes('色彩丰富'))
        if (complexSkipped.length > 0) {
          showToast(`${complexSkipped.length} 张照片类图片未改动（换色会失真）`)
        }
      }
      const blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
      const base = fileName.replace(/\.pptx$/i, '')
      downloadBlob(blob, toFileName(`${base}_改配色`, '演示文稿_改配色', '.pptx'))
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (!raw) {
    return (
      <div className={styles.drop}>
        <input
          ref={inputRef}
          type="file"
          accept=".pptx"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void loadFile(file)
            }
            event.target.value = ''
          }}
        />
        <p className={styles.dropTitle}>上传 PPT，改配色</p>
        <p className={styles.dropHint}>
          内容和排版完全不动，只换颜色。适合把一套 PPT 整体换成更商务的配色。
        </p>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || loading}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? '正在读取…' : '选择 .pptx 文件'}
        </button>
      </div>
    )
  }

  const changedCount = Object.keys(mapping).length
  const mediaWarning = describeMediaRisk(media)
  // 主题色的总引用量决定要不要显示主题区：全是 0 说明这份 PPT 没在用主题色
  const themeReferences = theme.reduce((sum, slot) => sum + slot.references, 0)

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.fileName}>{fileName}</span>
        <span className={styles.fileMeta}>
          {colors.length} 种颜色 · 拟改 {changedCount} 种
        </span>
      </div>

      {mediaWarning ? (
        <div className={styles.warning}>
          <strong>图片</strong>
          <span>{mediaWarning}</span>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={withImages}
              onChange={(event) => setWithImages(event.target.checked)}
            />
            一起调整图片配色
          </label>
        </div>
      ) : null}

      {themeReferences > 0 ? (
        <div className={styles.themeBlock}>
          <div className={styles.themeHead}>
            <strong>主题色</strong>
            <span>
              这份 PPT 的设计色定义在主题里，改一处会影响 {themeReferences} 处引用，效果最快
            </span>
          </div>
          <ul className={styles.themeList}>
            {theme
              .filter((slot) => slot.references > 0 || slot.slot.startsWith('accent'))
              .map((slot) => (
                <li key={slot.slot} className={styles.themeRow}>
                  <input
                    type="color"
                    className={styles.swatch}
                    value={`#${mapping[slot.hex] ?? slot.hex}`}
                    onChange={(event) =>
                      setMapping((prev) => ({
                        ...prev,
                        [slot.hex]: event.target.value.replace('#', '').toUpperCase(),
                      }))
                    }
                  />
                  <span className={styles.slotName}>{THEME_SLOT_LABELS[slot.slot] ?? slot.slot}</span>
                  <span className={styles.hex}>#{mapping[slot.hex] ?? slot.hex}</span>
                  <span className={styles.count}>
                    {slot.references > 0 ? `影响 ${slot.references} 处` : '未使用'}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {changedCount > 0 ? (
        <div className={styles.beforeAfter}>
          <span className={styles.presetLabel}>配色对照：</span>
          <div className={styles.swatchRow}>
            {colors
              .filter((color) => mapping[color.hex])
              .slice(0, 12)
              .map((color) => (
                <span key={color.hex} className={styles.pair} title={`#${color.hex} → #${mapping[color.hex]}`}>
                  <span className={styles.dot} style={{ background: `#${color.hex}` }} />
                  <span className={styles.pairArrow}>→</span>
                  <span className={styles.dot} style={{ background: `#${mapping[color.hex]}` }} />
                </span>
              ))}
          </div>
        </div>
      ) : null}

      <div className={styles.presets}>
        <span className={styles.presetLabel}>一键换配色：</span>
        {PALETTE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={styles.preset}
            onClick={() => applyPreset(preset.hue)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {brandCandidates.length > 0 ? (
        <div className={styles.presets}>
          <span className={styles.presetLabel}>锁定品牌色：</span>
          {brandCandidates.map((color) => (
            <button
              key={color.hex}
              type="button"
              className={locked.has(color.hex) ? styles.chipOn : styles.chip}
              onClick={() => {
                setLocked((prev) => {
                  const next = new Set(prev)
                  if (next.has(color.hex)) {
                    next.delete(color.hex)
                  } else {
                    next.add(color.hex)
                  }
                  return next
                })
                // 锁定时把该颜色从现有映射里删掉
                setMapping((prev) => {
                  const next = { ...prev }
                  delete next[color.hex]
                  return next
                })
              }}
            >
              <span className={styles.dot} style={{ background: `#${color.hex}` }} />#{color.hex}
            </button>
          ))}
        </div>
      ) : null}

      <ul className={styles.list}>
        {colors.slice(0, 60).map((color) => (
          <ColorRow
            key={color.hex}
            color={color}
            value={mapping[color.hex]}
            locked={locked.has(color.hex)}
            onLock={() => {
              setLocked((prev) => {
                const next = new Set(prev)
                if (next.has(color.hex)) {
                  next.delete(color.hex)
                } else {
                  next.add(color.hex)
                }
                return next
              })
              setMapping((prev) => {
                const next = { ...prev }
                delete next[color.hex]
                return next
              })
            }}
            onChange={(hex) => setMapping((prev) => ({ ...prev, [color.hex]: hex }))}
          />
        ))}
      </ul>
      {colors.length > 60 ? (
        <p className={styles.more}>仅显示使用最多的 60 种颜色</p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.ghost} onClick={() => setMapping({})}>
          还原
        </button>
        <button type="button" className={styles.ghost} onClick={() => setRaw(null)}>
          换一个文件
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || changedCount === 0}
          onClick={onDownload}
        >
          {busy ? '正在生成…' : `${t('fileCardDownload')}（改 ${changedCount} 种色）`}
        </button>
      </div>
    </div>
  )
})
