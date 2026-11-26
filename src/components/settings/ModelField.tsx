import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getProvider } from '../../services/api/providers.js'
import { setModelOverride, useSettings } from '../../services/settings.js'
import styles from './Settings.module.css'

/**
 * 模型名。
 *
 * DashScope 的模型名常带版本差异（实测 deepseek-v4-flash-1017 被拒，
 * 裸名 deepseek-v4.1-flash 才行），内置清单不可能覆盖所有账号。
 * 所以给一个手填口子，再配一个「列出可用」按钮直接从账号里读，
 * 免得每次都靠猜或者改代码重编译。
 */
export const ModelField = () => {
  const t = useTranslate()
  const providerId = useSettings((state) => state.provider)
  const override = useSettings((state) => state.modelOverride[state.provider])
  const provider = getProvider(providerId)
  const [draft, setDraft] = useState(override)
  const [listing, setListing] = useState(false)
  const [available, setAvailable] = useState<string[] | null>(null)
  const [error, setError] = useState('')

  const listModels = async () => {
    // DeepSeek 官方的 /models 在 API_ORIGIN 下，这里只处理 OpenAI 兼容的服务商
    const apiKey = useSettings.getState().apiKey
    if (!apiKey) {
      setError(t('modelNeedKey'))
      return
    }
    setListing(true)
    setError('')
    try {
      const response = await fetch(`${provider.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = (await response.json()) as { data?: { id?: string }[] }
      const ids = (data.data ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      setAvailable(ids)
      if (ids.length === 0) {
        setError(t('modelListEmpty'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setListing(false)
    }
  }

  return (
    <div className={styles.cell}>
      <div className={styles.label}>{t('modelLabel')}</div>
      <div className={styles.apiKeyInput}>
        <input
          type="text"
          placeholder={provider.models[0] ?? ''}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              setModelOverride(providerId, draft)
            }
          }}
          onBlur={() => setModelOverride(providerId, draft)}
        />
        {provider.protocol === 'openai' ? (
          <>
            <span className={styles.divider} />
            <button
              type="button"
              className={styles.confirm}
              disabled={listing}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void listModels()}
            >
              {listing ? t('modelListing') : t('modelList')}
            </button>
          </>
        ) : null}
      </div>
      <div className={styles.hint}>{t('modelHint')}</div>
      {available ? (
        <div className={styles.modelList}>
          {available.map((id) => (
            <button
              key={id}
              type="button"
              className={id === (override || provider.models[0]) ? styles.modelItemOn : styles.modelItem}
              onClick={() => {
                setDraft(id)
                setModelOverride(providerId, id)
              }}
            >
              {id}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  )
}
