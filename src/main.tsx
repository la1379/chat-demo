import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { hasPassedGate, isGateEnabled } from './app/gate.js'
import { Gate } from './components/gate/Gate.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()

/**
 * 口令门只包在应用外层，不改动应用内部任何逻辑。
 * 未配置口令时直接渲染应用，行为与官方版本完全一致。
 */
const Root = () => {
  const [passed, setPassed] = useState(() => !isGateEnabled() || hasPassedGate())
  if (!passed) {
    return <Gate onPass={() => setPassed(true)} />
  }
  return <App />
}

createRoot(document.getElementById('root') as HTMLElement).render(<Root />)
