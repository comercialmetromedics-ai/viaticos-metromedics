import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import { subirSoporte } from '../lib/img'
import type { Avance, Equipo, Inventario, Orden } from '../lib/types'
import { fdate, fhora } from '../lib/util'
import { Modulos, Soporte, Vacio } from '../ui'
import { buscarEquipos, CargarInventario, completo, Progreso, useEquipos, useInventarios } from './comun'

type P = 'lista' | 'orden' | 'cargar' | 'equipo' | 'nuevo'

function usePantalla() {
  const [p, setP] = useState<P>('lista')
  useEffect(() => {
    history.replaceState({ e: 'lista' }, '')
    const on = (e: PopStateEvent) => setP((e.state?.e as P) || 'lista')
    addEventListener('popstate', on); return () => removeEventListener('popstate', on)
  }, [])
  const ir = useCallback((n: P, reemplazar = false) => {
    if (reemplazar) history.replaceState({ e: n }, ''); else history.pushState({ e: n }, '')
    setP(n); document.querySelector('.scr')?.scrollTo(0, 0)
  }, [])
  return [p, ir] as const
}

export default function EviTec({ onAdmin, onModulo }: { onAdmin?: () => void; onModulo: (m: 'via' | 'evi') => void }) {
  const app = useApp()
  const { yo } = app
  const [p, ir] = usePantalla()
  const { invs, av, listo, cargar } = useInventarios()
  const [orden, setOrden] = useState<string | null>(null)
  const { eqs, cargar: cargarEq } = useEquipos(orden)
  const [eq, setEq] = useState<Equipo | null>(null)
  const [q, setQ] = useState('')
  const [nuevoTxt, setNuevoTxt] = useState('')

  const inv = invs.find(i => i.orden === orden)
  const o = orden ? app.orden(orden) : undefined
  const abrirOrden = (n: string) => { setOrden(n); setQ(''); ir('orden') }
  const abrirEquipo = (e: Equipo) => { setEq(e); ir('equipo') }
  const x: X = { app, invs, av, listo, orden, eqs, inv, o, q, setQ, ir, abrirOrden, abrirEquipo, setNuevoTxt }

  return (
    <div className="tec">
      <header className="pbar">
        <div><Modulos actual="evi" onCambio={onModulo} /><small>{yo!.nombre}</small></div>
        <div className="pbar-r">{onAdmin && <button className="btn sm" onClick={onAdmin}>Panel admin</button>}</div>
      </header>
      <div className="scr">
        {p === 'lista' && <Lista x={x} />}
        {p === 'orden' && orden && <VerOrden x={x} />}
        {p === 'cargar' && orden && <CargarInventario orden={orden} onCancelar={() => history.back()} onListo={() => { cargar(); cargarEq(); history.back() }} />}
        {p === 'equipo' && eq && <Evidencia key={eq.id} e={eq} encabezados={inv?.encabezados || []} onListo={() => { cargarEq(); cargar(); history.back() }} />}
        {p === 'nuevo' && orden && <NuevoEquipo orden={orden} texto={nuevoTxt} onListo={e => { cargarEq(); cargar(); setEq(e); ir('equipo', true) }} />}
      </div>
    </div>
  )
}

interface X {
  app: ReturnType<typeof useApp>; invs: Inventario[]; av: Avance[]; listo: boolean; orden: string | null; eqs: Equipo[] | null
  inv: Inventario | undefined; o: Orden | undefined; q: string; setQ: (s: string) => void; ir: (p: P, reemplazar?: boolean) => void
  abrirOrden: (n: string) => void; abrirEquipo: (e: Equipo) => void; setNuevoTxt: (s: string) => void
}

function Lista({ x }: { x: X }) {
const { app, invs, av, listo, abrirOrden } = x; const { ordenes } = app
  const [b, setB] = useState('')
  const k = b.trim().toUpperCase()
  const lista = ordenes.filter(x => !x.archivada && (!k || [x.num, x.cliente, app.ciudad(x.ciudad_id)].join(' ').toUpperCase().includes(k)))
    .sort((a, c) => Number(!!invs.find(i => i.orden === c.num)) - Number(!!invs.find(i => i.orden === a.num)) || c.created_at.localeCompare(a.created_at))
  return <>
    <h1>Evidencias de calibración</h1>
    <p className="hint ink">Elige el servicio. Por cada equipo calibrado carga la foto del equipo y la del sticker.</p>
    <input className="inp mt" value={b} onChange={e => setB(e.target.value)} placeholder="Buscar orden o cliente" aria-label="Buscar orden" />
    <div className="mt">{!listo ? <p className="hint">Cargando…</p> : !lista.length ? <Vacio>No hay órdenes. Crea la orden desde el módulo Viáticos o pide al administrador.</Vacio> :
      lista.slice(0, 60).map(x => { const a = av.find(v => v.orden === x.num)
        return <button key={x.num} className="row col" onClick={() => abrirOrden(x.num)}>
          <div className="rowline"><b>{x.num}</b><small>{app.ciudad(x.ciudad_id)}</small></div>
          <small>{x.cliente}</small>
          {a ? <Progreso n={a.con_evidencia} total={a.total} /> : <small className="mute">Sin inventario cargado</small>}
        </button> })}</div>
  </>
}

