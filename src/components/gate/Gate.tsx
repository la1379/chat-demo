import { useState, type FormEvent } from 'react'
import { isGateEnabled, tryPassGate } from '../../app/gate.js'

/** 口令输入界面：整页居中，不暴露任何应用内容 */
export const Gate = ({ onPass }: { onPass: () => void }) => {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || value.trim() === '') {
      return
    }
    setBusy(true)
    setError('')
    try {
      if (await tryPassGate(value)) {
        onPass()
        return
      }
      setError('口令不正确')
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', minHeight: '100%', placeItems: 'center', padding: '24px' }}>
      <form
        onSubmit={submit}
        style={{
          width: 'min(360px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <h1 style={{ margin: 0, color: 'var(--dsw-alias-label-primary)', fontSize: '20px' }}>
          需要访问口令
        </h1>
        <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '14px' }}>
          请输入口令后继续使用
        </p>
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
          autoComplete="current-password"
          style={{
            height: '40px',
            padding: '0 12px',
            border: '1px solid var(--dsw-alias-border-secondary)',
            borderRadius: '8px',
            background: 'var(--dsw-alias-bg-elevated)',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit',
            fontSize: '14px',
          }}
        />
        {error ? (
          <p style={{ margin: 0, color: '#d93026', fontSize: '13px' }}>
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          style={{
            height: '40px',
            border: 'none',
            borderRadius: '8px',
            background: 'var(--dsw-alias-label-primary)',
            color: 'var(--dsw-alias-bg-elevated)',
            font: 'inherit',
            fontSize: '14px',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? '校验中…' : '进入'}
        </button>
      </form>
    </div>
  )
}

/** 只有启用了口令才需要包一层 */
export const gateRequired = isGateEnabled
