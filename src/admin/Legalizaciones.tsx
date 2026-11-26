import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { sb } from '../lib/sb'
import type { Legalizacion } from '../lib/types'
import { descargarCSV, fdate, fmt, textoResultado, ymd } from '../lib/util'
import { Cargando, Tag, Vacio } from '../ui'
import Acta from './Acta'

export const tagResultado = (r: number) => <Tag k={r > 0 ? 'bad' : r < 0 ? 'ok' : 'n'}>{textoResultado(r)}</Tag>

export default function Legalizaciones({ tick }: { tick: number }) {
  const app = useApp()
  const hoy = ymd()
  const [desde, setDesde] = useState(hoy.slice(0, 5) + '01-01')
  const [hasta, setHasta] = useState(hoy)
  const [q, setQ] = useState('')
  const [l, setL] = useState<Legalizacion[] | null>(null)
  const [ver, setVer] = useState<Legalizacion | null>(null)
  useEffect(() => {
    setL(null)
    sb.from('legalizaciones').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }).order('id', { ascending: false })
      .then(r => setL(r.data || []))
  }, [desde, hasta, tick])

  const vis = (l || []).filter(x => !q || [x.orden, app.nombre(x.tecnico), app.orden(x.orden)?.cliente, String(x.id)].join(' ').toLowerCase().includes(q.toLowerCase()))
  const sum = (k: keyof Legalizacion) => vis.reduce((s, x) => s + (x[k] as number), 0)

  function exportar() {
    descargarCSV(`legalizaciones-${desde}-a-${hasta}.csv`, [
      ['Acta', 'Fecha cierre', 'Orden', 'Cliente', 'Técnico', 'Desde', 'Hasta', 'Consignado', 'Traspaso recibido', 'Traspaso entregado', 'Reportado', 'Aprobado', 'No aprobado', 'Reintegro técnico', 'Reembolso empresa', 'Cómo se saldó', 'Nota', 'Legalizó'],
      ...vis.map(x => [x.id, x.fecha, x.orden, app.orden(x.orden)?.cliente || '', app.nombre(x.tecnico), x.desde, x.hasta, x.consignado, x.traspaso_recibido, x.traspaso_entregado,
        x.reportado, x.aprobado, x.no_aprobado, x.resultado > 0 ? x.resultado : 0, x.resultado < 0 ? -x.resultado : 0, x.medio || '', x.nota || '', app.nombre(x.creado_por)])
    ])
  }

  return <>
    <div className="tool noprint">
      <div className="range">
        <label>Desde <input type="date" className="inp" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></label>
        <label>Hasta <input type="date" className="inp" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} /></label>
      </div>
      <div className="range">
        <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar orden, técnico o cliente" aria-label="Buscar" />
        <button className="btn" onClick={exportar} disabled={!vis.length}>Descargar Excel (CSV)</button>
      </div>
    </div>
    {!l ? <Cargando /> : !vis.length ? <Vacio>No hay legalizaciones en el periodo. Se cierran desde “Viáticos entregados”.</Vacio> : <>
      <div className="kpis">
        <div className="main"><small>Legalizaciones</small><b>{vis.length}</b></div>
        <div><small>Gastos aprobados</small><b>{fmt(sum('aprobado'))}</b></div>
        <div><small>No aprobado</small><b>{fmt(sum('no_aprobado'))}</b></div>
        <div><small>Reintegrado por técnicos</small><b>{fmt(vis.reduce((s, x) => s + Math.max(0, x.resultado), 0))}</b></div>
        <div><small>Reembolsado a técnicos</small><b>{fmt(vis.reduce((s, x) => s + Math.max(0, -x.resultado), 0))}</b></div>
      </div>
      <div className="scroll"><table className="stack"><thead><tr><th>Acta</th><th>Cierre</th><th>Orden</th><th>Técnico</th><th>Periodo</th><th className="n">Recibido</th><th className="n">Aprobado</th><th className="n">No aprobado</th><th>Resultado</th><th></th></tr></thead>
        <tbody>{vis.map(x => <tr key={x.id}>
          <td>N.º {x.id}</td><td>{fdate(x.fecha)}</td><td><b>{x.orden}</b><div className="note">{app.orden(x.orden)?.cliente}</div></td><td>{app.nombre(x.tecnico)}</td>
          <td>{x.desde ? `${fdate(x.desde)} – ${fdate(x.hasta!)}` : '—'}</td>
          <td className="n">{fmt(x.consignado + x.traspaso_recibido - x.traspaso_entregado)}</td><td className="n">{fmt(x.aprobado)}</td><td className="n">{fmt(x.no_aprobado)}</td>
          <td>{tagResultado(x.resultado)}<div className="note">{x.medio}</div></td>
          <td><button className="btn sm" onClick={() => setVer(x)}>Ver acta</button></td></tr>)}</tbody></table></div>
    </>}
    {ver && <Acta l={ver} onCerrar={() => setVer(null)} />}
  </>
}