function VerOrden({ x }: { x: X }) {
const { app, av, listo, orden, eqs, inv, o, q, setQ, ir, setNuevoTxt } = x; const yo = app.yo
  const [filtro, setFiltro] = useState<'pend' | 'ok' | 'todos'>('pend')
  const [mas, setMas] = useState(60)
  const a = av.find(v => v.orden === orden)
  const puede = o && (o.responsable === yo!.id || yo!.rol === 'admin')
  const r = useMemo(() => buscarEquipos(eqs || [], q), [eqs, q])
  if (!inv) return <>
    <Cabecera x={x} />
    {!listo ? <p className="hint">Cargando…</p> : puede
      ? <div className="row dashed"><b>Esta orden aún no tiene inventario</b><small>Carga el Excel con los equipos que se van a calibrar.</small>
          <button className="big mt" onClick={() => ir('cargar')}>Cargar inventario (Excel)</button></div>
      : <Vacio>El inventario aún no se ha cargado. Lo carga {app.nombre(o?.responsable)} (responsable) o un administrador.</Vacio>}
  </>
  const lista = (eqs || []).filter(e => filtro === 'todos' || (filtro === 'ok' ? completo(e) : !completo(e)))
  return <>
    <Cabecera x={x} />
    {a && <Progreso n={a.con_evidencia} total={a.total} grande />}
    <label className="f" htmlFor="eq-q">Cargar evidencia · código interno o número de serie</label>
    <input id="eq-q" className="inp big-inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Ej. 2616, H00540 o 1600015968" autoComplete="off" autoCapitalize="characters" />
    {q.trim() ? <div className="mt">
      {r.exactos.map(e => <FilaEq key={e.id} x={x} e={e} />)}
      {!r.exactos.length && <div className="row dashed"><b>«{q.trim()}» no está en el inventario</b>
        <small>Revisa que esté bien escrito. Si el equipo no aparece en el Excel, agrégalo.</small>
        <button className="btn w" onClick={() => { setNuevoTxt(q.trim()); ir('nuevo') }}>Agregar como equipo nuevo</button></div>}
      {r.parciales.length > 0 && <><h3>Parecidos</h3>{r.parciales.map(e => <FilaEq key={e.id} x={x} e={e} />)}</>}
    </div> : <>
      <div className="chips fch mt">{([['pend', 'Pendientes'], ['ok', 'Con evidencia'], ['todos', 'Todos']] as const).map(([k, l]) =>
        <button key={k} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{l}</button>)}</div>
      {!eqs ? <p className="hint">Cargando…</p> : !lista.length ? <Vacio>{filtro === 'pend' ? '¡Todos los equipos tienen evidencia!' : 'Sin equipos.'}</Vacio>
        : lista.slice(0, mas).map(e => <FilaEq key={e.id} x={x} e={e} />)}
      {lista.length > mas && <button className="btn w" onClick={() => setMas(mas + 100)}>Mostrar más ({lista.length - mas})</button>}
    </>}
  </>
}

function Cabecera({ x }: { x: X }) {
const { app, orden, o, inv } = x
  return <div className="row col">
    <div className="rowline"><b>{orden}</b><small>{app.ciudad(o?.ciudad_id)}</small></div>
    <small>{o?.cliente}</small>
    {inv && <small>Inventario: {inv.nombre_archivo} · cargado por {app.nombre(inv.cargado_por)} el {fdate(inv.cargado_at)}</small>}
  </div>
}

function FilaEq({ x, e }: { x: X; e: Equipo }) {
const { app, abrirEquipo } = x
  const ok = completo(e)
  return <button className="row col eqrow" onClick={() => abrirEquipo(e)}>
    <div className="rowline"><b>{e.descripcion || 'Equipo'}</b><span className={'chip ' + (ok ? 'c-aprobado' : 'c-pendiente')}>{ok ? 'Con evidencia' : 'Pendiente'}</span></div>
    <small>{[e.codigos.length ? 'Cód. ' + e.codigos.join(' / ') : '', e.serie ? 'Serie ' + e.serie : ''].filter(Boolean).join(' · ') || 'Sin código ni serie'}
      {e.fila ? ` · fila ${e.fila}` : ' · agregado en campo'}</small>
    {ok && <small>{app.nombre(e.evidencia_por)} · {fdate(e.evidencia_at!)} {fhora(e.evidencia_at!)}</small>}
  </button>
}

function FotoSlot({ titulo, ayuda, actual, file, onFile }: { titulo: string; ayuda: string; actual: string | null; file: File | null; onFile: (f: File | null) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (!file) { setUrl(null); return } const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u) }, [file])
  return <div className="fslot">
    <b>{titulo}</b><small>{ayuda}</small>
    {url ? <div className="fprev"><img src={url} alt={titulo} /><button className="link" onClick={() => onFile(null)}>Quitar</button></div>
      : actual ? <div className="fprev"><Soporte path={actual} label="Actual" /></div> : null}
    <div className="fbtns">
      <label className="btn"><input type="file" accept="image/*" capture="environment" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />📷 Tomar foto</label>
      <label className="btn"><input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />Galería</label>
    </div>
  </div>
}

