import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import { sb } from '../lib/sb'
import type { Consignacion, Legalizacion, Reporte, Saldo, Traspaso } from '../lib/types'
import { codigo, descargarCSV, disponible, fdate, flarga, fmt, neto, textoResultado, ymd } from '../lib/util'
import { Cargando, Tag, Vacio } from '../ui'

const abierto = (s: Saldo) => s.consignado + s.traspaso_recibido + s.traspaso_entregado + s.reportado > 0

/** Estados de cuenta: resumen general y movimientos por técnico, descargables */
export default function Estados({ tick }: { tick: number }) {
  const [vista, setVista] = useState<'gen' | 'tec'>('gen')
  return <>
    <div className="tool noprint">
      <div className="seg"><button aria-pressed={vista === 'gen'} onClick={() => setVista('gen')}>Resumen general</button>
        <button aria-pressed={vista === 'tec'} onClick={() => setVista('tec')}>Estado de cuenta por técnico</button></div>
      <button className="btn" onClick={() => window.print()}>Imprimir / guardar PDF</button>
    </div>
    {vista === 'gen' ? <General tick={tick} /> : <PorTecnico tick={tick} />}
  </>
}

function General({ tick }: { tick: number }) {
  const app = useApp()
  const [saldos, setSaldos] = useState<Saldo[] | null>(null)
  useEffect(() => { sb.from('saldos').select('*').then(r => setSaldos((r.data || []).filter(abierto))) }, [tick])
  if (!saldos) return <Cargando />
  const tecs = [...new Set(saldos.map(s => s.tecnico))].map(t => {
    const ss = saldos.filter(s => s.tecnico === t)
    const sum = (f: (s: Saldo) => number) => ss.reduce((a, s) => a + f(s), 0)
    return { t, n: ss.length, neto: sum(neto), rep: sum(s => s.reportado), apr: sum(s => s.aprobado), pen: sum(s => s.por_revisar),
      rech: sum(s => s.rechazado), poder: sum(disponible), saldo: sum(s => neto(s) - s.aprobado), ordenes: ss }
  }).sort((a, b) => b.saldo - a.saldo)
  const reint = tecs.reduce((a, x) => a + Math.max(0, x.saldo), 0), reemb = tecs.reduce((a, x) => a + Math.max(0, -x.saldo), 0)

  function exportar() {
    descargarCSV(`estado-general-viaticos-${ymd()}.csv`, [
      ['Técnico', 'Orden', 'Cliente', 'Recibido neto', 'Reportado', 'Aprobado', 'Por revisar', 'Rechazado sin corregir', 'En su poder', 'Debe reintegrar', 'Por reembolsarle'],
      ...tecs.flatMap(x => x.ordenes.map(s => { const d = neto(s) - s.aprobado
        return [app.nombre(x.t), s.orden, app.orden(s.orden)?.cliente || '', neto(s), s.reportado, s.aprobado, s.por_revisar, s.rechazado, disponible(s), d > 0 ? d : 0, d < 0 ? -d : 0] })),
      [], ['TOTAL', '', '', tecs.reduce((a, x) => a + x.neto, 0), tecs.reduce((a, x) => a + x.rep, 0), tecs.reduce((a, x) => a + x.apr, 0),
        tecs.reduce((a, x) => a + x.pen, 0), tecs.reduce((a, x) => a + x.rech, 0), tecs.reduce((a, x) => a + x.poder, 0), reint, reemb]
    ])
  }

  return <>
    <h3 className="t0">Estado general de viáticos sin legalizar · corte {flarga(ymd())}</h3>
    <div className="kpis">
      <div className="main"><small>Técnicos deben reintegrar</small><b>{fmt(reint)}</b></div>
      <div><small>Empresa debe reembolsar</small><b>{fmt(reemb)}</b></div>
      <div><small>Dinero en poder de técnicos</small><b>{fmt(tecs.reduce((a, x) => a + Math.max(0, x.poder), 0))}</b></div>
      <div><small>Gastos por revisar</small><b>{fmt(tecs.reduce((a, x) => a + x.pen, 0))}</b></div>
    </div>
    <p className="note">“Debe reintegrar / por reembolsarle” = recibido neto − gastos aprobados, sin contar lo que aún está por revisar. Es el valor que saldría si se legaliza hoy.</p>
    {!tecs.length ? <Vacio>No hay viáticos pendientes de legalizar.</Vacio> : <>
      <div className="noprint"><button className="btn" onClick={exportar}>Descargar Excel (CSV)</button></div>
      <div className="scroll"><table className="stack"><thead><tr><th>Técnico</th><th className="n">Órdenes</th><th className="n">Recibido</th><th className="n">Aprobado</th><th className="n">Por revisar</th><th className="n">En su poder</th><th>Saldo hoy</th></tr></thead>
        <tbody>{tecs.map(x => <tr key={x.t}><td><b>{app.nombre(x.t)}</b><div className="note">{x.ordenes.map(s => s.orden).join(', ')}</div></td>
          <td className="n">{x.n}</td><td className="n">{fmt(x.neto)}</td><td className="n">{fmt(x.apr)}</td><td className="n">{fmt(x.pen)}</td><td className="n">{fmt(x.poder)}</td>
          <td>{x.saldo > 0 ? <Tag k="bad">Debe reintegrar {fmt(x.saldo)}</Tag> : x.saldo < 0 ? <Tag k="ok">Reembolsarle {fmt(-x.saldo)}</Tag> : <Tag>Cuadrado</Tag>}
            {x.rech > 0 && <div className="note">{fmt(x.rech)} rechazado sin corregir</div>}</td></tr>)}</tbody></table></div>
    </>}
  </>
}

