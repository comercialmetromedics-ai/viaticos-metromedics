import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { sb } from '../lib/sb'
import type { Consignacion, Reporte } from '../lib/types'
import { flarga, fmt, sumaDias, topeDe, ymd } from '../lib/util'
import { Cargando } from '../ui'

type Per = 'sem' | 'mes' | 'ano'

function inicio(per: Per) {
  const hoy = ymd()
  if (per === 'mes') return hoy.slice(0, 8) + '01'
  if (per === 'ano') return hoy.slice(0, 5) + '01-01'
  const w = new Date(hoy + 'T12:00:00-05:00').getUTCDay()
  return sumaDias(hoy, -((w + 6) % 7))
}

function Barras({ datos }: { datos: [string, number][] }) {
  if (!datos.length) return <p className="note">Sin datos en el periodo.</p>
  const m = Math.max(1, ...datos.map(d => d[1]))
  return <div className="bars">{datos.map(([k, v]) => <div className="br" key={k}><span>{k}</span><div className="tr"><i style={{ width: `${(v / m) * 100}%` }} /></div><span className="n">{fmt(v)}</span></div>)}</div>
}

export default function Indicadores({ tick }: { tick: number }) {
  const app = useApp()
  const [per, setPer] = useState<Per>('mes')
  const [reps, setReps] = useState<Reporte[] | null>(null)
  const [sem, setSem] = useState<Reporte[]>([])
  const [cons, setCons] = useState<Consignacion[]>([])
  const desde = inicio(per)
  const desde12 = sumaDias(inicio('sem'), -77)

  useEffect(() => {
    setReps(null)
    Promise.all([
      sb.from('reportes').select('*').gte('fecha_gasto', desde),
      sb.from('reportes').select('*').gte('fecha_gasto', desde12).in('estado', ['aprobado', 'parcial']),
      sb.from('consignaciones').select('*').gte('fecha', desde)
    ]).then(([a, b, c]) => { setReps(a.data || []); setSem(b.data || []); setCons(c.data || []) })
  }, [desde, desde12, tick])

  if (!reps) return <Cargando />
  const apr = reps.filter(r => r.aprobado != null)
  const tot = apr.reduce((s, r) => s + (r.aprobado || 0), 0)
  const pend = reps.filter(r => r.estado === 'pendiente')
  const conTope = reps.map(r => ({ r, t: topeDe(r.concepto_id, app.orden(r.orden), r.noches, app.conceptos, app.topes) })).filter(x => x.t != null)
  const fuera = conTope.filter(x => x.r.monto > (x.t as number)).length
  const noRec = apr.reduce((s, r) => s + (r.monto - (r.aprobado || 0)), 0)
  const tarde = reps.filter(r => r.extemporaneo).length
  const agrupar = (f: (r: Reporte) => string) => {
    const m = new Map<string, number>(); apr.forEach(r => m.set(f(r), (m.get(f(r)) || 0) + (r.aprobado || 0)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const semanas = Array.from({ length: 12 }, (_, i) => {
    const ini = sumaDias(desde12, i * 7), fin = sumaDias(ini, 6)
    return { l: new Date(ini + 'T12:00:00-05:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }),
      v: sem.filter(r => r.fecha_gasto >= ini && r.fecha_gasto <= fin).reduce((s, r) => s + (r.aprobado || 0), 0) }
  })
  const wm = Math.max(1, ...semanas.map(s => s.v))
  const ords = new Map<string, { n: number; rep: number; apr: number; pen: number }>()
  reps.forEach(r => { const x = ords.get(r.orden) || { n: 0, rep: 0, apr: 0, pen: 0 }; x.n++; x.rep += r.monto; x.apr += r.aprobado || 0; if (r.estado === 'pendiente') x.pen += r.monto; ords.set(r.orden, x) })
  const tecs = [...new Set(reps.map(r => r.tecnico))]

  return <>
    <div className="tool">
      <span className="note">Periodo: desde el {flarga(desde)} (por fecha del gasto)</span>
      <div className="seg">{([['sem', 'Semana'], ['mes', 'Mes'], ['ano', 'Año']] as [Per, string][]).map(([k, l]) =>
        <button key={k} aria-pressed={per === k} onClick={() => setPer(k)}>{l}</button>)}</div>
    </div>
    <div className="kpis">
      <div className="main"><small>Total aprobado</small><b>{fmt(tot)}</b></div>
      <div><small>Viáticos consignados</small><b>{fmt(cons.reduce((s, c) => s + c.monto, 0))}</b></div>
      <div><small>Por revisar · {pend.length} reportes</small><b>{fmt(pend.reduce((s, r) => s + r.monto, 0))}</b></div>
      <div><small>Reportes recibidos</small><b>{reps.length}</b></div>
      <div><small>Fuera de presupuesto</small><b>{conTope.length ? Math.round((fuera / conTope.length) * 100) : 0} %</b></div>
      <div><small>No reconocido (exceso)</small><b>{fmt(noRec)}</b></div>
      <div><small>Rechazados ahora</small><b>{reps.filter(r => r.estado === 'rechazado').length}</b></div>
      <div><small>Extemporáneos</small><b>{tarde} · {reps.length ? Math.round((tarde / reps.length) * 100) : 0} %</b></div>
    </div>
    <div className="grid2">
      <div><h3 className="t0">Aprobado por concepto</h3><Barras datos={agrupar(r => app.concepto(r.concepto_id)?.nombre || r.concepto_id)} /></div>
      <div><h3 className="t0">Aprobado por técnico</h3><Barras datos={agrupar(r => app.nombre(r.tecnico))} /></div>
      <div><h3 className="t0">Aprobado por cliente</h3><Barras datos={agrupar(r => app.orden(r.orden)?.cliente || r.orden).slice(0, 8)} /></div>
      <div><h3 className="t0">Aprobado por ciudad</h3><Barras datos={agrupar(r => app.ciudad(app.orden(r.orden)?.ciudad_id))} /></div>
    </div>
    <h3>Aprobado por semana · últimas 12</h3>
    <div className="cols">{semanas.map((s, i) => <div key={i} title={fmt(s.v)}><i style={{ height: `${(s.v / wm) * 100}%` }} /><span>{i % 3 === 2 || i === 11 ? s.l : ''}</span></div>)}</div>
    <h3>Puntualidad por técnico</h3>
    <table className="stack"><thead><tr><th>Técnico</th><th className="n">Reportes</th><th className="n">Extemporáneos</th><th className="n">A tiempo</th></tr></thead>
      <tbody>{tecs.map(t => { const a = reps.filter(r => r.tecnico === t), l = a.filter(r => r.extemporaneo).length
        return <tr key={t}><td>{app.nombre(t)}</td><td className="n">{a.length}</td><td className="n">{l}</td><td className="n"><b>{Math.round(((a.length - l) / a.length) * 100)} %</b></td></tr> })}</tbody></table>
    <h3>Por orden de servicio</h3>
    <div className="scroll"><table className="stack"><thead><tr><th>Orden</th><th>Cliente</th><th className="n">Gastos</th><th className="n">Reportado</th><th className="n">Aprobado</th><th className="n">Por revisar</th></tr></thead>
      <tbody>{[...ords.entries()].sort().map(([k, x]) => <tr key={k}><td><b>{k}</b></td><td>{app.orden(k)?.cliente}</td><td className="n">{x.n}</td>
        <td className="n">{fmt(x.rep)}</td><td className="n">{fmt(x.apr)}</td><td className="n">{fmt(x.pen)}</td></tr>)}</tbody></table></div>
  </>
}
