import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import type { Legalizacion, Saldo } from '../lib/types'
import { fdate, fmt, neto } from '../lib/util'
import { Cargando, Tag, Vacio } from '../ui'
import Acta from './Acta'
import { tagResultado } from './Legalizaciones'

interface Rep { orden: string; monto: number; aprobado: number | null; fecha_gasto: string; legalizacion_id: number | null }

export default function Ordenes({ tick }: { tick: number }) {
  const app = useApp()
  const [ver, setVer] = useState<'act' | 'arch' | 'todas'>('act')
  const [q, setQ] = useState('')
  const [leg, setLeg] = useState<Legalizacion[] | null>(null)
  const [reps, setReps] = useState<Rep[]>([])
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [abierta, setAbierta] = useState<string | null>(null)
  const [acta, setActa] = useState<Legalizacion | null>(null)
  const [conf, setConf] = useState<string | null>(null)
  const anio = new Date().getFullYear()

  useEffect(() => {
    Promise.all([
      sb.from('legalizaciones').select('*').order('fecha', { ascending: false }),
      sb.from('reportes').select('orden,monto,aprobado,fecha_gasto,legalizacion_id'),
      sb.from('saldos').select('*')
    ]).then(([a, b, c]) => { setLeg(a.data || []); setReps(b.data || []); setSaldos(c.data || []) })
  }, [tick])

  async function archivar(num: string, archivada: boolean) {
    const abiertos = saldos.filter(s => s.orden === num && (s.consignado + s.traspaso_recibido + s.traspaso_entregado + s.reportado) > 0)
    if (archivada && abiertos.length) return app.toast(`No se puede archivar: ${abiertos.map(s => app.nombre(s.tecnico)).join(', ')} tiene movimientos sin legalizar.`, 'error')
    const { error } = await sb.from('ordenes').update({ archivada }).eq('num', num)
    setConf(null)
    if (error) return app.toast(msgError(error), 'error')
    await app.recargar(['ordenes']); app.toast(archivada ? `${num} archivada: ya no aparece a los técnicos` : `${num} reactivada`)
  }

  const lista = app.ordenes.filter(o => (ver === 'todas' || (ver === 'arch') === o.archivada) &&
    (!q || [o.num, o.cliente, app.ciudad(o.ciudad_id), app.nombre(o.responsable)].join(' ').toLowerCase().includes(q.toLowerCase())))

  return <>
    <div className="tool">
      <div className="seg">{([['act', 'Activas'], ['arch', 'Archivadas'], ['todas', 'Todas']] as const).map(([k, l]) =>
        <button key={k} aria-pressed={ver === k} onClick={() => setVer(k)}>{l}</button>)}</div>
      <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar orden, cliente o técnico" aria-label="Buscar órdenes" />
    </div>
    <p className="note top">Una orden puede tener varias visitas en el año; cada visita de cada técnico se cierra con su propia legalización. Archiva las órdenes que ya no se usarán: dejan de aparecer a los técnicos y no reciben gastos ni consignaciones.</p>
    {!leg ? <Cargando /> : !lista.length ? <Vacio>No hay órdenes en esta vista.</Vacio> : lista.map(o => {
      const lo = leg.filter(l => l.orden === o.num)
      const ro = reps.filter(r => r.orden === o.num)
      const apr = ro.reduce((s, r) => s + (r.aprobado || 0), 0)
      const aprAnio = ro.filter(r => r.fecha_gasto.startsWith(String(anio))).reduce((s, r) => s + (r.aprobado || 0), 0)
      const so = saldos.filter(s => s.orden === o.num && (s.consignado + s.traspaso_recibido + s.traspaso_entregado + s.reportado) > 0)
      const open = abierta === o.num
      return (
        <section className="cli" key={o.num}>
          <div className="clih">
            <div><b>{o.num}</b> {o.archivada && <Tag>Archivada</Tag>}<div className="note">{o.cliente} · {app.ciudad(o.ciudad_id)} · responsable {app.nombre(o.responsable)} · creada {fdate(o.created_at)}</div></div>
            <div className="range" style={{ width: 'auto' }}>
              <button className="btn sm" onClick={() => setAbierta(open ? null : o.num)}>{open ? 'Ocultar' : 'Historial'}</button>
              {conf === o.num
                ? <button className="btn sm bad" onClick={() => archivar(o.num, !o.archivada)}>¿Seguro? {o.archivada ? 'Reactivar' : 'Archivar'}</button>
                : <button className="btn sm" onClick={() => setConf(o.num)}>{o.archivada ? 'Reactivar' : 'Archivar'}</button>}
            </div>
          </div>
          <div className="ord ordh">
            <span>Aprobado {anio}: <b>{fmt(aprAnio)}</b></span><span>Aprobado total: <b>{fmt(apr)}</b></span>
            <span>Legalizaciones: <b>{lo.length}</b></span><span>Sin legalizar: <b>{so.length ? so.map(s => app.nombre(s.tecnico).split(' ')[0]).join(', ') : 'nada'}</b></span>
          </div>
          {open && <div className="ord">
            {so.map(s => <p key={s.tecnico} className="meta">En curso · {app.nombre(s.tecnico)}: recibido {fmt(neto(s))} · aprobado {fmt(s.aprobado)} · por revisar {fmt(s.por_revisar)} (se legaliza en “Viáticos entregados”)</p>)}
            {lo.length ? <table className="stack"><thead><tr><th>Acta</th><th>Cierre</th><th>Técnico</th><th>Periodo</th><th className="n">Aprobado</th><th>Resultado</th><th></th></tr></thead>
              <tbody>{lo.map(l => <tr key={l.id}><td>N.º {l.id}</td><td>{fdate(l.fecha)}</td><td>{app.nombre(l.tecnico)}</td>
                <td>{l.desde ? `${fdate(l.desde)} – ${fdate(l.hasta!)}` : '—'}</td><td className="n">{fmt(l.aprobado)}</td><td>{tagResultado(l.resultado)}</td>
                <td><button className="btn sm" onClick={() => setActa(l)}>Ver acta</button></td></tr>)}</tbody></table>
              : <p className="note">Aún no tiene legalizaciones.</p>}
          </div>}
        </section>
      )
    })}
    {acta && <Acta l={acta} onCerrar={() => setActa(null)} />}
  </>
}
