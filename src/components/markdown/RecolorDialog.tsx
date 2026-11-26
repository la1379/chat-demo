import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { RecolorPanel } from './RecolorPanel.js'
import { closeRecolorDialog, useRecolorDialog } from './recolorDialogState.js'
import styles from './RecolorDialog.module.css'

/**
 * 独立的改配色弹窗：不需要 API Key、不需要对话，点开就能用。
 *
 * 面板本身与对话里 `recolor` 代码块渲染的是同一个组件，逻辑只有一份；
 * 这里只负责给它在弹窗里安排一个能展开的容器。
 */
export const RecolorDialog = () => {
  const t = useTranslate()
  const open = useRecolorDialog((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <Modal
      title={t('recolorDialogTitle')}
      closable
      className={styles.dialog}
      mainClassName={styles.main}
      onClose={closeRecolorDialog}
    >
      <RecolorPanel flat />
    </Modal>
  )
}
