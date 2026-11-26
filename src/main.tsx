import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AppProvider } from './lib/store'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

// En celular, las tablas .stack muestran cada celda con el nombre de su columna
new MutationObserver(() => {
  document.querySelectorAll<HTMLTableCellElement>('.stack td:not([data-l])').forEach(c => {
    let i = 0, p: Element | null = c
    while ((p = p.previousElementSibling)) i += (p as HTMLTableCellElement).colSpan
    c.dataset.l = c.closest('table')?.rows[0]?.cells[i]?.textContent || ''
  })
}).observe(document, { childList: true, subtree: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider><App /></AppProvider>
  </StrictMode>
)
