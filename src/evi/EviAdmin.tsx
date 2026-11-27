import { useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import type { Inventario, Servicio } from '../lib/types'
import { fdate, fhora } from '../lib/util'
import { Modulos, Soporte, Vacio } from '../ui'
import type { Modulo } from '../ui'
import { CargarInventario, completo, generarExcelAvance, NuevoServicio, Progreso, useEquipos, useInventarios } from './comun'

export default function EviAdmin({ onTec, onModulo }: { onTec: () => void; onModulo: (m: Modulo | null) => void }) {
  const app = useApp()
  const { yo } = app
  const { invs, av, servs, listo, cargar } = useInventarios()
  const [nuevo, setNuevo] = useState(false)
  const [ver, setVer] = useState<string | null>(null)
  const [cargando, setCargando] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [gen, setGen] = useState<{ orden: string; txt: string } | null>(null)

  async function descargar(inv: Inventario) {
    setGen({ orden: inv.orden, txt: 'Cargando equipos…' })
    try {
      const todos = []
      for (let i = 0; ; i += 1000) {
        const { data } = await sb.from('equipos').select('*').eq('orden', inv.orden).order('id').range(i, i + 999)
        todos.push(...(data || [])); if (!data || data.length < 1000) break
      }
      await generarExcelAvance(inv, todos, app.nombre, servs.find(x => x.num === inv.orden)?.cliente || '', t => setGen({ orden: inv.orden, txt: t }))
      app.toast('Avance técnico descargado')
    } catch (e) { app.toast(msgError(e), 'error') } finally { setGen(null) }
  }

  const [archivados, setArchivados] = useState(false)
  const k = q.trim().toUpperCase()
  const lista = servs.filter(s => s.archivado === archivados && (!k || [s.num, s.cliente, app.ciudad(s.ciudad_id)].join(' ').toUpperCase().includes(k)))
  async function archivar(s: Servicio, v: boolean) {
    const { error } = await sb.from('servicios').update({ archivado: v }).eq('num', s.num)
    if (error) return app.toast(msgError(error), 'error')
    app.toast(v ? `${s.num} archivado` : `${s.num} reactivado`); cargar()
  }

  return (
    <div className="admin">
      <header className="abar noprint">
        <div className="brand"><img src="icon.svg" alt="" width={32} height={32} /><div><Modulos actual="evi" onCambio={onModulo} /><small>Administración · {yo?.nombre}</small></div></div>
        <div className="abar-r">
          <button className="btn sm" onClick={onTec}>Vista técnico</button>
          <button className="btn sm" onClick={() => sb.auth.signOut()}>Salir</button>
        </div>
      </header>
      <main className="apane">
        {nuevo ? <NuevoServicio servs={servs} onCancelar={() => setNuevo(false)} onListo={() => { setNuevo(false); cargar() }} />
          : cargando ? <div className="narrow"><CargarInventario orden={cargando} onCancelar={() => setCargando(null)} onListo={() => { setCargando(null); cargar() }} /></div>
          : ver ? <Detalle orden={ver} onVolver={() => setVer(null)} onDescargar={descargar} gen={gen} onBorrado={() => { setVer(null); cargar() }} invs={invs} servs={servs} />
          : <>
            <h2>Evidencias de calibración</h2>
            <p className="note">Servicios del módulo de evidencias (independientes de las órdenes de viáticos). Cada servicio tiene un inventario (Excel); los técnicos cargan la foto del equipo y la del sticker, y aquí descargas el Excel original con las fotos en cada fila.</p>
            <div className="tool">
              <div className="range">
                <button className="btn sm pri" onClick={() => setNuevo(true)}>+ Nuevo servicio</button>
                <label><input type="checkbox" checked={archivados} onChange={e => setArchivados(e.target.checked)} /> Ver archivados</label>
              </div>
              <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar servicio o cliente" aria-label="Buscar" />
            </div>
            {!listo ? <p className="hint">Cargando…</p> : !lista.length ? <Vacio>{archivados ? 'No hay servicios archivados.' : 'Aún no hay servicios. Crea uno con «Nuevo servicio».'}</Vacio> :
              <div className="tblw"><table className="stack">
                <thead><tr><th>Servicio</th><th>Inventario</th><th>Avance</th><th>Última evidencia</th><th></th></tr></thead>
                <tbody>{lista.map(s => { const i = invs.find(x => x.orden === s.num); const a = av.find(x => x.orden === s.num)
                  return <tr key={s.num}>
                    <td><b>{s.num}</b><div className="note">{s.cliente} · {app.ciudad(s.ciudad_id)}</div><div className="note">Creado por {app.nombre(s.responsable)}</div></td>
                    <td>{i ? <>{i.nombre_archivo}<div className="note">{app.nombre(i.cargado_por)} · {fdate(i.cargado_at)}</div></> : <span className="note">Sin inventario</span>}</td>
                    <td style={{ minWidth: 200 }}>{a && <Progreso n={a.con_evidencia} total={a.total} />}{a && a.agregados > 0 && <div className="note">{a.agregados} agregados en campo</div>}</td>
                    <td>{a?.ultima ? `${fdate(a.ultima)} ${fhora(a.ultima)}` : '—'}</td>
                    <td className="nw">{i ? <><button className="btn sm" onClick={() => setVer(s.num)}>Ver equipos</button>{' '}
                      <button className="btn sm pri" disabled={!!gen} onClick={() => descargar(i)}>{gen?.orden === s.num ? gen.txt : 'Descargar avance'}</button></>
                      : !s.archivado && <button className="btn sm pri" onClick={() => setCargando(s.num)}>Cargar inventario</button>}{' '}
                      <button className="btn sm" onClick={() => archivar(s, !s.archivado)}>{s.archivado ? 'Reactivar' : 'Archivar'}</button></td>
                  </tr> })}</tbody></table></div>}
          </>}
      </main>
    </div>
  )
}

function Detalle({ orden, invs, servs, onVolver, onDescargar, onBorrado, gen }: {
  orden: string; invs: Inventario[]; servs: Servicio[]; onVolver: () => void; onDescargar: (i: Inventario) => void; onBorrado: () => void; gen: { orden: string; txt: string } | null
}) {
  const app = useApp()
  const { eqs } = useEquipos(orden)
  const [filtro, setFiltro] = useState<'todos' | 'ok' | 'pend' | 'campo'>('todos')
  const [q, setQ] = useState('')
  const inv = invs.find(i => i.orden === orden)!
  const o = servs.find(s => s.num === orden)
  const k = q.trim().toUpperCase()
  const lista = (eqs || []).filter(e => (filtro === 'todos' || (filtro === 'ok' ? completo(e) : filtro === 'pend' ? !completo(e) : e.fila == null))
    && (!k || [e.descripcion, e.serie, ...e.codigos].join(' ').toUpperCase().includes(k)))
  const n = (eqs || []).filter(completo).length
  async function borrar() {
    if (!window.confirm(`¿Borrar el inventario de ${orden}? Se podrá cargar de nuevo.`)) return
    const { error } = await sb.rpc('borrar_inventario', { p_orden: orden })
    if (error) return app.toast(msgError(error), 'error')
    app.toast('Inventario borrado'); onBorrado()
  }
  return <>
    <button className="link" onClick={onVolver}>← Volver</button>
    <h2>{orden} · {o?.cliente}</h2>
    <p className="note">Inventario {inv.nombre_archivo} (hoja «{inv.hoja}»), cargado por {app.nombre(inv.cargado_por)} el {fdate(inv.cargado_at)}.</p>
    {eqs && <Progreso n={n} total={eqs.length} grande />}
    <div className="tool">
      <div className="chips fch">{([['todos', 'Todos'], ['pend', 'Pendientes'], ['ok', 'Con evidencia'], ['campo', 'Agregados en campo']] as const).map(([k2, l]) =>
        <button key={k2} aria-pressed={filtro === k2} onClick={() => setFiltro(k2)}>{l}</button>)}</div>
      <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar código, serie o equipo" aria-label="Buscar equipo" />
    </div>
    <div className="range mt">
      <button className="btn pri" disabled={!!gen} onClick={() => onDescargar(inv)}>{gen?.orden === orden ? gen.txt : 'Descargar avance técnico (Excel)'}</button>
      {eqs && !eqs.some(e => e.foto_equipo || e.foto_sticker) && <button className="btn bad" onClick={borrar}>Borrar inventario</button>}
    </div>
    {!eqs ? <p className="hint">Cargando…</p> : !lista.length ? <Vacio>Sin equipos con este filtro.</Vacio> :
      <div className="tblw mt"><table className="stack">
        <thead><tr><th>Fila</th><th>Equipo</th><th>Código</th><th>Serie</th><th>Foto equipo</th><th>Sticker</th><th>Registro</th></tr></thead>
        <tbody>{lista.slice(0, 500).map(e => <tr key={e.id}>
          <td>{e.fila ?? <span className="tag w">Campo</span>}</td>
          <td>{e.descripcion || '—'}</td><td>{e.codigos.join(' / ') || '—'}</td><td>{e.serie || '—'}</td>
          <td>{e.foto_equipo ? <Soporte size="s" path={e.foto_equipo} label="Equipo" /> : <span className="note">Pendiente</span>}</td>
          <td>{e.foto_sticker ? <Soporte size="s" path={e.foto_sticker} label="Sticker" /> : <span className="note">Pendiente</span>}</td>
          <td className="note">{e.evidencia_at ? <>{app.nombre(e.evidencia_por)}<br />{fdate(e.evidencia_at)} {fhora(e.evidencia_at)}</> : '—'}
            {e.nota && <div>Nota: {e.nota}</div>}{e.fila == null && <div>Agregado por {app.nombre(e.agregado_por)}</div>}</td>
        </tr>)}</tbody></table></div>}
    {lista.length > 500 && <p className="note">Mostrando 500 de {lista.length}; usa el buscador.</p>}
  </>
}
