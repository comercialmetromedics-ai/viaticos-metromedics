import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import type { Concepto, Reporte, Saldo } from '../lib/types'
import { codigo, disponible, fdate, fhora, fmt, limiteDe, recibido, retencionEsperada, topeDe } from '../lib/util'
import { Cargando, Comparacion, Soporte, Tag, Vacio } from '../ui'

/** La retención reportada difiere de la esperada en más de $1.000 */
const difRet = (c: Concepto, r: Reporte) => c.retencion_pct != null && r.retencion_valor != null && Math.abs(retencionEsperada(c, r.monto).valor - r.retencion_valor) > 1000
const MOTIVOS = ['El soporte no es factura electrónica', 'Falta el RUT', 'Imagen ilegible', 'El monto no coincide con el soporte', 'Gasto no autorizado', 'Fecha del soporte no corresponde']

export default function Revisar({ tick, onCambio }: { tick: number; onCambio: () => void }) {
  const app = useApp()
  const [lista, setLista] = useState<Reporte[] | null>(null)
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [q, setQ] = useState('')

  const cargar = useCallback(async () => {
    const [r, s] = await Promise.all([
      sb.from('reportes').select('*').eq('estado', 'pendiente').order('enviado_at'),
      sb.from('saldos').select('*')
    ])
    setLista(r.data || []); setSaldos(s.data || [])
  }, [])
  useEffect(() => { cargar() }, [cargar, tick])

  const filtro = (r: Reporte) => {
    if (!q) return true
    const o = app.orden(r.orden)
    return [r.orden, o?.cliente, app.ciudad(o?.ciudad_id), app.nombre(r.tecnico), app.concepto(r.concepto_id)?.nombre, codigo(r.id)].join(' ').toLowerCase().includes(q.toLowerCase())
  }
  const hecho = () => { cargar(); onCambio() }

  return <>
    <div className="tool">
      <span className="note">Del más antiguo al más reciente. Revisa soporte, RUT y tope antes de decidir.</span>
      <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar orden, cliente o técnico" aria-label="Buscar" />
    </div>
    {!lista ? <Cargando /> : !lista.filter(filtro).length ? <Vacio>No hay reportes por revisar.</Vacio> :
      lista.filter(filtro).map(r => <Tarjeta key={r.id} r={r} saldo={saldos.find(s => s.orden === r.orden && s.tecnico === r.tecnico)} onHecho={hecho} />)}
  </>
}

