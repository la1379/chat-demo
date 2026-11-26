import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { IconPaletteOutline16 } from '../base/icons.js'
import { openRecolorDialog } from '../markdown/recolorDialogState.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
        {/*
          改配色不需要模型，所以放在这里而不是对话里：
          没填 API Key、断网、余额不足都能用。
        */}
        <button type="button" className={styles.shortcut} onClick={openRecolorDialog}>
          <IconPaletteOutline16 />
          {t('recolorShortcut')}
        </button>
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