interface Mov { fecha: string; tipo: string; orden: string; detalle: string; valor: number; info?: string }

function PorTecnico({ tick }: { tick: number }) {
  const app = useApp()
  const hoy = ymd()
  const tecnicos = app.perfiles
  const [tec, setTec] = useState(tecnicos.find(p => p.rol === 'tecnico')?.id || tecnicos[0]?.id || '')
  const [desde, setDesde] = useState(hoy.slice(0, 5) + '01-01')
  const [hasta, setHasta] = useState(hoy)
  const [data, setData] = useState<{ c: Consignacion[]; t: Traspaso[]; r: Reporte[]; l: Legalizacion[] } | null>(null)

  useEffect(() => {
    if (!tec) return
    setData(null)
    Promise.all([
      sb.from('consignaciones').select('*').eq('tecnico', tec),
      sb.from('traspasos').select('*').or(`de.eq.${tec},a.eq.${tec}`),
      sb.from('reportes').select('*').eq('tecnico', tec),
      sb.from('legalizaciones').select('*').eq('tecnico', tec)
    ]).then(([c, t, r, l]) => setData({ c: c.data || [], t: t.data || [], r: r.data || [], l: l.data || [] }))
  }, [tec, tick])

  const movs = useMemo<Mov[]>(() => {
    if (!data) return []
    const m: Mov[] = [
      ...data.c.map(c => ({ fecha: c.fecha, tipo: 'Consignación', orden: c.orden, detalle: [c.medio, c.nota].filter(Boolean).join(' · '), valor: c.monto })),
      ...data.t.map(t => t.a === tec
        ? { fecha: t.fecha, tipo: 'Traspaso recibido', orden: t.orden, detalle: `De ${app.nombre(t.de)}${t.nota ? ' · ' + t.nota : ''}`, valor: t.monto }
        : { fecha: t.fecha, tipo: 'Traspaso entregado', orden: t.orden, detalle: `A ${app.nombre(t.a)}${t.nota ? ' · ' + t.nota : ''}`, valor: -t.monto }),
      ...data.r.map(r => {
        const c = app.concepto(r.concepto_id)?.nombre || r.concepto_id
        const det = `${codigo(r.id)} · ${c}${r.subtipo || r.descripcion ? ' · ' + (r.subtipo || r.descripcion) : ''} · reportado ${fmt(r.monto)}`
        if (r.estado === 'pendiente') return { fecha: r.fecha_gasto, tipo: 'Gasto por revisar', orden: r.orden, detalle: det, valor: 0, info: 'Por revisar' }
        if (r.estado === 'rechazado') return { fecha: r.fecha_gasto, tipo: 'Gasto no aprobado', orden: r.orden, detalle: det + (r.motivo ? ' · ' + r.motivo : ''), valor: 0, info: r.legalizacion_id ? 'No aprobado' : 'Rechazado' }
        return { fecha: r.fecha_gasto, tipo: r.estado === 'parcial' ? 'Gasto aprobado (hasta tope)' : 'Gasto aprobado', orden: r.orden, detalle: det, valor: -(r.aprobado || 0) }
      }),
      ...data.l.map(l => ({ fecha: l.fecha, tipo: 'Legalización', orden: l.orden, detalle: `Acta N.º ${l.id} · ${textoResultado(l.resultado)}${l.medio ? ' · ' + l.medio : ''}`, valor: -l.resultado }))
    ]
    const orden: Record<string, number> = { 'Consignación': 0, 'Traspaso recibido': 1, 'Traspaso entregado': 2, 'Legalización': 9 }
    return m.sort((a, b) => a.fecha.localeCompare(b.fecha) || (orden[a.tipo] ?? 5) - (orden[b.tipo] ?? 5))
  }, [data, tec, app])

  const inicial = movs.filter(x => x.fecha < desde).reduce((s, x) => s + x.valor, 0)
  let run = inicial
  const filas = movs.filter(x => x.fecha >= desde && x.fecha <= hasta).map(x => ({ ...x, saldo: (run += x.valor) }))
  const final = run

  const estado = (v: number) => v > 0 ? `${app.nombre(tec)} debe a la empresa ${fmt(v)}` : v < 0 ? `La empresa le debe a ${app.nombre(tec)} ${fmt(-v)}` : 'Sin saldo pendiente'

  function exportar() {
    descargarCSV(`estado-cuenta-${app.nombre(tec).replace(/\s+/g, '-')}-${desde}-a-${hasta}.csv`, [
      ['Estado de cuenta de viáticos', app.nombre(tec)], ['Periodo', desde, hasta], ['Saldo inicial', inicial], [],
      ['Fecha', 'Movimiento', 'Orden', 'Detalle', 'Valor (+ a cargo del técnico / − a su favor)', 'Saldo'],
      ...filas.map(f => [f.fecha, f.tipo, f.orden, f.detalle, f.info ? `(${f.info})` : f.valor, f.saldo]),
      [], ['Saldo final', '', '', estado(final), '', final]
    ])
  }

  return <>
    <div className="aform noprint">
      <div><label htmlFor="ec-t">Técnico</label><select id="ec-t" className="inp" value={tec} onChange={e => setTec(e.target.value)}>
        {tecnicos.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.activo ? '' : ' (inactivo)'}</option>)}</select></div>
      <div><label htmlFor="ec-d">Desde</label><input id="ec-d" type="date" className="inp" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></div>
      <div><label htmlFor="ec-h">Hasta</label><input id="ec-h" type="date" className="inp" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} /></div>
      <div><button className="btn pri w" onClick={exportar} disabled={!data}>Descargar Excel (CSV)</button></div>
    </div>
    {!data ? <Cargando /> : <>
      <h3>Estado de cuenta · {app.nombre(tec)} · {flarga(desde)} a {flarga(hasta)}</h3>
      <div className="kpis">
        <div><small>Saldo inicial</small><b>{fmt(inicial)}</b></div>
        <div className="main"><small>Saldo al {fdate(hasta)}</small><b>{fmt(Math.abs(final))}</b></div>
        <div><small>Estado</small><b style={{ fontSize: 16, whiteSpace: 'normal' }}>{final > 0 ? 'Debe reintegrar' : final < 0 ? 'Por reembolsarle' : 'Al día'}</b></div>
      </div>
      <p className="note">Positivo: dinero de la empresa en poder del técnico (lo debe legalizar o reintegrar). Negativo: la empresa le debe al técnico. Los gastos por revisar y los no aprobados se muestran pero no cambian el saldo.</p>
      {!filas.length ? <Vacio>Sin movimientos en el periodo.</Vacio> :
        <div className="scroll"><table className="stack"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Orden</th><th>Detalle</th><th className="n">Valor</th><th className="n">Saldo</th></tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i} className={f.info ? 'info' : f.tipo === 'Legalización' ? 'legrow' : ''}>
            <td className="nw">{fdate(f.fecha)}</td><td>{f.tipo}</td><td className="nw">{f.orden}</td><td>{f.detalle}</td>
            <td className="n">{f.info ? <Tag k="n">{f.info}</Tag> : (f.valor > 0 ? '+' : f.valor < 0 ? '−' : '') + fmt(Math.abs(f.valor))}</td>
            <td className="n"><b>{fmt(f.saldo)}</b></td></tr>)}</tbody></table></div>}
      <p className="acta-res">{estado(final)}</p>
    </>}
  </>
}
