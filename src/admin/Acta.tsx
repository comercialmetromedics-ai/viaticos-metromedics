import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../lib/store'
import { sb } from '../lib/sb'
import type { Consignacion, Legalizacion, Reporte, Traspaso } from '../lib/types'
import { codigo, ESTADOS, fdate, flarga, fmt, textoResultado } from '../lib/util'
import { Soporte } from '../ui'

/** Acta de legalización: detalle completo, lista para imprimir o guardar como PDF */
export default function Acta({ l, onCerrar }: { l: Legalizacion; onCerrar: () => void }) {
  const app = useApp()
  const [reps, setReps] = useState<Reporte[]>([])
  const [cons, setCons] = useState<Consignacion[]>([])
  const [tras, setTras] = useState<Traspaso[]>([])
  useEffect(() => {
    document.body.classList.add('acta-abierta')
    Promise.all([
      sb.from('reportes').select('*').eq('legalizacion_id', l.id).order('fecha_gasto'),
      sb.from('consignaciones').select('*').eq('legalizacion_id', l.id).order('fecha'),
      sb.from('traspasos').select('*').or(`legalizacion_de.eq.${l.id},legalizacion_a.eq.${l.id}`).order('fecha')
    ]).then(([a, b, c]) => { setReps(a.data || []); setCons(b.data || []); setTras(c.data || []) })
    return () => document.body.classList.remove('acta-abierta')
  }, [l.id])
  const o = app.orden(l.orden)
  const neto = l.consignado + l.traspaso_recibido - l.traspaso_entregado

  return createPortal(
    <div className="acta-fondo" onClick={onCerrar}>
      <article className="acta" onClick={e => e.stopPropagation()}>
        <div className="acta-bar noprint">
          <button className="btn pri" onClick={() => window.print()}>Imprimir / guardar PDF</button>
          <button className="btn" onClick={onCerrar}>Cerrar</button>
        </div>
        <header className="acta-h">
          <div><b>METROMEDICS S.A.S</b><br /><span>Acta de legalización de viáticos N.º {l.id}</span></div>
          <div className="r">Fecha de cierre: <b>{flarga(l.fecha)}</b></div>
        </header>
        <table className="acta-t">
          <tbody>
            <tr><th>Orden de servicio</th><td>{l.orden}</td><th>Cliente</th><td>{o?.cliente}</td></tr>
            <tr><th>Técnico</th><td>{app.nombre(l.tecnico)}</td><th>Ciudad</th><td>{app.ciudad(o?.ciudad_id)}</td></tr>
            <tr><th>Periodo de gastos</th><td>{l.desde ? `${fdate(l.desde)} a ${fdate(l.hasta!)}` : '—'}</td><th>Legalizó</th><td>{app.nombre(l.creado_por)}</td></tr>
          </tbody>
        </table>

        <h4>Dinero recibido</h4>
        <table className="acta-t"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Detalle</th><th className="n">Valor</th></tr></thead>
          <tbody>
            {cons.map(c => <tr key={'c' + c.id}><td>{fdate(c.fecha)}</td><td>Consignación</td><td>{[c.medio, c.nota].filter(Boolean).join(' · ')}</td><td className="n">{fmt(c.monto)}</td></tr>)}
            {tras.map(t => <tr key={'t' + t.id}><td>{fdate(t.fecha)}</td><td>{t.a === l.tecnico ? `Traspaso recibido de ${app.nombre(t.de)}` : `Traspaso entregado a ${app.nombre(t.a)}`}</td><td>{t.nota}</td>
              <td className="n">{t.a === l.tecnico ? '' : '−'}{fmt(t.monto)}</td></tr>)}
            {!cons.length && !tras.length && <tr><td colSpan={4}>Sin consignaciones (gastos pagados por el técnico)</td></tr>}
            <tr className="tot"><td colSpan={3}>Total recibido neto</td><td className="n">{fmt(neto)}</td></tr>
          </tbody></table>

        <h4>Gastos reportados ({l.n_reportes})</h4>
        <table className="acta-t"><thead><tr><th>Fecha</th><th>Código</th><th>Concepto</th><th>Soporte</th><th>Estado</th><th className="n">Reportado</th><th className="n">Aprobado</th></tr></thead>
          <tbody>
            {reps.map(r => <tr key={r.id}><td>{fdate(r.fecha_gasto)}</td><td>{codigo(r.id)}</td>
              <td>{app.concepto(r.concepto_id)?.nombre}{r.subtipo || r.descripcion ? ' · ' + (r.subtipo || r.descripcion) : ''}</td>
              <td className="soporte-cel"><span className="noprint"><Soporte size="s" path={r.soporte_path} label="Ver" /></span><span>{r.factura_electronica ? 'FE' : 'Recibo + RUT'}</span></td>
              <td>{r.estado === 'rechazado' ? 'No aprobado' : ESTADOS[r.estado]}</td>
              <td className="n">{fmt(r.monto)}</td><td className="n">{fmt(r.aprobado || 0)}</td></tr>)}
            <tr className="tot"><td colSpan={5}>Totales</td><td className="n">{fmt(l.reportado)}</td><td className="n">{fmt(l.aprobado)}</td></tr>
          </tbody></table>

        <h4>Resultado</h4>
        <table className="acta-t"><tbody>
          <tr><th>Recibido neto</th><td className="n">{fmt(neto)}</td></tr>
          <tr><th>Gastos aprobados</th><td className="n">− {fmt(l.aprobado)}</td></tr>
          <tr><th>No aprobado (no reconocido)</th><td className="n">{fmt(l.no_aprobado)}</td></tr>
          <tr className="tot"><th>{l.resultado > 0 ? 'Reintegro del técnico a la empresa' : l.resultado < 0 ? 'Reembolso de la empresa al técnico' : 'Saldo'}</th><td className="n">{fmt(Math.abs(l.resultado))}</td></tr>
          <tr><th>Cómo se saldó</th><td>{l.medio || '—'}{l.nota ? ' · ' + l.nota : ''}</td></tr>
        </tbody></table>
        {l.comprobante_path && <div className="noprint" style={{ marginTop: 8 }}><Soporte path={l.comprobante_path} label="Comprobante" /></div>}
        <p className="acta-res">{textoResultado(l.resultado)}</p>

        <div className="firmas"><div>Firma del técnico<br /><span>{app.nombre(l.tecnico)}</span></div><div>Firma de quien legaliza<br /><span>{app.nombre(l.creado_por)}</span></div></div>
      </article>
    </div>,
    document.body
  )
}
