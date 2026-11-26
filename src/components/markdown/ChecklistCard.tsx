import { memo, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  loadChecked,
  parseChecklistSpec,
  saveChecked,
  type ChecklistItem,
} from '../../services/office/checklist.js'
import styles from './ChecklistCard.module.css'

/**
 * 清单卡片：可勾选、状态存本地。
 *
 * 勾选状态按「清单 id + 条目下标」存，所以刷新页面、切走再回来都还在；
 * 同一份清单被重新生成时 id 不变（由标题与条目内容拼哈希），不会丢。
 */
export const ChecklistCard = memo(function ChecklistCard({
  code,
  loading,
}: {
  code: string
  loading?: boolean
}) {
  const t = useTranslate()
  const spec = useMemo(() => (loading ? null : parseChecklistSpec(code)), [code, loading])
  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    loading || !spec ? {} : loadChecked(spec.id)
  )

  if (loading) {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.title}>{t('checklistGenerating')}</span>
        </div>
        <div className={styles.skeleton} />
      </div>
    )
  }

  if (!spec) {
    return <pre className={styles.raw}>{code}</pre>
  }

  const toggle = (index: number) => {
    setChecked((prev) => {
      const next = { ...prev, [index]: !prev[index] }
      saveChecked(spec.id, next)
      return next
    })
  }

  const done = spec.items.filter((_, index) => checked[index]).length
  const total = spec.items.length

  // 有分组就按组渲染，否则平铺
  const groups: { name: string | undefined; entries: { item: ChecklistItem; index: number }[] }[] = []
  spec.items.forEach((item, index) => {
    const name = item.group
    const last = groups.at(-1)
    if (last && last.name === name) {
      last.entries.push({ item, index })
    } else {
      groups.push({ name, entries: [{ item, index }] })
    }
  })

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>{spec.title}</span>
        <span className={styles.progress}>
          {t('checklistProgress', { done, total })}
        </span>
      </div>
      <div className={styles.body}>
        {groups.map((group, groupIndex) => (
          <div key={`${group.name ?? ''}-${groupIndex}`} className={styles.group}>
            {group.name ? <div className={styles.groupName}>{group.name}</div> : null}
            <ul className={styles.list}>
              {group.entries.map(({ item, index }) => (
                <li key={index} className={styles.row}>
                  <label className={checked[index] ? styles.labelOn : styles.label}>
                    <input
                      type="checkbox"
                      className={styles.box}
                      checked={checked[index] === true}
                      onChange={() => toggle(index)}
                    />
                    <span className={checked[index] ? styles.textOn : styles.text}>{item.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
})
