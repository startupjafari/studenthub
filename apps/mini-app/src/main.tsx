import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { restoreFontScale } from './lib/font-scale'
import { App } from './app'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root не найден в index.html')

// Крупный шрифт восстанавливается до первой отрисовки: иначе экран успел бы
// нарисоваться обычным и дёрнуться.
restoreFontScale()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
