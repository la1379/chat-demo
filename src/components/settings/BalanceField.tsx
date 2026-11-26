import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { fetchBalance, formatBalance, type BalanceInfo } from '../../services/api/balance.js'
import { useSettings } from '../../services/settings.js'
import styles from './Settings.module.css'

/**
 * 余额查询。
 *
 * 平常不显示数字，点一下才查 —— 余额接口要走网络，没必要每次打开设置都请求。
 * 额度快用完时，这里是唯一能在报错之前提醒她的地方。
 */
export const BalanceField = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const [balance, setBalance] = useState<BalanceInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  if (!apiKey) {
    return null
  }

  const check = async () => {
    setChecking(true)
    setError('')
    try {
      setBalance(await fetchBalance(apiKey))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBalance(null)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className={styles.balance}>
      <button
        type="button"
        className={styles.balanceButton}
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? t('balanceChecking') : balance ? t('balanceRefresh') : t('balanceCheck')}
      </button>
      {balance ? (
        <span className={balance.isAvailable ? styles.balanceValue : styles.balanceEmpty}>
          {formatBalance(balance)}
          {balance.isAvailable ? '' : `（${t('balanceUnavailable')}）`}
        </span>
      ) : null}
      {error ? <span className={styles.balanceError}>{error}</span> : null}
    </div>
  )
}
