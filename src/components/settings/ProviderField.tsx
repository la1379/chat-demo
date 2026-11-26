import { useTranslate } from '../../i18n/index.js'
import { PROVIDERS, getProvider } from '../../services/api/providers.js'
import { setProvider, useSettings } from '../../services/settings.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/**
 * 服务商选择。
 *
 * 两家的 Key 分开存，切换只是换用哪一份：不会拿 A 家的 Key 去打 B 家，
 * 也不用逼用户重填。
 */
export const ProviderField = () => {
  const t = useTranslate()
  const providerId = useSettings((state) => state.provider)
  const provider = getProvider(providerId)

  return (
    <div className={styles.cell}>
      <div className={styles.label}>{t('providerLabel')}</div>
      <Select
        ariaLabel={t('providerLabel')}
        value={providerId}
        options={PROVIDERS.map((item) => ({ value: item.id, label: item.label }))}
        onChange={(value) => setProvider(value as typeof providerId)}
      />
      <div className={styles.hint}>{t('providerSwitchHint')}</div>
      {/* 未端到端验证过的服务商要明说，别让用户以为坏了是自己的问题 */}
      {provider.verified ? null : <div className={styles.hint}>{t('providerUnverified')}</div>}
      {provider.filesApi ? null : <div className={styles.hint}>{t('providerNoFiles')}</div>}
      {provider.balanceUrl ? null : <div className={styles.hint}>{t('providerNoBalance')}</div>}
    </div>
  )
}
