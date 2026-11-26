import { memo, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { showToast } from '../base/toastState.js'
import { formatMail, parseMailSpec } from '../../services/office/mail.js'
import styles from './MailCard.module.css'

/** 复制到剪贴板；失败时明确告知，不静默吞掉 */
const copyText = async (text: string, okMessage: string, failMessage: string) => {
  try {
    await navigator.clipboard.writeText(text)
    showToast(okMessage)
  } catch {
    // 非 HTTPS 或权限被拒时会走到这里
    showToast(failMessage)
  }
}

/**
 * 邮件草稿卡片。
 *
 * 只负责整理内容 + 一键复制，不做「发送」：纯静态网页没有她的邮箱授权，
 * 也不该替她按下发送键。正文单独成块，省得她从聊天气泡里手动挑。
 */
export const MailCard = memo(function MailCard({
  code,
  loading,
}: {
  code: string
  loading?: boolean
}) {
  const t = useTranslate()
  const [showRaw, setShowRaw] = useState(false)
  const mail = useMemo(() => (loading ? null : parseMailSpec(code)), [code, loading])

  if (loading) {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.title}>{t('mailGenerating')}</span>
        </div>
        <div className={styles.skeleton} />
      </div>
    )
  }

  if (!mail) {
    return <pre className={styles.raw}>{code}</pre>
  }

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>{mail.subject || t('mailUntitled')}</span>
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={() => setShowRaw((value) => !value)}>
            {showRaw ? t('mailShowDraft') : t('mailShowSource')}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void copyText(formatMail(mail), t('mailCopied'), t('mailCopyFailed'))}
          >
            {t('mailCopy')}
          </button>
        </div>
      </div>

      {showRaw ? (
        <pre className={styles.raw}>{formatMail(mail)}</pre>
      ) : (
        <div className={styles.body}>
          <dl className={styles.fields}>
            {mail.to.length > 0 ? (
              <>
                <dt>{t('mailTo')}</dt>
                <dd>{mail.to.join('；')}</dd>
              </>
            ) : null}
            {mail.cc.length > 0 ? (
              <>
                <dt>{t('mailCc')}</dt>
                <dd>{mail.cc.join('；')}</dd>
              </>
            ) : null}
            {mail.subject ? (
              <>
                <dt>{t('mailSubject')}</dt>
                <dd>{mail.subject}</dd>
              </>
            ) : null}
          </dl>
          {/* 正文保留原始换行，不折叠空白 */}
          <div className={styles.content}>{mail.body}</div>
          {mail.note ? <p className={styles.note}>{mail.note}</p> : null}
        </div>
      )}
    </div>
  )
})
