import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import type { Consignacion, Saldo, Traspaso } from '../lib/types'
import { disponible, fdate, fmt, miles, neto, num, ymd } from '../lib/util'
import { Cargando, Tag } from '../ui'

function liquidacion(s: Saldo) {
  if (s.por_revisar + s.rechazado > 0) return <Tag k="w">En revisión</Tag>
  const d = neto(s) - s.aprobado, p = s.es_responsable ? 'Si cierra hoy: ' : ''
  return d > 0 ? <Tag k="bad">{p}reintegra {fmt(d)}</Tag> : d < 0 ? <Tag k="ok">{p}se le debe {fmt(-d)}</Tag> : <Tag>Cuadrado</Tag>
}

export default function Viaticos({ tick }: { tick: number }) {
  const app = useApp()
  const { ordenes, perfiles, toast } = app
  const [saldos, setSaldos] = useState<Saldo[] | null>(null)
  const [cons, setCons] = useState<Consignacion[]>([])
  const [tras, setTras] = useState<Traspaso[]>([])
  const [q, setQ] = useState('')
  // consignación
  const [cO, setCO] = useState(''); const [cF, setCF] = useState(ymd()); const [cM, setCM] = useState(''); const [cMe, setCMe] = useState('Transferencia'); const [cN, setCN] = useState('')
  // cambio de responsable
  const [tO, setTO] = useState(''); const [tA, setTA] = useState(''); const [tM, setTM] = useState(''); const [tF, setTF] = useState(ymd()); const [tN, setTN] = useState('')
  const [err, setErr] = useState({ c: '', t: '' })

  const cargar = useCallback(async () => {
    const [s, c, t] = await Promise.all([
      sb.from('saldos').select('*'),
      sb.from('consignaciones').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(300),
      sb.from('traspasos').select('*').order('fecha', { ascending: false }).limit(200)
    ])
    setSaldos(s.data || []); setCons(c.data || []); setTras(t.data || [])
  }, [])
  useEffect(() => { cargar() }, [cargar, tick])

  const oC = app.orden(cO || ordenes[0]?.num || ''), oT = app.orden(tO || ordenes[0]?.num || '')
  const sT = saldos?.find(s => s.orden === oT?.num && s.tecnico === oT?.responsable)
  useEffect(() => { setTM(sT ? String(Math.max(0, disponible(sT))) : '0') }, [oT?.num, sT?.reportado, sT?.consignado]) // eslint-disable-line

  async function consignar() {
    if (!oC) return
    const m = num(cM); if (!m) return setErr(e => ({ ...e, c: 'Escribe el monto consignado.' }))
    const { error } = await sb.from('consignaciones').insert({ orden: oC.num, fecha: cF, monto: m, medio: cMe, nota: cN.trim() || null })
    if (error) return setErr(e => ({ ...e, c: msgError(error) }))
    setErr(e => ({ ...e, c: '' })); setCM(''); setCN(''); toast(`${fmt(m)} consignados a ${app.nombre(oC.responsable)} para ${oC.num}`); cargar()
  }
  async function cambiar() {
    if (!oT) return
    const nuevo = tA || activos.filter(p => p.id !== oT.responsable)[0]?.id
    if (!nuevo || nuevo === oT.responsable) return setErr(e => ({ ...e, t: 'Elige un nuevo responsable distinto al actual.' }))
    const { error } = await sb.rpc('cambiar_responsable', { p_orden: oT.num, p_nuevo: nuevo, p_monto: num(tM), p_fecha: tF, p_nota: tN.trim() || 'Cambio de responsable' })
    if (error) return setErr(e => ({ ...e, t: msgError(error) }))
    setErr(e => ({ ...e, t: '' })); setTN(''); setTA('')
    toast(`${oT.num}: ahora responde ${app.nombre(nuevo)}`); await app.recargar(['ordenes']); cargar()
  }
  async function anular(tipo: 'c' | 't', id: number) {
    const { error } = tipo === 'c' ? await sb.from('consignaciones').delete().eq('id', id) : await sb.rpc('anular_traspaso', { p_id: id })
    if (error) return toast(msgError(error), 'error')
    toast(tipo === 'c' ? 'Consignación anulada' : 'Cambio de responsable anulado'); if (tipo === 't') await app.recargar(['ordenes']); cargar()
  }

  const activos = perfiles.filter(p => p.activo)
  const hist = [...cons.map(c => ({ k: 'c' as const, id: c.id, fecha: c.fecha, orden: c.orden, mov: `Consignación a ${app.nombre(c.tecnico)}`, det: [c.medio, c.nota].filter(Boolean).join(' · '), monto: c.monto, t: c.created_at })),
    ...tras.map(t => ({ k: 't' as const, id: t.id, fecha: t.fecha, orden: t.orden, mov: `Cambio de responsable: ${app.nombre(t.de)} → ${app.nombre(t.a)}`, det: t.nota || '', monto: t.monto, t: t.created_at }))]
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.t.localeCompare(a.t))
  const filtroS = (s: Saldo) => !q || [s.orden, app.nombre(s.tecnico), app.orden(s.orden)?.cliente].join(' ').toLowerCase().includes(q.toLowerCase())

  if (!ordenes.length) return <p className="empty">Todavía no hay órdenes. Las crean los técnicos desde el celular.</p>
  const optsOrden = ordenes.map(o => <option key={o.num} value={o.num}>{o.num} · {app.ciudad(o.ciudad_id)} · {o.cliente}</option>)

  return <>
    <p className="note top">Cada orden tiene un único responsable: recibe las consignaciones, reporta los gastos y entrega los comprobantes.</p>
    <h3>Registrar consignación</h3>
    <div className="aform">
      <div><label htmlFor="c-o">Orden de servicio</label><select id="c-o" className="inp" value={oC?.num} onChange={e => setCO(e.target.value)}>{optsOrden}</select></div>
      <div><label>Se consigna a (responsable)</label><div className="inp ro"><b>{app.nombre(oC?.responsable)}</b></div></div>
      <div><label htmlFor="c-f">Fecha</label><input id="c-f" type="date" className="inp" value={cF} onChange={e => setCF(e.target.value)} /></div>
      <div><label htmlFor="c-m">Monto</label><input id="c-m" className="inp" inputMode="numeric" value={miles(num(cM))} onChange={e => setCM(e.target.value)} placeholder="$ 500.000" /></div>
      <div><label htmlFor="c-me">Medio</label><select id="c-me" className="inp" value={cMe} onChange={e => setCMe(e.target.value)}>
        {['Transferencia', 'Efectivo', 'Nequi / Daviplata', 'Tarjeta corporativa'].map(x => <option key={x}>{x}</option>)}</select></div>
      <div><label htmlFor="c-n">Nota (opcional)</label><input id="c-n" className="inp" value={cN} onChange={e => setCN(e.target.value)} placeholder="Ej. día 2, hotel" /></div>
      <div><button className="btn pri w" onClick={consignar}>Registrar consignación</button></div>
    </div>
    <p className="err">{err.c}</p>

    <h3>Cambiar responsable de una orden</h3>
    <div className="aform">
      <div><label htmlFor="t-o">Orden de servicio</label><select id="t-o" className="inp" value={oT?.num} onChange={e => { setTO(e.target.value); setTA('') }}>{optsOrden}</select></div>
      <div><label>Responsable actual</label><div className="inp ro"><b>{app.nombre(oT?.responsable)}</b> · disponible {fmt(sT ? disponible(sT) : 0)}</div></div>
      <div><label htmlFor="t-a">Nuevo responsable</label><select id="t-a" className="inp" value={tA} onChange={e => setTA(e.target.value)}>
        {activos.filter(p => p.id !== oT?.responsable).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
      <div><label htmlFor="t-m">Saldo que entrega al nuevo</label><input id="t-m" className="inp" inputMode="numeric" value={miles(num(tM)) || '0'} onChange={e => setTM(e.target.value)} /></div>
      <div><label htmlFor="t-f">Fecha</label><input id="t-f" type="date" className="inp" value={tF} onChange={e => setTF(e.target.value)} /></div>
      <div><label htmlFor="t-n">Motivo</label><input id="t-n" className="inp" value={tN} onChange={e => setTN(e.target.value)} placeholder="Ej. regresa a Bogotá" /></div>
      <div><button className="btn pri w" onClick={cambiar}>Cambiar responsable</button></div>
    </div>
    <p className="err">{err.t}</p>
    <p className="note">El saliente responde solo por lo que recibió hasta ese día, menos lo que entregó y lo que reportó; sus reportes enviados siguen a su nombre. Las consignaciones nuevas van al nuevo responsable.</p>

    <div className="tool"><h3 style={{ margin: 0 }}>Saldos por orden y técnico</h3>
      <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar orden, cliente o técnico" aria-label="Buscar saldos" /></div>
    {!saldos ? <Cargando /> : <div className="scroll"><table className="stack"><thead><tr><th>Orden</th><th>Técnico</th><th className="n">Consignado</th><th className="n">Traspasos</th><th className="n">Reportado</th><th className="n">Aprobado</th><th className="n">Por revisar</th><th className="n">Disponible</th><th>Al legalizar</th></tr></thead>
      <tbody>{saldos.filter(filtroS).sort((a, b) => b.orden.localeCompare(a.orden) || app.nombre(a.tecnico).localeCompare(app.nombre(b.tecnico))).map(s => {
        const d = disponible(s)
        return <tr key={s.orden + s.tecnico}>
          <td className="nw"><b>{s.orden}</b><div className="note">{app.ciudad(app.orden(s.orden)?.ciudad_id)}</div></td>
          <td>{app.nombre(s.tecnico)}<div>{s.es_responsable ? <Tag k="ok">Responsable</Tag> : <Tag>Ya no es responsable</Tag>}</div></td>
          <td className="n">{fmt(s.consignado)}</td>
          <td className="n">{s.traspaso_recibido || s.traspaso_entregado ? <>{s.traspaso_recibido ? '+' + fmt(s.traspaso_recibido) : ''}{s.traspaso_entregado ? ' −' + fmt(s.traspaso_entregado) : ''}</> : '—'}</td>
          <td className="n">{fmt(s.reportado)}</td><td className="n">{fmt(s.aprobado)}</td><td className="n">{fmt(s.por_revisar)}</td>
          <td className="n" style={{ color: d < 0 ? 'var(--bad)' : undefined }}><b>{fmt(d)}</b></td><td>{liquidacion(s)}</td></tr>
      })}</tbody></table></div>}
    <p className="note">“Al legalizar” compara lo recibido neto (consignado + traspasos recibidos − entregados) con lo aprobado, cuando ya no quedan reportes por revisar ni rechazados.</p>

    <h3>Historial de movimientos</h3>
    <div className="scroll"><table className="stack"><thead><tr><th>Fecha</th><th>Orden</th><th>Movimiento</th><th>Detalle</th><th className="n">Monto</th><th></th></tr></thead>
      <tbody>{hist.map(h => <tr key={h.k + h.id}><td>{fdate(h.fecha)}</td><td>{h.orden}</td><td>{h.mov}</td><td>{h.det}</td><td className="n"><b>{fmt(h.monto)}</b></td>
        <td><Anular onOk={() => anular(h.k, h.id)} /></td></tr>)}</tbody></table></div>
  </>
}

/** Botón de anular con confirmación en dos pasos */
function Anular({ onOk }: { onOk: () => void }) {
  const [s, setS] = useState(false)
  useEffect(() => { if (!s) return; const t = setTimeout(() => setS(false), 4000); return () => clearTimeout(t) }, [s])
  return s ? <button className="btn bad sm" onClick={onOk}>¿Seguro? Anular</button> : <button className="btn sm" onClick={() => setS(true)}>Anular</button>
}
