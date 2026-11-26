import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { sb } from '../lib/sb'
import type { Consignacion, Reporte } from '../lib/types'
import { codigo, descargarCSV, fdate, fmt, ymd } from '../lib/util'
import { Cargando, Soporte, Tag, Vacio } from '../ui'

export function Aprobados({ tick }: { tick: number }) {
  const app = useApp()
  const hoy = ymd()
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01')
  const [hasta, setHasta] = useState(hoy)
  const [q, setQ] = useState('')
  const [reps, setReps] = useState<Reporte[] | null>(null)
  const [cons, setCons] = useState<Consignacion[]>([])

  const cargar = useCallback(async () => {
    setReps(null)
    const r = await sb.from('reportes').select('*').in('estado', ['aprobado', 'parcial']).gte('fecha_gasto', desde).lte('fecha_gasto', hasta).order('fecha_gasto')
    const ords = [...new Set((r.data || []).map(x => x.orden))]
    const c = ords.length ? await sb.from('consignaciones').select('*').in('orden', ords) : { data: [] }
    setReps(r.data || []); setCons(c.data || [])
  }, [desde, hasta])
  useEffect(() => { cargar() }, [cargar, tick])

  const vis = (reps || []).filter(r => {
    if (!q) return true; const o = app.orden(r.orden)
    return [r.orden, o?.cliente, app.nombre(r.tecnico)].join(' ').toLowerCase().includes(q.toLowerCase())
  })
  const porCli = new Map<string, Map<string, Reporte[]>>()
  vis.forEach(r => {
    const cli = app.orden(r.orden)?.cliente || '—'
    if (!porCli.has(cli)) porCli.set(cli, new Map())
    const m = porCli.get(cli)!; if (!m.has(r.orden)) m.set(r.orden, []); m.get(r.orden)!.push(r)
  })
  const suma = (a: Reporte[]) => a.reduce((s, r) => s + (r.aprobado || 0), 0)

  function exportar() {
    descargarCSV(`viaticos-aprobados-${desde}-a-${hasta}.csv`, [
      ['Código', 'Cliente', 'Orden', 'Ciudad', 'Técnico', 'Fecha gasto', 'Concepto', 'Detalle', 'Factura electrónica', 'Reportado', 'Aprobado', 'Extemporáneo', 'Retención practicada', 'Valor retenido', 'Motivo sin retención'],
      ...vis.map(r => { const o = app.orden(r.orden); return [codigo(r.id), o?.cliente || '', r.orden, app.ciudad(o?.ciudad_id), app.nombre(r.tecnico), r.fecha_gasto,
        app.concepto(r.concepto_id)?.nombre || r.concepto_id, r.subtipo || r.descripcion || '', r.factura_electronica ? 'Sí' : 'No', r.monto, r.aprobado, r.extemporaneo ? 'Sí' : 'No',
        r.retencion == null ? '' : r.retencion ? 'Sí' : 'No', r.retencion_valor ?? '', r.retencion_nota || ''] })
    ])
  }

  return <>
    <div className="tool">
      <div className="range">
        <label>Desde <input type="date" className="inp" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></label>
        <label>Hasta <input type="date" className="inp" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} /></label>
      </div>
      <div className="range">
        <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente, orden o técnico" aria-label="Buscar" />
        <button className="btn" onClick={exportar} disabled={!vis.length}>Exportar a Excel (CSV)</button>
      </div>
    </div>
    {!reps ? <Cargando /> : !porCli.size ? <Vacio>Sin gastos aprobados en el periodo.</Vacio> :
      [...porCli.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cli, ords]) => (
        <section className="cli" key={cli}>
          <div className="clih"><b>{cli}</b><span className="t">{fmt(suma([...ords.values()].flat()))}</span></div>
          {[...ords.entries()].map(([num, rs]) => (
            <div className="ord" key={num}>
              <div className="ordh"><b>{num} · {app.ciudad(app.orden(num)?.ciudad_id)}</b>
                <span>{rs.length} gastos · aprobado <b>{fmt(suma(rs))}</b> · consignado {fmt(cons.filter(c => c.orden === num).reduce((s, c) => s + c.monto, 0))}</span></div>
              <table className="stack"><thead><tr><th>Fecha</th><th>Técnico</th><th>Concepto</th><th>Soporte</th><th className="n">Reportado</th><th className="n">Aprobado</th></tr></thead>
                <tbody>{rs.map(r => <tr key={r.id}>
                  <td>{fdate(r.fecha_gasto)}</td><td>{app.nombre(r.tecnico)}</td>
                  <td>{app.concepto(r.concepto_id)?.nombre}{r.subtipo || r.descripcion ? ' · ' + (r.subtipo || r.descripcion) : ''} {r.estado === 'parcial' && <Tag k="ok">Hasta tope</Tag>} {r.extemporaneo && <Tag k="w">Extemporáneo</Tag>}</td>
                  <td><div className="mini"><Soporte size="s" path={r.soporte_path} label={r.factura_electronica ? 'FE' : 'Recibo'} />{r.rut_path && <Soporte size="s" path={r.rut_path} label="RUT" />}{r.anexo_path && <Soporte size="s" path={r.anexo_path} label="Anexo" />}</div></td>
                  <td className="n">{fmt(r.monto)}</td><td className="n"><b>{fmt(r.aprobado)}</b></td></tr>)}</tbody></table>
            </div>
          ))}
        </section>
      ))}
  </>
}

export function Rechazados({ tick }: { tick: number }) {
  const app = useApp()
  const [l, setL] = useState<Reporte[] | null>(null)
  useEffect(() => { sb.from('reportes').select('*').eq('estado', 'rechazado').order('revisado_at', { ascending: false }).then(r => setL(r.data || [])) }, [tick])
  return <>
    <p className="note top">Esperando que el técnico corrija y reenvíe. Al reenviar vuelven a “Por revisar”.</p>
    {!l ? <Cargando /> : !l.length ? <Vacio>No hay reportes rechazados.</Vacio> :
      <table className="stack"><thead><tr><th>Reporte</th><th>Orden</th><th>Técnico</th><th>Concepto</th><th className="n">Monto</th><th>Motivo</th><th>Devuelto</th></tr></thead>
        <tbody>{l.map(r => <tr key={r.id}><td>{codigo(r.id)}</td><td>{r.orden}</td><td>{app.nombre(r.tecnico)}</td><td>{app.concepto(r.concepto_id)?.nombre}</td>
          <td className="n">{fmt(r.monto)}</td><td>{r.motivo}</td><td>{r.revisado_at ? fdate(r.revisado_at) : ''}</td></tr>)}</tbody></table>}
  </>
}