function Evidencia({ e, encabezados, onListo }: { e: Equipo; encabezados: string[]; onListo: () => void }) {
  const { yo, nombre, toast } = useApp()
  const [fe, setFe] = useState<File | null>(null)
  const [fs, setFs] = useState<File | null>(null)
  const [nota, setNota] = useState(e.nota || '')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const tiene = completo(e)
  async function guardar() {
    setErr('')
    if (!fe && !e.foto_equipo) return setErr('Falta la foto del equipo.')
    if (!fs && !e.foto_sticker) return setErr('Falta la foto del sticker de calibración.')
    if (!fe && !fs && nota === (e.nota || '')) return setErr('No hay cambios para guardar.')
    setBusy(true)
    try {
      const [p1, p2] = await Promise.all([fe ? subirSoporte(yo!.id, fe, 'evi') : e.foto_equipo, fs ? subirSoporte(yo!.id, fs, 'evi') : e.foto_sticker])
      const { error } = await sb.rpc('cargar_evidencia', { p_id: e.id, p_foto_equipo: p1, p_foto_sticker: p2, p_nota: nota })
      if (error) throw error
      toast('Evidencia guardada'); navigator.vibrate?.(60); onListo()
    } catch (x) { setErr(msgError(x)) } finally { setBusy(false) }
  }
  return <>
    <h2>{e.descripcion || 'Equipo'}</h2>
    <div className="row col">
      {e.codigos.length > 0 && <small>Código interno: <b className="ink">{e.codigos.join(' / ')}</b></small>}
      {e.serie && <small>Serie: <b className="ink">{e.serie}</b></small>}
      {e.fila ? <small>Fila {e.fila} del inventario</small> : <small className="warn">Agregado en campo por {nombre(e.agregado_por)}</small>}
      {e.datos.length > 0 && <details><summary className="hint">Ver datos del inventario</summary>
        <dl className="kv">{e.datos.map((v, i) => v && <div key={i}><dt>{encabezados[i] || `Columna ${i + 1}`}</dt><dd>{v}</dd></div>)}</dl></details>}
    </div>
    {tiene && <p className="hint ink">Ya tiene evidencia de {nombre(e.evidencia_por)} ({fdate(e.evidencia_at!)} {fhora(e.evidencia_at!)}). Si cargas fotos nuevas, reemplazan las actuales.</p>}
    <FotoSlot titulo="1. Foto del equipo" ayuda="Que se vea el equipo completo y, si se puede, su placa o serie." actual={e.foto_equipo} file={fe} onFile={setFe} />
    <FotoSlot titulo="2. Foto del sticker de calibración" ayuda="Cerca y legible: número de certificado y fecha." actual={e.foto_sticker} file={fs} onFile={setFs} />
    <label className="f" htmlFor="ev-n">Nota (opcional)</label>
    <input id="ev-n" className="inp" value={nota} onChange={x => setNota(x.target.value)} placeholder="Ej. sticker en la parte trasera" />
    <p className="err">{err}</p>
    <button className="big" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : tiene ? 'Reemplazar evidencia' : 'Guardar evidencia'}</button>
  </>
}

function NuevoEquipo({ orden, texto, onListo }: { orden: string; texto: string; onListo: (e: Equipo) => void }) {
  const esSerie = /[A-Z]/i.test(texto) && texto.length > 7
  const [cod, setCod] = useState(esSerie ? '' : texto)
  const [ser, setSer] = useState(esSerie ? texto : '')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function guardar() {
    setErr(''); setBusy(true)
    try {
      const { data, error } = await sb.rpc('agregar_equipo', { p_orden: orden, p_codigo: cod, p_serie: ser, p_descripcion: desc })
      if (error) throw error
      const { data: e } = await sb.from('equipos').select('*').eq('id', data).single()
      onListo(e as Equipo)
    } catch (x) { setErr(msgError(x)) } finally { setBusy(false) }
  }
  return <>
    <h2>Agregar equipo nuevo</h2>
    <p className="hint ink">Este equipo no está en el inventario de {orden}. Quedará marcado como <b>agregado en campo</b> y se añadirá al final del Excel.</p>
    <label className="f" htmlFor="n-c">Código interno (placa / activo fijo)</label>
    <input id="n-c" className="inp" value={cod} onChange={e => setCod(e.target.value)} autoCapitalize="characters" />
    <label className="f" htmlFor="n-s">Número de serie</label>
    <input id="n-s" className="inp" value={ser} onChange={e => setSer(e.target.value)} autoCapitalize="characters" />
    <label className="f" htmlFor="n-d">Equipo (nombre, marca y modelo)</label>
    <input id="n-d" className="inp" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ej. Báscula de piso · Health o meter · 160KG" />
    <p className="err">{err}</p>
    <button className="big" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Agregar y cargar evidencia'}</button>
  </>
}
