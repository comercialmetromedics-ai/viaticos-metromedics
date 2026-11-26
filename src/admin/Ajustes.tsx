import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import { fhora, limiteDe, miles, num, ymd } from '../lib/util'

const confirmar = (t: string) => window.confirm(t)

export default function Ajustes() {
  const app = useApp()
  const { config, ciudades, conceptos, topes, perfiles, toast, recargar } = app
  const [habil, setHabil] = useState<string[]>([])
  const [hT, setHT] = useState('')
  const [nc, setNc] = useState('')
  const [modoNc, setModoNc] = useState<'base' | 'propio'>('base')
  const [tNc, setTNc] = useState<Record<string, string>>({})
  const [nk, setNk] = useState({ nombre: '', unidad: 'por gasto', subtipos: '', desc: false, noche: false })
  const [err, setErr] = useState('')
  const [ver, setVer] = useState(0)
  const hoy = ymd()

  useEffect(() => { sb.from('habilitaciones').select('tecnico').eq('fecha', hoy).then(r => setHabil((r.data || []).map(x => x.tecnico))) }, [hoy])
  if (!config) return null

  async function guardarCfg(cambios: Record<string, unknown>) {
    const { error } = await sb.from('config').update(cambios).eq('id', 1)
    if (error) return toast(msgError(error), 'error')
    await recargar(['config']); toast('Horario actualizado')
  }
  async function guardarTope(concepto_id: string, ciudad_id: number, v: string) {
    const valor = num(v) || null
    const { error } = await sb.from('topes').upsert({ concepto_id, ciudad_id, valor })
    if (error) return toast(msgError(error), 'error')
    await recargar(['topes']); toast('Tope actualizado')
  }
  async function habilitar() {
    const t = hT || tecnicos[0]?.id; if (!t) return
    const { error } = await sb.from('habilitaciones').upsert({ tecnico: t, fecha: hoy })
    if (error) return toast(msgError(error), 'error')
    setHabil(h => [...new Set([...h, t])]); toast(`${app.nombre(t)} puede reportar hoy después del límite`)
  }
  async function guardarBase(id: string, v: string) {
    const { error } = await sb.from('conceptos').update({ tope_base: num(v) || null }).eq('id', id)
    if (error) return toast(msgError(error), 'error')
    await recargar(['conceptos']); toast('Tope base actualizado')
  }
  async function aplicarBase(c: { id: number; nombre: string }) {
    if (!confirmar(`¿Reemplazar los topes de ${c.nombre} por los topes base?`)) return
    const { error } = await sb.rpc('aplicar_topes_base', { p_ciudad: c.id })
    if (error) return toast(msgError(error), 'error')
    setVer(v => v + 1); await recargar(['topes']); toast(`${c.nombre} quedó con los topes base`)
  }
  function abrirNc(modo: 'base' | 'propio') {
    setModoNc(modo)
    if (modo === 'propio') setTNc(Object.fromEntries(conceptos.map(k => [k.id, k.tope_base != null ? miles(k.tope_base) : ''])))
  }
  async function agregarCiudad() {
    if (!nc.trim()) return setErr('Escribe el nombre de la ciudad.')
    const p_topes = modoNc === 'base' ? null : Object.fromEntries(conceptos.map(k => [k.id, num(tNc[k.id] || '') || null]))
    const { error } = await sb.rpc('crear_ciudad', { p_nombre: nc.trim(), p_topes })
    if (error) return setErr(msgError(error))
    setNc(''); setErr(''); setModoNc('base'); await recargar(['ciudades', 'topes'])
    toast(modoNc === 'base' ? 'Ciudad agregada con los topes base' : 'Ciudad agregada con sus topes')
  }
  async function agregarConcepto() {
    if (!nk.nombre.trim()) return setErr('Escribe el nombre del concepto.')
    const id = nk.nombre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { error } = await sb.from('conceptos').insert({ id, nombre: nk.nombre.trim(), unidad: nk.unidad, subtipos: nk.subtipos.split(',').map(s => s.trim()).filter(Boolean),
      requiere_descripcion: nk.desc, por_noche: nk.noche, orden: 50 })
    if (error) return setErr(msgError(error))
    setNk({ nombre: '', unidad: 'por gasto', subtipos: '', desc: false, noche: false }); setErr(''); await recargar(['conceptos']); toast('Concepto agregado a la lista del técnico')
  }
  async function toggle(tabla: 'conceptos' | 'ciudades', id: string | number, activo: boolean) {
    const { error } = await sb.from(tabla).update({ activo }).eq('id', id)
    if (error) return toast(msgError(error), 'error')
    await recargar([tabla])
  }

  const tecnicos = perfiles.filter(p => p.activo)
  const dias: [keyof typeof config, string][] = [['lim_lv', 'Lunes a viernes'], ['lim_sab', 'Sábado'], ['lim_dom', 'Domingo']]
  const ciuAct = ciudades.filter(c => c.activo)

  return <>
    <h3 className="t0">Horario de reporte</h3>
    <div className="hgrid">
      <div><h4>Hora límite por día</h4>
        {dias.map(([k, l]) => <label className="opt sp" key={k}><span>{l}</span>
          <input type="time" className="inp tm" defaultValue={String(config[k]).slice(0, 5)} onBlur={e => e.target.value && e.target.value !== String(config[k]).slice(0, 5) && guardarCfg({ [k]: e.target.value })} /></label>)}
        <p className="note">Los gastos de cada día se reportan antes de la hora de ese día. Hoy: <b>{fhora(limiteDe(hoy, config))}</b></p></div>
      <div><h4>Alertas al técnico antes del cierre</h4>
        <div className="cks">{[[180, '3 h'], [120, '2 h'], [60, '1 h'], [30, '30 min'], [15, '15 min']].map(([v, l]) =>
          <label key={v}><input type="checkbox" checked={config.avisos.includes(v as number)}
            onChange={e => guardarCfg({ avisos: e.target.checked ? [...config.avisos, v].sort((a, b) => (b as number) - (a as number)) : config.avisos.filter(x => x !== v) })} />{l}</label>)}</div>
        <p className="note">También se avisa cuando el plazo cierra.</p></div>
      <div><h4>Si reportan después del límite</h4>
        <label className="opt"><input type="radio" name="pol" checked={config.politica === 'marcar'} onChange={() => guardarCfg({ politica: 'marcar' })} /><span>Recibir y marcar como <b>extemporáneo</b></span></label>
        <label className="opt"><input type="radio" name="pol" checked={config.politica === 'bloquear'} onChange={() => guardarCfg({ politica: 'bloquear' })} /><span><b>Bloquear</b>; solo reporta si el administrador lo habilita</span></label></div>
      <div><h4>Habilitar reporte tardío hoy</h4>
        <div className="range"><select className="inp" value={hT} onChange={e => setHT(e.target.value)}>{tecnicos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
          <button className="btn" onClick={habilitar}>Habilitar</button></div>
        <p className="note">{habil.length ? 'Habilitados hoy: ' + habil.map(app.nombre).join(', ') : 'Nadie habilitado hoy.'}</p></div>
    </div>

    <h3>Topes de presupuesto</h3>
    <p className="note">Por concepto y ciudad. Vacío = sin tope (se revisa caso a caso). Se guarda al salir de cada casilla y aplica de inmediato a lo que está por revisar.
      La columna <b>Topes base</b> es la referencia que se copia a las ciudades nuevas; cambiarla no modifica las ciudades ya creadas (usa <i>Aplicar base</i> en una ciudad para copiarla).</p>
    <div className="scroll"><table className="mat"><thead><tr><th>Concepto</th><th>Unidad</th><th className="n base">Topes base</th>{ciuAct.map(c => <th key={c.id} className="n">{c.nombre}<div><button className="link" onClick={() => aplicarBase(c)}>Aplicar base</button></div></th>)}<th></th></tr></thead>
      <tbody>{conceptos.map(k => <tr key={k.id} className={k.activo ? '' : 'off'}>
        <td><b>{k.nombre}</b>{k.subtipos.length > 0 && <div className="note">{k.subtipos.join(', ')}</div>}{k.requiere_descripcion && <div className="note">El técnico describe el gasto</div>}</td>
        <td className="note">{k.unidad}</td>
        <td className="base"><input inputMode="numeric" defaultValue={k.tope_base != null ? miles(k.tope_base) : ''} placeholder="Sin tope" aria-label={`Tope base ${k.nombre}`}
          onBlur={e => { const n = num(e.target.value); e.target.value = n ? miles(n) : ''; if ((n || null) !== (k.tope_base ?? null)) guardarBase(k.id, e.target.value) }} /></td>
        {ciuAct.map(c => { const v = topes.find(t => t.concepto_id === k.id && t.ciudad_id === c.id)?.valor
          return <td key={c.id + '-' + ver}><input inputMode="numeric" defaultValue={v != null ? miles(v) : ''} placeholder="Sin tope" aria-label={`Tope ${k.nombre} ${c.nombre}`}
            onBlur={e => { const n = num(e.target.value); e.target.value = n ? miles(n) : ''; if ((n || null) !== (v ?? null)) guardarTope(k.id, c.id, e.target.value) }} /></td> })}
        <td><button className="btn sm" onClick={() => toggle('conceptos', k.id, !k.activo)}>{k.activo ? 'Ocultar' : 'Mostrar'}</button></td>
      </tr>)}</tbody></table></div>

    <div className="hgrid" style={{ marginTop: 16 }}>
      <div><h4>Agregar ciudad</h4><input className="inp" value={nc} onChange={e => setNc(e.target.value)} placeholder="Ej. Bucaramanga" />
        <label className="opt"><input type="radio" name="mnc" checked={modoNc === 'base'} onChange={() => abrirNc('base')} /><span>Usar los <b>topes base</b></span></label>
        <label className="opt"><input type="radio" name="mnc" checked={modoNc === 'propio'} onChange={() => abrirNc('propio')} /><span>Poner <b>topes diferentes</b> para esta ciudad</span></label>
        {modoNc === 'propio' && <div className="tnc">{conceptos.filter(k => k.activo).map(k => <label key={k.id} className="opt sp"><span>{k.nombre} <span className="note">{k.unidad}</span></span>
          <input className="inp tm" inputMode="numeric" value={tNc[k.id] || ''} placeholder="Sin tope"
            onChange={e => setTNc({ ...tNc, [k.id]: e.target.value })} onBlur={e => { const n = num(e.target.value); setTNc({ ...tNc, [k.id]: n ? miles(n) : '' }) }} /></label>)}
          <p className="note">Vienen llenos con los topes base; cambia solo los que sean distintos.</p></div>}
        <button className="btn pri" onClick={agregarCiudad}>Agregar ciudad</button>
        <p className="note">Ciudades ocultas: {ciudades.filter(c => !c.activo).map(c => <button key={c.id} className="link" onClick={() => toggle('ciudades', c.id, true)}>{c.nombre}</button>)}
          {!ciudades.some(c => !c.activo) && 'ninguna'}</p>
        <p className="note">Ocultar: {ciuAct.map(c => <button key={c.id} className="link" onClick={() => toggle('ciudades', c.id, false)}>{c.nombre}</button>)}</p></div>
      <div><h4>Agregar concepto</h4>
        <input className="inp" value={nk.nombre} onChange={e => setNk({ ...nk, nombre: e.target.value })} placeholder="Ej. Lavandería" />
        <div className="range" style={{ marginTop: 8 }}>
          <select className="inp" value={nk.unidad} onChange={e => setNk({ ...nk, unidad: e.target.value })}>{['por gasto', 'por comida', 'por noche', 'por trayecto', 'por compra', 'por día'].map(u => <option key={u}>{u}</option>)}</select>
          <input className="inp" value={nk.subtipos} onChange={e => setNk({ ...nk, subtipos: e.target.value })} placeholder="Tipos, separados por coma (opcional)" />
        </div>
        <label className="opt"><input type="checkbox" checked={nk.desc} onChange={e => setNk({ ...nk, desc: e.target.checked })} />El técnico debe describir el gasto</label>
        <label className="opt"><input type="checkbox" checked={nk.noche} onChange={e => setNk({ ...nk, noche: e.target.checked })} />El tope se multiplica por noches</label>
        <button className="btn pri" onClick={agregarConcepto}>Agregar concepto</button></div>
    </div>
    <p className="err">{err}</p>
  </>
}
