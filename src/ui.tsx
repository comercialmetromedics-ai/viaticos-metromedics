import { useEffect, useState, type ReactNode } from 'react'
import { esPdf, urlFirmada } from './lib/img'
import { ESTADOS, fmt } from './lib/util'
import type { Estado } from './lib/types'

export const Chip = ({ estado }: { estado: Estado }) => <span className={'chip c-' + estado}>{ESTADOS[estado]}</span>
export const Tag = ({ k = 'n', children }: { k?: 'ok' | 'bad' | 'w' | 'n'; children: ReactNode }) => <span className={'tag ' + k}>{children}</span>
export const Vacio = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>
export const Cargando = () => <p className="empty">Cargando…</p>

/** Miniatura de un soporte guardado (factura o RUT); al tocarla se abre en grande */
export function Soporte({ path, label, size = 'm' }: { path: string; label: string; size?: 's' | 'm' }) {
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { let ok = true; urlFirmada(path).then(u => ok && setUrl(u)); return () => { ok = false } }, [path])
  const pdf = esPdf(path)
  return (
    <>
      <button type="button" className={'thumb ' + size} onClick={() => (pdf && url ? window.open(url, '_blank') : setOpen(true))} aria-label={'Ver ' + label}>
        {pdf ? <div className="pdf">PDF</div> : url ? <img src={url} alt="" loading="lazy" /> : <div className="pdf">…</div>}
        <span>{label}</span>
      </button>
      {open && url && (
        <div className="zoom" onClick={() => setOpen(false)} role="dialog">
          <img src={url} alt={label} />
          <a className="btn" href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Abrir original</a>
        </div>
      )}
    </>
  )
}

/** Comparación de un monto contra el tope aprobado */
export function Comparacion({ monto, tope, concepto, ciudad, detalle, compacta }: {
  monto: number; tope: number | null | undefined; concepto?: string; ciudad?: string; detalle?: string; compacta?: boolean
}) {
  if (!monto || !concepto) return <div className="cmp idle"><p>Escribe el monto para compararlo con el tope aprobado.</p></div>
  if (tope == null) return <div className="cmp na"><span className="v">Sin tope</span><p>{compacta ? 'Se revisa contra el soporte.' : `${concepto} no tiene tope fijo; se revisa contra el soporte.`}</p></div>
  if (monto <= tope) return <div className="cmp ok"><span className="v">Dentro de presupuesto</span><p>Tope {fmt(tope)}{detalle}{compacta ? '' : ` para ${concepto.toLowerCase()} en ${ciudad}.`}</p></div>
  return (
    <div className="cmp over"><span className="v">−{fmt(monto - tope)}</span>
      <p>{compacta ? `Tope ${fmt(tope)} · exceso ${fmt(monto - tope)}` :
        `Superas en ${fmt(monto - tope)} el tope de ${fmt(tope)}${detalle || ''} para ${concepto.toLowerCase()} en ${ciudad}. Puedes enviarlo: el administrador decide si aprueba el total o solo hasta el tope.`}</p>
    </div>
  )
}

export function Archivo({ file, onClear }: { file: File | string; onClear: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (typeof file === 'string') { urlFirmada(file).then(setUrl); return }
    if (file.type.startsWith('image/')) { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u) }
  }, [file])
  const name = typeof file === 'string' ? 'Archivo enviado antes' : file.name
  const pdf = typeof file === 'string' ? esPdf(file) : file.type === 'application/pdf'
  return (
    <div className="file">
      {pdf || !url ? <div className="pdf">{pdf ? 'PDF' : '…'}</div> : <img src={url} alt="" />}
      <span>{name}</span>
      <button type="button" onClick={onClear}>Cambiar</button>
    </div>
  )
}

export function Subir({ label, onFile }: { label: string; onFile: (f: File) => void }) {
  return (
    <label className="up">
      <input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      {label}
    </label>
  )
}

export type Modulo = 'via' | 'evi'
/** Cambia entre los módulos de la app */
export function Modulos({ actual, onCambio }: { actual: Modulo; onCambio: (m: Modulo) => void }) {
  return <div className="mods" role="tablist" aria-label="Módulo">
    {([['via', 'Viáticos'], ['evi', 'Evidencias']] as const).map(([k, l]) =>
      <button key={k} role="tab" aria-selected={actual === k} onClick={() => actual !== k && onCambio(k)}>{l}</button>)}
  </div>
}