function Tarjeta({ r, saldo, onHecho }: { r: Reporte; saldo?: Saldo; onHecho: () => void }) {
  const app = useApp()
  const o = app.orden(r.orden), c = app.concepto(r.concepto_id)
  const tope = topeDe(r.concepto_id, o, r.noches, app.conceptos, app.topes)
  const exceso = tope != null && r.monto > tope
  const [rech, setRech] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const det = r.subtipo || r.descripcion || (c?.por_noche ? `${r.noches} ${r.noches > 1 ? 'noches' : 'noche'}` : '')

  async function decidir(accion: 'aprobar' | 'parcial' | 'rechazar') {
    if (accion === 'rechazar' && !motivo.trim()) return setErr('Escribe el motivo; el técnico lo verá para corregir.')
    setBusy(true); setErr('')
    const { error } = await sb.rpc('decidir_reporte', { p_id: r.id, p_accion: accion, p_motivo: accion === 'rechazar' ? motivo.trim() : null })
    setBusy(false)
    if (error) return setErr(msgError(error))
    app.toast(accion === 'rechazar' ? `${codigo(r.id)} devuelto a ${app.nombre(r.tecnico)}` : `${codigo(r.id)} aprobado por ${fmt(accion === 'aprobar' ? r.monto : tope)}`)
    onHecho()
  }

  return (
    <article className="rc">
      <div className="thumbs">
        <Soporte path={r.soporte_path} label={r.factura_electronica ? 'Factura' : 'Comprobante'} />
        {r.rut_path ? <Soporte path={r.rut_path} label="RUT" /> : <div className="none">Sin RUT<br />({r.factura_electronica ? 'factura electrónica' : r.rut_pendiente ? 'pendiente por cargar' : c?.rut_modo === 'obligatorio' ? 'falta' : 'no se pide'})</div>}
        {r.anexo_path && <Soporte path={r.anexo_path} label={c?.anexo_nombre || 'Anexo'} />}
      </div>
      <div>
        <div className="rtop"><b>{c?.nombre}{det ? ' · ' + det : ''}</b><span className="amt">{fmt(r.monto)}</span></div>
        <div className="meta"><b className="ink">{r.orden}</b> · {o?.cliente} · {app.ciudad(o?.ciudad_id)}</div>
        <div className="meta">{app.nombre(r.tecnico)} · gasto del {fdate(r.fecha_gasto)} · enviado {fdate(r.enviado_at)} {fhora(r.enviado_at)} · {codigo(r.id)}
          {r.reenvios > 0 && <> · <b className="warn">Reenviado ({r.reenvios})</b></>}
          {r.extemporaneo && app.config && <> <Tag k="w">Extemporáneo · límite {fhora(limiteDe(r.fecha_gasto, app.config))}</Tag></>}</div>
        {saldo && <div className="meta">Viáticos de {app.nombre(r.tecnico).split(' ')[0]} en esta orden: recibido {fmt(recibido(saldo))} · reportado {fmt(saldo.reportado)} · disponible{' '}
          <b style={{ color: disponible(saldo) < 0 ? 'var(--bad)' : 'var(--ok)' }}>{fmt(disponible(saldo))}</b></div>}
        <Comparacion compacta monto={r.monto} tope={tope} concepto={c?.nombre} />
        <ul className="checks">
          <li className="y">✓ {r.factura_electronica ? 'Factura electrónica' : 'Comprobante no electrónico'}</li>
          {r.rut_path ? <li className="y">✓ RUT adjunto</li> : r.rut_pendiente ? null : r.factura_electronica || c?.rut_modo !== 'obligatorio' ? <li className="y">✓ No requiere RUT{!r.factura_electronica && ` (${c?.nombre})`}</li> : r.rut_path ? <li className="y">✓ RUT adjunto</li> : <li className="n">✗ Falta RUT</li>}
          {r.rut_pendiente && <li className="n">⏳ RUT pendiente por cargar: si no llega antes de legalizar, este gasto cuenta como no aprobado</li>}
          {r.anexo_pendiente && <li className="n">⏳ {c?.anexo_nombre || 'Anexo'} pendiente por cargar: si no llega antes de legalizar, cuenta como no aprobado</li>}
          {c && c.anexo_modo !== 'no' && !r.anexo_pendiente && (r.anexo_path ? <li className="y">✓ {c.anexo_nombre || 'Anexo'} adjunto</li>
            : c.anexo_modo === 'obligatorio' ? <li className="n">✗ Falta {c.anexo_nombre || 'anexo'}</li> : null)}
          {c?.pide_retencion && (r.retencion ? <li className={difRet(c, r) ? 'n' : 'y'}>{difRet(c, r) ? '⚠' : '✓'} Retención practicada: {fmt(r.retencion_valor || 0)}{difRet(c, r) && ` · esperada ≈ ${fmt(retencionEsperada(c, r.monto).valor)}`}</li>
            : r.retencion === false && r.retencion_nota?.startsWith('No aplica') ? <li className="y">✓ {r.retencion_nota}</li>
            : r.retencion === false ? <li className="n">✗ Sin retención: {r.retencion_nota}</li> : <li className="n">✗ No indicó la retención</li>)}
          {r.observaciones && <li className="mute">Nota: {r.observaciones}</li>}
        </ul>
        {rech ? (
          <div className="rej">
            <div className="chips">{MOTIVOS.map(m => <button key={m} onClick={() => setMotivo(v => (v ? v.replace(/\.?\s*$/, '. ') : '') + m)}>{m}</button>)}</div>
            <textarea className="inp" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo del rechazo (lo verá el técnico)" autoFocus />
            <p className="err">{err}</p>
            <div className="acts">
              <button className="btn bad" disabled={busy} onClick={() => decidir('rechazar')}>Rechazar y devolver al técnico</button>
              <button className="btn" onClick={() => { setRech(false); setErr('') }}>Cancelar</button>
            </div>
          </div>
        ) : <>
          <div className="acts">
            <button className="btn ok" disabled={busy} onClick={() => decidir('aprobar')}>Aprobar {fmt(r.monto)}</button>
            {exceso && <button className="btn pri" disabled={busy} onClick={() => decidir('parcial')}>Aprobar hasta el tope {fmt(tope)}</button>}
            <button className="btn bad" disabled={busy} onClick={() => setRech(true)}>Rechazar</button>
          </div>
          {err && <p className="err">{err}</p>}
        </>}
      </div>
    </article>
  )
}
