import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import { descargarArchivo, subirSoporte, urlFirmada } from '../lib/img'
import type { Avance, Equipo, Inventario, Servicio } from '../lib/types'
import { fdate, fhora, normOrden, numBase, ORDEN_OK, ymd } from '../lib/util'
import type { HojaInfo, Libro, Mapeo } from './xlsx'

/** Carga perezosa del módulo de Excel (solo cuando se usa) */
const xl = () => import('./xlsx')

export const completo = (e: Equipo) => !!(e.foto_equipo && e.foto_sticker)
const up = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '')

/** Busca equipos por código interno o serie (exactos primero, luego parciales) */
export function buscarEquipos(eqs: Equipo[], q: string) {
  const k = up(q)
  if (!k) return { exactos: [] as Equipo[], parciales: [] as Equipo[] }
  const ids = (e: Equipo) => [...e.codigos, e.codigo || '', e.serie || ''].filter(Boolean).map(up)
  const exactos = eqs.filter(e => ids(e).includes(k))
  const parciales = eqs.filter(e => !exactos.includes(e) && (ids(e).some(x => x.includes(k)) || up(e.descripcion || '').includes(k))).slice(0, 40)
  return { exactos, parciales }
}

export function useInventarios(tick = 0) {
  const [invs, setInvs] = useState<Inventario[]>([])
  const [av, setAv] = useState<Avance[]>([])
  const [servs, setServs] = useState<Servicio[]>([])
  const [listo, setListo] = useState(false)
  const cargar = useCallback(async () => {
    const [i, a, s] = await Promise.all([sb.from('inventarios').select('*'), sb.from('avance_inventarios').select('*'),
      sb.from('servicios').select('*').order('created_at', { ascending: false })])
    if (i.data) setInvs(i.data); if (a.data) setAv(a.data); if (s.data) setServs(s.data); setListo(true)
  }, [])
  useEffect(() => { cargar() }, [cargar, tick])
  useEffect(() => {
    const ch = sb.channel('evi-inv').on('postgres_changes', { event: '*', schema: 'public', table: 'equipos' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios' }, () => cargar()).subscribe()
    return () => { sb.removeChannel(ch) }
  }, [cargar])
  return { invs, av, servs, listo, cargar }
}

export function useEquipos(orden: string | null) {
  const [eqs, setEqs] = useState<Equipo[] | null>(null)
  const cargar = useCallback(async () => {
    if (!orden) return
    const todos: Equipo[] = []
    for (let i = 0; ; i += 1000) {
      const { data } = await sb.from('equipos').select('*').eq('orden', orden).order('fila', { nullsFirst: false }).order('id').range(i, i + 999)
      todos.push(...(data || [])); if (!data || data.length < 1000) break
    }
    setEqs(todos)
  }, [orden])
  useEffect(() => { setEqs(null); cargar() }, [cargar])
  useEffect(() => {
    if (!orden) return
    const ch = sb.channel('evi-eq-' + orden).on('postgres_changes', { event: '*', schema: 'public', table: 'equipos', filter: `orden=eq.${orden}` }, () => cargar()).subscribe()
    return () => { sb.removeChannel(ch) }
  }, [orden, cargar])
  return { eqs, cargar }
}

export function Progreso({ n, total, grande }: { n: number; total: number; grande?: boolean }) {
  const pct = total ? Math.round((n / total) * 100) : 0
  return <div className={'prog' + (grande ? ' g' : '')}>
    <div className="bar"><i style={{ width: pct + '%' }} /></div>
    <span><b>{n}</b> de {total} con evidencia · {pct}%</span>
  </div>
}

// ------------------------------------------------------------------ carga del inventario
export function CargarInventario({ orden, onListo, onCancelar }: { orden: string; onListo: () => void; onCancelar: () => void }) {
  const { yo, toast } = useApp()
  const [file, setFile] = useState<File | null>(null)
  const [lib, setLib] = useState<Libro | null>(null)
  const [hoja, setHoja] = useState<HojaInfo | null>(null)
  const [filas, setFilas] = useState<string[][]>([])
  const [m, setM] = useState<Mapeo | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  async function abrir(f: File) {
    setErr(''); setBusy('Leyendo el Excel…')
    try {
      if (!/\.xlsx$/i.test(f.name)) throw new Error('El archivo debe ser Excel .xlsx (si es .xls, ábrelo en Excel y guárdalo como .xlsx).')
      const X = await xl(); const l = await X.abrirLibro(f)
      if (!l.hojas.length) throw new Error('El Excel no tiene hojas.')
      setFile(f); setLib(l); await elegirHoja(l, l.hojas[0])
    } catch (e) { setErr(msgError(e)); setFile(null) } finally { setBusy('') }
  }
  async function elegirHoja(l: Libro, h: HojaInfo) {
    const X = await xl(); const fs = await X.leerHoja(l, h)
    setHoja(h); setFilas(fs); setM(X.detectar(fs))
  }
  const enc = m ? (filas[m.fila - 1] || []) : []
  const [ultima, equipos] = useMemo(() => {
    if (!m) return [0, []]
    let n = 0; for (const f of filas.slice(m.fila - 1)) { let k = f.length; while (k > 0 && !f[k - 1]) k--; n = Math.max(n, k) }
    const out: { fila: number; codigo: string; codigos: string[]; serie: string; descripcion: string; datos: string[] }[] = []
    const vacio = /^(|N\.?\s*R\.?|N\/?A|NO\s*REGISTRA|SIN\s*(SERIE|PLACA|CODIGO)|-+|0)$/i
    const limpio = (s?: string) => (s && !vacio.test(s.trim()) ? s.trim() : '')
    for (let r = m.fila; r < filas.length; r++) {
      const f = filas[r] || []; const datos = Array.from({ length: Math.max(n, 1) }, (_, i) => f[i] || '')
      if (!datos.some(Boolean)) continue
      const codigos = m.codigos.map(c => limpio(f[c - 1])).filter(Boolean)
      out.push({ fila: r + 1, codigo: codigos[0] || '', codigos, serie: m.serie ? limpio(f[m.serie - 1]) : '', descripcion: m.desc.map(c => f[c - 1]).filter(Boolean).join(' · '), datos })
    }
    return [Math.max(n, 1), out] as const
  }, [m, filas])
  const sinId = equipos.filter(e => !e.codigos.length && !e.serie).length

  async function guardar() {
    if (!file || !hoja || !m) return
    if (!m.codigos.length && !m.serie) return setErr('Elige al menos la columna de código interno o la de serie.')
    if (!equipos.length) return setErr('No se encontraron equipos debajo de la fila de encabezados.')
    setErr(''); setBusy('Subiendo inventario…')
    try {
      const path = await subirSoporte(yo!.id, file, 'inv')
      const { data, error } = await sb.rpc('cargar_inventario', {
        p_orden: orden, p_archivo: path, p_nombre: file.name, p_hoja: hoja.nombre, p_fila: m.fila,
        p_col_codigos: m.codigos, p_col_serie: m.serie, p_col_desc: m.desc, p_ultima: ultima,
        p_encabezados: Array.from({ length: ultima }, (_, i) => enc[i] || `Columna ${i + 1}`), p_equipos: equipos
      })
      if (error) throw error
      toast(`Inventario cargado: ${data} equipos`); onListo()
    } catch (e) { setErr(msgError(e)) } finally { setBusy('') }
  }

  const colOpts = Array.from({ length: ultima || enc.length }, (_, i) => <option key={i} value={i + 1}>{enc[i] || `Columna ${i + 1}`}</option>)
  const toggle = (arr: number[], c: number) => (arr.includes(c) ? arr.filter(x => x !== c) : [...arr, c].sort((a, b) => a - b))

  return <div className="cinv">
    <h2>Cargar inventario · {orden}</h2>
    {!file && <>
      <p className="hint ink">Sube el Excel (.xlsx) con todos los equipos del servicio. Se carga una sola vez y todos los técnicos de la orden lo verán.</p>
      <label className="up big-up"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={e => { const f = e.target.files?.[0]; if (f) abrir(f); e.target.value = '' }} />Elegir archivo de Excel</label>
    </>}
    {busy && <p className="hint">{busy}</p>}
    {file && m && lib && hoja && <>
      <p className="hint">Archivo: <b className="ink">{file.name}</b> · <button className="link" onClick={() => { setFile(null); setLib(null); setM(null) }}>Cambiar</button></p>
      <div className="grid2">
        {lib.hojas.length > 1 && <div><label className="f">Hoja</label>
          <select className="inp" value={hoja.nombre} onChange={e => elegirHoja(lib, lib.hojas.find(h => h.nombre === e.target.value)!)}>
            {lib.hojas.map(h => <option key={h.nombre}>{h.nombre}</option>)}</select></div>}
        <div><label className="f">Fila de encabezados</label>
          <input className="inp" type="number" min={1} value={m.fila} onChange={e => { const f = Math.max(1, +e.target.value || 1); import('./xlsx').then(X => setM({ fila: f, ...X.columnasDe(filas[f - 1] || []) })) }} /></div>
        <div><label className="f">Número de serie</label>
          <select className="inp" value={m.serie ?? ''} onChange={e => setM({ ...m, serie: e.target.value ? +e.target.value : null })}>
            <option value="">— Ninguna —</option>{colOpts}</select></div>
      </div>
      <label className="f">Código interno (puedes marcar varias: placa, activo fijo…)</label>
      <div className="chk">{enc.slice(0, ultima).map((h, i) => <label key={i}><input type="checkbox" checked={m.codigos.includes(i + 1)} onChange={() => setM({ ...m, codigos: toggle(m.codigos, i + 1) })} />{h || `Columna ${i + 1}`}</label>)}</div>
      <label className="f">Descripción que verá el técnico</label>
      <div className="chk">{enc.slice(0, ultima).map((h, i) => <label key={i}><input type="checkbox" checked={m.desc.includes(i + 1)} onChange={() => setM({ ...m, desc: toggle(m.desc, i + 1) })} />{h || `Columna ${i + 1}`}</label>)}</div>
      <label className="f">Vista previa</label>
      <div className="tblw"><table className="tbl prev"><thead><tr><th>Fila</th>{enc.slice(0, ultima).map((h, i) =>
        <th key={i} className={m.serie === i + 1 ? 'kser' : m.codigos.includes(i + 1) ? 'kcod' : m.desc.includes(i + 1) ? 'kdes' : ''}>{h || '—'}</th>)}</tr></thead>
        <tbody>{equipos.slice(0, 6).map(e => <tr key={e.fila}><td>{e.fila}</td>{e.datos.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody></table></div>
      <p className="hint"><span className="kcod">■</span> código · <span className="kser">■</span> serie · <span className="kdes">■</span> descripción</p>
      <div className="cmp ok"><p><b>{equipos.length} equipos</b> encontrados desde la fila {m.fila + 1}.{sinId > 0 && <> <b className="warn">{sinId} sin código ni serie</b>: se podrán buscar por descripción.</>}</p></div>
      <p className="err">{err}</p>
      <button className="big" disabled={!!busy} onClick={guardar}>{busy || `Cargar ${equipos.length} equipos`}</button>
    </>}
    {!file && err && <p className="err">{err}</p>}
    <button className="btn w mt" onClick={onCancelar}>Cancelar</button>
  </div>
}

// ------------------------------------------------------------------ generación del avance técnico
async function miniatura(blob: Blob) {
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const b = await new Promise<Blob>(r => c.toBlob(x => r(x!), 'image/jpeg', 0.72))
  return { bytes: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height }
}
async function foto(path: string | null) {
  if (!path) return undefined
  try { const u = await urlFirmada(path); if (!u) return undefined; return await miniatura(await (await fetch(u)).blob()) } catch { return undefined }
}

export async function generarExcelAvance(inv: Inventario, eqs: Equipo[], nombre: (id?: string | null) => string, cliente: string, onProg?: (t: string) => void) {
  const X = await xl()
  onProg?.('Descargando inventario original…')
  const original = await descargarArchivo(inv.archivo_path)
  const items: import('./xlsx').ItemAvance[] = []
  const conFoto = eqs.filter(e => e.foto_equipo || e.foto_sticker)
  let hechas = 0
  const fotos = new Map<number, [Awaited<ReturnType<typeof foto>>, Awaited<ReturnType<typeof foto>>]>()
  for (let i = 0; i < conFoto.length; i += 6) {
    await Promise.all(conFoto.slice(i, i + 6).map(async e => { fotos.set(e.id, [await foto(e.foto_equipo), await foto(e.foto_sticker)]); hechas++ }))
    onProg?.(`Preparando fotos ${hechas} de ${conFoto.length}…`)
  }
  for (const e of eqs) {
    const f = fotos.get(e.id)
    const reg = [
      e.evidencia_at ? `${nombre(e.evidencia_por)} · ${fdate(e.evidencia_at)} ${fhora(e.evidencia_at)}` : 'Sin evidencia',
      e.nota ? `Nota: ${e.nota}` : '',
      e.fila == null ? `Agregado en campo por ${nombre(e.agregado_por)}` : ''
    ].filter(Boolean).join(' · ')
    items.push({ fila: e.fila, equipo: f?.[0], sticker: f?.[1], registro: reg,
      nuevo: e.fila == null ? { codigo: e.codigo || '', serie: e.serie || '', descripcion: e.descripcion || '' } : undefined })
  }
  onProg?.('Armando el Excel…')
  const blob = await X.generarAvance(original, inv, items)
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  a.download = `Avance tecnico ${limpio(inv.orden)} ${limpio(cliente)} ${ymd()}.xlsx`
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

// ------------------------------------------------------------------ servicio nuevo
export function NuevoServicio({ servs, inicial = '', onListo, onCancelar }: { servs: Servicio[]; inicial?: string; onListo: (num: string) => void; onCancelar?: () => void }) {
  const app = useApp()
  const [num, setNum] = useState(normOrden(inicial))
  const [cli, setCli] = useState(''); const [ciu, setCiu] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function crear() {
    const n = normOrden(num)
    if (!ORDEN_OK.test(n)) return setErr('Escribe el número del servicio con letras, números y guiones (ej. 4120-CAL-MMCS).')
    const dup = servs.find(s => s.num === n || (numBase(n) && numBase(s.num) === numBase(n)))
    if (dup) return setErr(`Ya existe el servicio ${dup.num}; búscalo en la lista.`)
    if (cli.trim().length < 2) return setErr('Escribe la razón social del cliente.')
    if (!ciu) return setErr('Selecciona la ciudad.')
    setBusy(true)
    const { error } = await sb.rpc('crear_servicio', { p_num: n, p_cliente: cli.trim(), p_ciudad: Number(ciu) })
    setBusy(false)
    if (error) return setErr(msgError(error))
    app.toast(`Servicio ${n} creado`); onListo(n)
  }
  return <div className="narrow">
    <h2>Nuevo servicio</h2>
    <p className="hint">Quien crea el servicio carga el inventario (Excel). Es independiente de las órdenes de viáticos.</p>
    <label className="f" htmlFor="ns-n">Número de orden de servicio</label>
    <input id="ns-n" className="inp" value={num} onChange={e => setNum(e.target.value.toUpperCase())} placeholder="Ej. 4120-CAL-MMCS" autoCapitalize="characters" />
    <label className="f" htmlFor="ns-c">Razón social del cliente</label>
    <input id="ns-c" className="inp" value={cli} onChange={e => setCli(e.target.value)} placeholder="Ej. Fundación Neumológica Colombiana" />
    <label className="f" htmlFor="ns-ci">Ciudad</label>
    <select id="ns-ci" className="inp" value={ciu} onChange={e => setCiu(e.target.value)}>
      <option value="">Selecciona…</option>
      {app.ciudades.filter(c => c.activo).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
    <p className="err">{err}</p>
    <button className="big" onClick={crear} disabled={busy}>{busy ? 'Creando…' : 'Crear servicio'}</button>
    {onCancelar && <button className="btn w mt" onClick={onCancelar}>Cancelar</button>}
  </div>
}
