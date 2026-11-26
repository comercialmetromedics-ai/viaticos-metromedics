import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import type { Consignacion, Saldo, Traspaso } from '../lib/types'
import { disponible, fdate, fmt, miles, neto, num, textoResultado, ymd } from '../lib/util'
import { subirSoporte } from '../lib/img'
import { Cargando, Subir, Tag, Archivo } from '../ui'

function resultadoHoy(s: Saldo) {
  const d = neto(s) - s.aprobado
  return d > 0 ? <Tag k="bad">Reintegra {fmt(d)}</Tag> : d < 0 ? <Tag k="ok">Reembolsar {fmt(-d)}</Tag> : <Tag>Cuadrado</Tag>
}
const abierto = (s: Saldo) => s.consignado + s.traspaso_recibido + s.traspaso_entregado + s.reportado > 0

/** Cierre del ciclo de un técnico en una orden */
function Legalizar({ s, onCerrar, onListo }: { s: Saldo; onCerrar: () => void; onListo: () => void }) {
  const app = useApp()
  const res = neto(s) - s.aprobado
  const [fecha, setFecha] = useState(ymd())
  const [medio, setMedio] = useState(res > 0 ? 'Efectivo' : res < 0 ? 'Transferencia al técnico' : 'Sin movimiento de dinero')
  const [nota, setNota] = useState('')
  const [comp, setComp] = useState<File | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function cerrar() {
    setBusy(true); setErr('')
    try {
      const path = comp ? await subirSoporte(app.yo!.id, comp) : null
      const { error } = await sb.rpc('legalizar', { p_orden: s.orden, p_tecnico: s.tecnico, p_fecha: fecha, p_medio: medio, p_nota: nota, p_comprobante: path })
      if (error) throw error
      app.toast(`Legalización cerrada: ${app.nombre(s.tecnico)} · ${s.orden} · ${textoResultado(res)}`); onListo()
    } catch (e) { setErr(msgError(e)) } finally { setBusy(false) }
  }
  return (
    <div className="legpanel" id="legpanel">
      <div className="rtop"><b>Legalizar · {s.orden} · {app.nombre(s.tecnico)}</b><button className="btn sm" onClick={onCerrar}>Cancelar</button></div>
      <div className="leggrid">
        <div><small>Consignado</small><b>{fmt(s.consignado)}</b></div>
        <div><small>Traspasos</small><b>{s.traspaso_recibido - s.traspaso_entregado >= 0 ? '+' : '−'}{fmt(Math.abs(s.traspaso_recibido - s.traspaso_entregado))}</b></div>
        <div><small>Recibido neto</small><b>{fmt(neto(s))}</b></div>
        <div><small>Reportado</small><b>{fmt(s.reportado)}</b></div>
        <div><small>Aprobado</small><b>{fmt(s.aprobado)}</b></div>
        <div><small>No aprobado</small><b>{fmt(s.reportado - s.aprobado)}</b></div>
      </div>
      <div className={'legres ' + (res > 0 ? 'bad' : res < 0 ? 'ok' : '')}>
        {res > 0 ? <>El técnico debe <b>reintegrar {fmt(res)}</b> a la empresa.</> : res < 0 ? <>La empresa debe <b>reembolsar {fmt(-res)}</b> al técnico.</> : <>Cuentas <b>cuadradas</b>: no hay dinero por devolver ni reembolsar.</>}
      </div>
      {s.rechazado > 0 && <p className="hint warn">Incluye {fmt(s.rechazado)} en reportes rechazados sin corregir: quedan como <b>no aprobados</b> y ya no se podrán corregir.</p>}
      <div className="aform" style={{ marginTop: 10 }}>
        <div><label htmlFor="lg-f">Fecha</label><input id="lg-f" type="date" className="inp" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
        <div><label htmlFor="lg-m">Cómo se saldó</label><select id="lg-m" className="inp" value={medio} onChange={e => setMedio(e.target.value)}>
          {['Efectivo', 'Transferencia a la empresa', 'Transferencia al técnico', 'Descuento de nómina', 'Pago en nómina', 'Sin movimiento de dinero'].map(m => <option key={m}>{m}</option>)}</select></div>
        <div style={{ gridColumn: '1 / -1' }}><label htmlFor="lg-n">Nota (opcional)</label><input id="lg-n" className="inp" value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej. devolvió en caja menor, recibo 0123" /></div>
        <div style={{ gridColumn: '1 / -1' }}><label>Comprobante del reintegro o pago (opcional)</label>
          {comp ? <Archivo file={comp} onClear={() => setComp(null)} /> : <Subir label="Adjuntar foto o PDF" onFile={setComp} />}</div>
      </div>
      <p className="err">{err}</p>
      <button className="btn pri" disabled={busy} onClick={cerrar}>{busy ? 'Cerrando…' : 'Cerrar legalización'}</button>
      <p className="note">Al cerrar, los reportes, consignaciones y traspasos de este ciclo quedan legalizados y ya no se pueden modificar. El saldo del técnico en esta orden vuelve a cero.</p>
    </div>
  )
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
  const [leg, setLeg] = useState<Saldo | null>(null)

  const cargar = useCallback(async () => {
    const [s, c, t] = await Promise.all([
      sb.from('saldos').select('*'),
      sb.from('consignaciones').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(300),
      sb.from('traspasos').select('*').order('fecha', { ascending: false }).limit(200)
    ])
    setSaldos(s.data || []); setCons(c.data || []); setTras(t.data || [])
  }, [])
  useEffect(() => { cargar() }, [cargar, tick])

  const activas = ordenes.filter(o => !o.archivada)
  const oC = app.orden(cO || activas[0]?.num || ''), oT = app.orden(tO || activas[0]?.num || '')
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
  function abrirLeg(s: Saldo) { setLeg(s); setTimeout(() => document.getElementById('legpanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }
  async function anular(tipo: 'c' | 't', id: number) {
    const { error } = tipo === 'c' ? await sb.from('consignaciones').delete().eq('id', id) : await sb.rpc('anular_traspaso', { p_id: id })
    if (error) return toast(msgError(error), 'error')
    toast(tipo === 'c' ? 'Consignación anulada' : 'Cambio de responsable anulado'); if (tipo === 't') await app.recargar(['ordenes']); cargar()
  }

  const activos = perfiles.filter(p => p.activo)
  const hist = [...cons.map(c => ({ k: 'c' as const, id: c.id, fecha: c.fecha, orden: c.orden, mov: `Consignación a ${app.nombre(c.tecnico)}`, det: [c.medio, c.nota].filter(Boolean).join(' · '), monto: c.monto, t: c.created_at, leg: c.legalizacion_id != null })),
    ...tras.map(t => ({ k: 't' as const, id: t.id, fecha: t.fecha, orden: t.orden, mov: `Cambio de responsable: ${app.nombre(t.de)} → ${app.nombre(t.a)}`, det: t.nota || '', monto: t.monto, t: t.created_at, leg: t.legalizacion_de != null || t.legalizacion_a != null }))]
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.t.localeCompare(a.t))
  const filtroS = (s: Saldo) => !q || [s.orden, app.nombre(s.tecnico), app.orden(s.orden)?.cliente].join(' ').toLowerCase().includes(q.toLowerCase())

  if (!ordenes.some(o => !o.archivada)) return <p className="empty">Todavía no hay órdenes. Las crean los técnicos desde el celular.</p>
  const optsOrden = ordenes.filter(o => !o.archivada).map(o => <option key={o.num} value={o.num}>{o.num} · {app.ciudad(o.ciudad_id)} · {o.cliente}</option>)

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

    {leg && <Legalizar key={leg.orden + leg.tecnico} s={leg} onCerrar={() => setLeg(null)} onListo={() => { setLeg(null); cargar() }} />}
    <div className="tool"><h3 style={{ margin: 0 }}>Saldos abiertos por orden y técnico</h3>
      <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar orden, cliente o técnico" aria-label="Buscar saldos" /></div>
    {!saldos ? <Cargando /> : <div className="scroll"><table className="stack"><thead><tr><th>Orden</th><th>Técnico</th><th className="n">Consignado</th><th className="n">Traspasos</th><th className="n">Reportado</th><th className="n">Aprobado</th><th className="n">Por revisar</th><th className="n">Disponible</th><th>Resultado hoy</th><th></th></tr></thead>
      <tbody>{saldos.filter(filtroS).filter(abierto).sort((a, b) => b.orden.localeCompare(a.orden) || app.nombre(a.tecnico).localeCompare(app.nombre(b.tecnico))).map(s => {
        const d = disponible(s)
        return <tr key={s.orden + s.tecnico}>
          <td className="nw"><b>{s.orden}</b><div className="note">{app.ciudad(app.orden(s.orden)?.ciudad_id)}</div></td>
          <td>{app.nombre(s.tecnico)}<div>{s.es_responsable ? <Tag k="ok">Responsable</Tag> : <Tag>Ya no es responsable</Tag>}</div></td>
          <td className="n">{fmt(s.consignado)}</td>
          <td className="n">{s.traspaso_recibido || s.traspaso_entregado ? <>{s.traspaso_recibido ? '+' + fmt(s.traspaso_recibido) : ''}{s.traspaso_entregado ? ' −' + fmt(s.traspaso_entregado) : ''}</> : '—'}</td>
          <td className="n">{fmt(s.reportado)}</td><td className="n">{fmt(s.aprobado)}</td><td className="n">{fmt(s.por_revisar)}</td>
          <td className="n" style={{ color: d < 0 ? 'var(--bad)' : undefined }}><b>{fmt(d)}</b></td><td>{resultadoHoy(s)}</td>
          <td>{s.por_revisar > 0 ? <Tag k="w">Revisa antes {fmt(s.por_revisar)}</Tag> : <button className="btn sm pri" onClick={() => abrirLeg(s)}>Legalizar</button>}</td></tr>
      })}</tbody></table></div>}
    <p className="note">Aquí solo aparece lo que aún no se ha legalizado. “Resultado hoy” compara lo recibido neto (consignado + traspasos recibidos − entregados) con lo aprobado. Para legalizar, el técnico no debe tener reportes por revisar; los rechazados sin corregir pasan como no aprobados. Lo legalizado queda en la pestaña Legalizaciones.</p>

    <h3>Historial de movimientos</h3>
    <div className="scroll"><table className="stack"><thead><tr><th>Fecha</th><th>Orden</th><th>Movimiento</th><th>Detalle</th><th className="n">Monto</th><th></th></tr></thead>
      <tbody>{hist.map(h => <tr key={h.k + h.id}><td>{fdate(h.fecha)}</td><td>{h.orden}</td><td>{h.mov}</td><td>{h.det}</td><td className="n"><b>{fmt(h.monto)}</b></td>
        <td>{h.leg ? <Tag>Legalizado</Tag> : <Anular onOk={() => anular(h.k, h.id)} />}</td></tr>)}</tbody></table></div>
  </>
}

/** Botón de anular con confirmación en dos pasos */
function Anular({ onOk }: { onOk: () => void }) {
  const [s, setS] = useState(false)
  useEffect(() => { if (!s) return; const t = setTimeout(() => setS(false), 4000); return () => clearTimeout(t) }, [s])
  return s ? <button className="btn bad sm" onClick={onOk}>¿Seguro? Anular</button> : <button className="btn sm" onClick={() => setS(true)}>Anular</button>
}
