import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import { subirSoporte } from '../lib/img'
import type { Consignacion, Reporte, Saldo, Traspaso } from '../lib/types'
import { codigo, disponible, normOrden, numBase, ORDEN_OK, durTxt, fdate, fhora, fmt, limiteDe, miles, neto, num, recibido, topeDe, ymd } from '../lib/util'
import { Archivo, Chip, Comparacion, Subir, Tag, Vacio } from '../ui'

type Pantalla = 'home' | 'orden' | 'nueva' | 'form' | 'ok' | 'mis' | 'nov' | 'noresp'
interface Borrador {
  orden: string; fecha: string; concepto: string; subtipo: string; descripcion: string; noches: string; monto: string
  fe: boolean | null; soporte: File | string | null; rut: File | string | null; obs: string; editId?: number; motivo?: string | null
}


interface X {
  app: ReturnType<typeof useApp>; uid: string; saldos: Saldo[]; reps: Reporte[]; habil: boolean; hoy: string; plazo: ReactNode
  cargar: () => Promise<void>; ir: (p: Pantalla, r?: boolean) => void; setUltimo: (r: Reporte) => void; setD: (d: Borrador) => void; q: string
}

/** Pantallas con historial del navegador, para que el botón “atrás” del celular funcione */
function usePantalla() {
  const [p, setP] = useState<Pantalla>('home')
  useEffect(() => {
    history.replaceState({ p: 'home' }, '')
    const on = (e: PopStateEvent) => setP((e.state?.p as Pantalla) || 'home')
    addEventListener('popstate', on); return () => removeEventListener('popstate', on)
  }, [])
  const ir = useCallback((n: Pantalla, reemplazar = false) => {
    if (reemplazar) history.replaceState({ p: n }, ''); else history.pushState({ p: n }, '')
    setP(n); document.querySelector('.scr')?.scrollTo(0, 0)
  }, [])
  return [p, ir] as const
}

export default function TecApp({ onAdmin }: { onAdmin?: () => void }) {
  const app = useApp()
  const { yo, config, ordenes, conceptos, topes, toast } = app
  const uid = yo!.id
  const [p, ir] = usePantalla()
  const [reps, setReps] = useState<Reporte[]>([])
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [cons, setCons] = useState<Consignacion[]>([])
  const [tras, setTras] = useState<Traspaso[]>([])
  const [habil, setHabil] = useState(false)
  const [q, setQ] = useState('')
  const [d, setD] = useState<Borrador | null>(null)
  const [ultimo, setUltimo] = useState<Reporte | null>(null)
  const [bloq, setBloq] = useState('')
  const [now, setNow] = useState(() => new Date())

  const cargar = useCallback(async () => {
    const [r, s, c, t, h] = await Promise.all([
      sb.from('reportes').select('*').eq('tecnico', uid).order('enviado_at', { ascending: false }).limit(300),
      sb.from('saldos').select('*').eq('tecnico', uid),
      sb.from('consignaciones').select('*').eq('tecnico', uid).order('fecha'),
      sb.from('traspasos').select('*').or(`de.eq.${uid},a.eq.${uid}`).order('fecha'),
      sb.from('habilitaciones').select('fecha').eq('tecnico', uid).eq('fecha', ymd())
    ])
    if (r.data) setReps(r.data); if (s.data) setSaldos(s.data); if (c.data) setCons(c.data); if (t.data) setTras(t.data)
    setHabil(!!h.data?.length)
  }, [uid])

  useEffect(() => {
    cargar()
    const ch = sb.channel('tec-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reportes', filter: `tecnico=eq.${uid}` }, ev => {
        const n = ev.new as Reporte
        if (ev.eventType === 'UPDATE' && n.estado === 'rechazado') toast(`${codigo(n.id)} fue devuelto: ${n.motivo}`, 'error')
        cargar()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consignaciones' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traspasos' }, () => cargar())
      .subscribe()
    const t = setInterval(() => setNow(new Date()), 30000)
    const vis = () => { if (document.visibilityState === 'visible') { setNow(new Date()); cargar() } }
    document.addEventListener('visibilitychange', vis)
    return () => { sb.removeChannel(ch); clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [uid, cargar, toast])

  // ---- plazo de reporte y alertas mientras la app está abierta ----
  const hoy = ymd(now)
  const limite = config ? limiteDe(hoy, config) : null
  const mins = limite ? (limite.getTime() - now.getTime()) / 60000 : 0
  const prevMins = useRef<number | null>(null)
  useEffect(() => {
    if (!config || !limite) return
    const prev = prevMins.current; prevMins.current = mins
    if (prev == null) return
    const notif = (t: string, b: string) => {
      toast(`${t}. ${b}`)
      if ('Notification' in window && Notification.permission === 'granted')
        navigator.serviceWorker?.ready.then(r => r.showNotification(t, { body: b, icon: 'icon-192.png', tag: 'plazo' })).catch(() => {})
      navigator.vibrate?.(200)
    }
    if (prev > 0 && mins <= 0) notif('Se cerró el reporte de hoy', config.politica === 'bloquear' ? 'Si te falta algo, pide habilitación.' : 'Lo que reportes ahora queda extemporáneo.')
    else if (config.avisos.some(a => prev > a && mins <= a && mins > 0)) notif(`Faltan ${durTxt(mins)} para el cierre`, `Reporta los gastos de hoy antes de las ${fhora(limite)}.`)
  }, [mins, config, limite, toast])

  const plazo = limite && (mins > 0
    ? <div className={'dl ' + (mins <= 60 ? 'warn' : 'ok')}><span className="clk">{durTxt(mins)}</span><p>Reporta los gastos de hoy antes de las <b>{fhora(limite)}</b></p></div>
    : <div className="dl bad"><span className="clk">Cerrado</span><p>El plazo de hoy cerró a las {fhora(limite)}.{' '}
      {config!.politica === 'bloquear' && !habil ? 'Para reportar, pide habilitación al administrador.' : habil ? 'Estás habilitado hoy; quedará como extemporáneo.' : 'Lo que reportes ahora queda como extemporáneo.'}</p></div>)

  const novedades = reps.filter(r => r.estado === 'rechazado')
  const misSaldos = saldos.filter(s => recibido(s) > 0 || s.es_responsable).sort((a, b) => b.orden.localeCompare(a.orden))

  function nuevoReporte(num: string) {
    const o = app.orden(num)
    if (o && o.responsable !== uid) { setBloq(num); ir('noresp'); return }
    setD({ orden: num, fecha: ymd(), concepto: '', subtipo: '', descripcion: '', noches: '1', monto: '', fe: null, soporte: null, rut: null, obs: '' })
    ir('form')
  }
  function corregir(r: Reporte) {
    setD({ orden: r.orden, fecha: r.fecha_gasto, concepto: r.concepto_id, subtipo: r.subtipo || '', descripcion: r.descripcion || '', noches: String(r.noches),
      monto: String(r.monto), fe: r.factura_electronica, soporte: r.soporte_path, rut: r.rut_path, obs: r.observaciones || '', editId: r.id, motivo: r.motivo })
    ir('form')
  }

  const x: X = { app, uid, saldos, reps, habil, hoy, plazo, cargar, ir, setUltimo, setD, q }

  const nav: [Pantalla, string][] = [['home', 'Inicio'], ['orden', 'Nuevo'], ['mis', 'Mis reportes'], ['nov', 'Novedades']]
  const cur = (['form', 'nueva', 'ok', 'noresp'] as Pantalla[]).includes(p) ? 'orden' : p

  return (
    <div className="tec">
      <header className="pbar">
        <div><b>Viáticos</b><small>{yo!.nombre}</small></div>
        <div className="pbar-r">
          {onAdmin && <button className="btn sm" onClick={onAdmin}>Panel admin</button>}
          <button className="bell" onClick={() => ir('nov')} aria-label={`Novedades: ${novedades.length}`}>⚑{novedades.length > 0 && <i>{novedades.length}</i>}</button>
        </div>
      </header>
      <div className="scr">
        {p === 'home' && Home()}
        {p === 'orden' && BuscarOrden()}
        {p === 'nueva' && <NuevaOrden x={x} />}
        {p === 'form' && d && <Formulario key={(d.editId || 0) + d.orden + d.fecha} x={x} d={d} />}
        {p === 'ok' && ultimo && Listo()}
        {p === 'mis' && <MisReportes x={x} />}
        {p === 'nov' && Novedades()}
        {p === 'noresp' && NoResponsable()}
      </div>
      <nav className="pnav">
        {nav.map(([s, l]) => (
          <button key={s} aria-current={cur === s} onClick={() => { if (s === 'orden') setQ(''); ir(s) }}>
            {l}{s === 'nov' && novedades.length > 0 && <em>{novedades.length}</em>}
          </button>
        ))}
      </nav>
    </div>
  )

  // ------------------------------------------------------------------ pantallas
  function Home() {
    const mes = hoy.slice(0, 7)
    const delMes = reps.filter(r => r.fecha_gasto.startsWith(mes))
    const recientes = [...new Set([...reps.map(r => r.orden), ...ordenes.filter(o => o.responsable === uid).map(o => o.num)])].slice(0, 5)
    const notifOff = 'Notification' in window && Notification.permission === 'default'
    return <>
      <h2>Hola, {yo!.nombre.split(' ')[0]}</h2>
      {plazo}
      <div style={{ height: 12 }} />
      <button className="big" onClick={() => { setQ(''); ir('orden') }}>+ Nuevo reporte de viáticos</button>
      {novedades.length > 0 && <button className="alertb" onClick={() => ir('nov')}>{novedades.length} {novedades.length > 1 ? 'reportes devueltos' : 'reporte devuelto'} para corregir →</button>}
      {notifOff && <button className="btn w" style={{ marginTop: 10 }} onClick={() => Notification.requestPermission().then(() => setNow(new Date()))}>Activar alertas del plazo</button>}
      {misSaldos.length > 0 && <h3>Mi saldo de viáticos</h3>}
      {misSaldos.map(s => {
        const o = app.orden(s.orden), disp = disponible(s), n = neto(s)
        const entregas = tras.filter(t => t.orden === s.orden && t.de === uid)
        return (
          <div className="bal" key={s.orden}>
            <div className="balh"><b>{s.orden}</b><span>{s.es_responsable ? <Tag k="ok">Responsable</Tag> : <Tag>Entregada</Tag>} {app.ciudad(o?.ciudad_id)}</span></div>
            <div className="meter"><i style={{ width: `${n > 0 ? Math.min(100, (s.reportado / n) * 100) : 0}%` }} /></div>
            <div className="bgrid">
              <div><small>Recibido</small><b>{fmt(recibido(s))}</b></div>
              <div><small>Gastado</small><b>{fmt(s.reportado)}</b></div>
              <div className={disp < 0 ? 'neg' : 'pos'}><small>Disponible</small><b>{fmt(disp)}</b></div>
            </div>
            <p className="hint">{[
              ...cons.filter(c => c.orden === s.orden).map(c => `Consignación ${fdate(c.fecha)} ${fmt(c.monto)}`),
              ...tras.filter(t => t.orden === s.orden && t.a === uid).map(t => `Recibido de ${app.nombre(t.de).split(' ')[0]} ${fdate(t.fecha)} ${fmt(t.monto)}`)
            ].join(' · ')}</p>
            {entregas.map(t => <p key={t.id} className="hint ink">Entregaste la responsabilidad a <b>{app.nombre(t.a)}</b> el {fdate(t.fecha)} con {fmt(t.monto)}. Las consignaciones nuevas ya no te corresponden.</p>)}
          </div>
        )
      })}
      {recientes.length > 0 && <h3>Órdenes recientes · toca para reportar</h3>}
      {recientes.map(n => { const o = app.orden(n); return o && (
        <button className="row" key={n} onClick={() => nuevoReporte(n)}>
          <span><b>{n}</b><small>{o.cliente} · {app.ciudad(o.ciudad_id)}</small></span><span className="r">+</span>
        </button>) })}
      <h3>Mis viáticos este mes</h3>
      <div className="stats">
        <div><b>{delMes.length}</b><small>reportes</small></div>
        <div><b>{fmt(delMes.reduce((a, r) => a + (r.aprobado || 0), 0))}</b><small>aprobado</small></div>
        <div><b>{delMes.filter(r => r.estado === 'pendiente').length}</b><small>por revisar</small></div>
      </div>
    </>
  }

  function BuscarOrden() {
    const Q = normOrden(q), N = numBase(q)
    const lista = ordenes.filter(o => !Q || o.num.includes(Q) || (N && numBase(o.num) === N) || o.cliente.toUpperCase().includes(q.trim().toUpperCase())).slice(0, 8)
    const existe = ordenes.some(o => o.num === Q || (N && numBase(o.num) === N))
    return <>
      <h2>¿A qué orden de servicio?</h2>
      <label className="f" htmlFor="oq">Número de orden o cliente</label>
      <input id="oq" className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Ej. 4120 o 4120-CAL-MMCS" autoComplete="off" autoCapitalize="characters" autoFocus />
      <div style={{ marginTop: 12 }}>
        {lista.map(o => (
          <button className="row" key={o.num} onClick={() => nuevoReporte(o.num)}>
            <span><b>{o.num}</b><small>{o.cliente} · {app.ciudad(o.ciudad_id)}</small><small>Responsable: {o.responsable === uid ? 'tú' : app.nombre(o.responsable)}</small></span>
            <span className="r">Elegir</span>
          </button>
        ))}
        {Q && !existe && (
          <div className="row dashed">
            <b>La orden {Q} no existe todavía</b>
            <small>Créala una vez y quedará disponible para los demás técnicos.</small>
            <button className="btn pri w" onClick={() => ir('nueva')}>Crear orden</button>
          </div>
        )}
        {!Q && !lista.length && <Vacio>Aún no hay órdenes. Escribe el número para crearla.</Vacio>}
      </div>
    </>
  }



  function Listo() {
    const r = ultimo!, o = app.orden(r.orden), c = app.concepto(r.concepto_id)
    const s = saldos.find(x => x.orden === r.orden)
    return <>
      <div className="done"><div className="tick">✓</div><h2>{r.reenvios ? 'Reporte reenviado' : 'Reporte enviado'}</h2>
        <p className="hint">{codigo(r.id)} · {c?.nombre} · {fmt(r.monto)} · {r.orden}</p>
        {r.extemporaneo && !r.reenvios && <p><Tag k="w">Extemporáneo</Tag> enviado fuera del plazo</p>}</div>
      <Comparacion monto={r.monto} tope={topeDe(r.concepto_id, o, r.noches, conceptos, topes)} concepto={c?.nombre} ciudad={app.ciudad(o?.ciudad_id)} />
      {s && recibido(s) > 0 && <div className="sal">Te quedan <b>{fmt(disponible(s))}</b> de {fmt(recibido(s))} recibidos para {r.orden}.</div>}
      <div className="stack-btn">
        <button className="big" onClick={() => nuevoReporte(r.orden)}>+ Otro gasto en {r.orden}</button>
        <button className="btn w" onClick={() => ir('home')}>Ir al inicio</button>
      </div>
    </>
  }


  function Novedades() {
    return <>
      <h2>Novedades</h2>
      {!novedades.length && <Vacio>No tienes reportes devueltos.</Vacio>}
      {novedades.map(r => (
        <div className="row col" key={r.id}>
          <div className="rowline"><b>{app.concepto(r.concepto_id)?.nombre} · {fmt(r.monto)}</b><Chip estado={r.estado} /></div>
          <small>{r.orden} · {app.orden(r.orden)?.cliente} · {fdate(r.fecha_gasto)}</small>
          <div className="banner" style={{ margin: '8px 0' }}>{r.motivo}</div>
          <button className="btn pri w" onClick={() => corregir(r)}>Corregir y reenviar</button>
        </div>
      ))}
    </>
  }

  function NoResponsable() {
    const o = app.orden(bloq)!
    return <>
      <h2>No eres el responsable de esta orden</h2>
      <div className="ochip"><span><b>{o.num}</b><br />{o.cliente}</span><span>{app.ciudad(o.ciudad_id)}</span></div>
      <p>Los gastos de <b>{o.num}</b> los reporta <b>{app.nombre(o.responsable)}</b>, que recibe las consignaciones y entrega los comprobantes.</p>
      <p className="hint">Si queda a tu cargo, el administrador cambia el responsable y te traspasa el saldo.</p>
      <button className="btn w" onClick={() => { setQ(''); ir('orden', true) }}>Elegir otra orden</button>
    </>
  }
}

function NuevaOrden({ x }: { x: X }) {
  const { app, uid, ir, setD, q } = x
  const { toast, ordenes } = app
  const [numO, setNum] = useState(normOrden(q))
  const [cli, setCli] = useState(''); const [ciu, setCiu] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function crear() {
    const n = normOrden(numO)
    if (!ORDEN_OK.test(n)) return setErr('Escribe el número de la orden con letras, números y guiones (ej. 4120-CAL-MMCS).')
    const dup = numBase(n) ? ordenes.find(o => numBase(o.num) === numBase(n)) : undefined
    if (dup) return setErr(`Ya existe la orden ${dup.num}; búscala en la lista.`)
    if (cli.trim().length < 2) return setErr('Escribe la razón social del cliente.')
    if (!ciu) return setErr('Selecciona la ciudad.')
    setBusy(true)
    const { error } = await sb.from('ordenes').insert({ num: n, cliente: cli.trim(), ciudad_id: Number(ciu), creada_por: uid, responsable: uid })
    setBusy(false)
    if (error) return setErr(msgError(error))
    await app.recargar(['ordenes']); toast(`Orden ${n} creada`)
    setD({ orden: n, fecha: ymd(), concepto: '', subtipo: '', descripcion: '', noches: '1', monto: '', fe: null, soporte: null, rut: null, obs: '' })
    ir('form', true)
  }
  return <>
    <h2>Crear orden de servicio</h2>
    <p className="hint">Se crea una sola vez y la ven todos. Quien la crea queda como responsable de reportar sus gastos.</p>
    <label className="f" htmlFor="no-n">Número de orden</label>
    <input id="no-n" className="inp" value={numO} onChange={e => setNum(e.target.value.toUpperCase())} placeholder="Ej. 4120-CAL-MMCS" autoCapitalize="characters" />
  <p className="hint">Escríbela completa como aparece en la orden de servicio (ej. 4120-CAL-MMCS o 4120-MTO-MMCS). El número no se puede repetir.</p>
    <label className="f" htmlFor="no-c">Razón social del cliente</label>
    <input id="no-c" className="inp" value={cli} onChange={e => setCli(e.target.value)} placeholder="Ej. Hospital San Rafael E.S.E." />
    <label className="f" htmlFor="no-ci">Ciudad</label>
    <select id="no-ci" className="inp" value={ciu} onChange={e => setCiu(e.target.value)}>
      <option value="">Selecciona…</option>
      {app.ciudades.filter(c => c.activo).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
    <p className="err">{err}</p>
    <button className="big" onClick={crear} disabled={busy}>{busy ? 'Creando…' : 'Crear y continuar'}</button>
  </>
}

function MisReportes({ x }: { x: X }) {
  const { app, reps } = x
  const [ver, setVer] = useState<number | null>(null)
  return <>
    <h2>Mis reportes</h2>
    {!reps.length && <Vacio>Aún no tienes reportes.</Vacio>}
    {reps.map(r => (
      <button className="row col" key={r.id} onClick={() => setVer(ver === r.id ? null : r.id)}>
        <div className="rowline">
          <span><b>{app.concepto(r.concepto_id)?.nombre}</b>{r.subtipo || r.descripcion ? ' · ' + (r.subtipo || r.descripcion) : ''}
            <small>{r.orden} · {fdate(r.fecha_gasto)} {r.extemporaneo && <Tag k="w">Extemporáneo</Tag>}</small>
            {r.estado === 'parcial' && <small>Aprobado {fmt(r.aprobado)} de {fmt(r.monto)}</small>}</span>
          <span className="r"><b>{fmt(r.monto)}</b><br /><Chip estado={r.estado} /></span>
        </div>
        {ver === r.id && <small className="det">{codigo(r.id)} · enviado {fdate(r.enviado_at)} {fhora(r.enviado_at)}{r.reenvios ? ` · reenviado ${r.reenvios} vez` : ''}{r.motivo ? ` · Motivo: ${r.motivo}` : ''}</small>}
      </button>
    ))}
  </>
}

function Formulario({ x, d }: { x: X, d: Borrador }) {
  const { app, uid, saldos, reps, habil, hoy, plazo, cargar, ir, setUltimo } = x
  const { config, conceptos, topes } = app
  const [f, setF] = useState<Borrador>(d!)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('')
  const o = app.orden(f.orden)!
  const c = conceptos.find(x => x.id === f.concepto)
  const monto = num(f.monto), noches = Math.max(1, num(f.noches))
  const tope = c ? topeDe(c.id, o, noches, conceptos, topes) : null
  const base = c && o ? topes.find(t => t.concepto_id === c.id && t.ciudad_id === o.ciudad_id)?.valor : null
  const s = saldos.find(x => x.orden === f.orden)
  const editando = f.editId ? reps.find(r => r.id === f.editId) : undefined
  const disp = s ? disponible(s) + (editando ? editando.monto : 0) : 0
  const set = (k: keyof Borrador, v: unknown) => setF(x => ({ ...x, [k]: v }))
  const tarde = config ? new Date() > limiteDe(f.fecha, config) : false

  async function enviar() {
    setErr('')
    const e = !f.fecha ? 'Indica la fecha del gasto.' : !c ? 'Selecciona el concepto.' : c.subtipos.length && !f.subtipo ? 'Selecciona el tipo.' :
      c.requiere_descripcion && !f.descripcion.trim() ? 'Describe el gasto.' : !monto ? 'Escribe el monto.' :
      f.fe === null ? 'Indica si el soporte es factura electrónica.' : !f.soporte ? 'Adjunta la foto o archivo del soporte.' :
      !f.fe && !f.rut ? 'Adjunta el RUT del proveedor (el soporte no es electrónico).' : ''
    if (e) return setErr(e)
    if (tarde && !f.editId && config!.politica === 'bloquear' && !habil)
      return setErr(`El plazo para los gastos del ${fdate(f.fecha)} cerró a las ${fhora(limiteDe(f.fecha, config!))}; pide al administrador que te habilite.`)
    try {
      setBusy('Subiendo soporte…')
      const sop = typeof f.soporte === 'string' ? f.soporte : await subirSoporte(uid, f.soporte!)
      const rut = f.fe ? null : typeof f.rut === 'string' ? f.rut : await subirSoporte(uid, f.rut!)
      setBusy('Enviando…')
      const campos = { fecha_gasto: f.fecha, concepto_id: c!.id, subtipo: c!.subtipos.length ? f.subtipo : null,
        descripcion: c!.requiere_descripcion ? f.descripcion.trim() : null, noches: c!.por_noche ? noches : 1, monto,
        factura_electronica: f.fe!, soporte_path: sop, rut_path: rut, observaciones: f.obs.trim() || null }
      let r: Reporte
      if (f.editId) {
        const { error } = await sb.rpc('reenviar_reporte', { p_id: f.editId, p_fecha: campos.fecha_gasto, p_concepto: campos.concepto_id,
          p_subtipo: campos.subtipo, p_descripcion: campos.descripcion, p_noches: campos.noches, p_monto: monto, p_fe: campos.factura_electronica,
          p_soporte: sop, p_rut: rut, p_obs: campos.observaciones })
        if (error) throw error
        r = { ...editando!, ...campos, estado: 'pendiente', reenvios: (editando?.reenvios || 0) + 1 }
      } else {
        const { data, error } = await sb.from('reportes').insert({ orden: f.orden, ...campos }).select().single()
        if (error) throw error
        r = data
      }
      setUltimo(r); await cargar(); ir('ok', true)
    } catch (x) { setErr(msgError(x)) } finally { setBusy('') }
  }

  return <>
    {f.motivo && <div className="banner"><b>Devuelto por el administrador</b>{f.motivo}</div>}
    <div className="ochip"><span><b>{o.num}</b><br />{o.cliente}</span><span>{app.ciudad(o.ciudad_id)}</span></div>
    {plazo}
    <label className="f" htmlFor="f-g">Fecha del gasto</label>
    <input id="f-g" type="date" className="inp" max={hoy} value={f.fecha} onChange={e => set('fecha', e.target.value)} />
    {tarde && <p className="hint warn">Gasto fuera del plazo de reporte: quedará como extemporáneo.</p>}
    <label className="f" htmlFor="f-c">Concepto</label>
    <select id="f-c" className="inp" value={f.concepto} onChange={e => setF(x => ({ ...x, concepto: e.target.value, subtipo: '', descripcion: '' }))}>
      <option value="">Selecciona el concepto…</option>
      {conceptos.filter(k => k.activo || k.id === f.concepto).map(k => <option key={k.id} value={k.id}>{k.nombre}</option>)}
    </select>
    {c && c.subtipos.length > 0 && <>
      <label className="f" htmlFor="f-s">Tipo</label>
      <select id="f-s" className="inp" value={f.subtipo} onChange={e => set('subtipo', e.target.value)}>
        <option value="">Selecciona…</option>{c.subtipos.map(x => <option key={x}>{x}</option>)}
      </select>
    </>}
    {c?.requiere_descripcion && <>
      <label className="f" htmlFor="f-d">{c.id === 'repuestos' ? '¿Qué se compró?' : '¿Cuál es el gasto?'}</label>
      <input id="f-d" className="inp" value={f.descripcion} onChange={e => set('descripcion', e.target.value)} placeholder="Describe el gasto" />
    </>}
    {c?.por_noche && <>
      <label className="f" htmlFor="f-n">Número de noches</label>
      <input id="f-n" className="inp" type="number" min={1} inputMode="numeric" value={f.noches} onChange={e => set('noches', e.target.value)} />
    </>}
    <label className="f" htmlFor="f-m">Monto pagado</label>
    <div className="money"><span>$</span><input id="f-m" inputMode="numeric" value={miles(monto)} onChange={e => set('monto', e.target.value)} placeholder="0" /></div>
    <Comparacion monto={monto} tope={tope} concepto={c?.nombre} ciudad={app.ciudad(o.ciudad_id)}
      detalle={c?.por_noche && noches > 1 && base != null ? ` (${noches} noches × ${fmt(base)})` : ''} />
    {s && recibido(s) > 0
      ? <div className="sal">Saldo de viáticos en {f.orden}: <b>{fmt(disp)}</b>{monto > 0 && <> · después de este gasto: <b style={{ color: disp - monto < 0 ? 'var(--bad)' : 'var(--ok)' }}>{fmt(disp - monto)}</b></>}
        {monto > 0 && disp - monto < 0 && <><br /><span className="hint">Superas lo entregado; la diferencia se te reconoce al legalizar si se aprueba.</span></>}</div>
      : <div className="sal">No tienes viáticos entregados para {f.orden}. Si se aprueba, este gasto queda <b>a tu favor</b> como reembolso.</div>}
    <label className="f">¿El soporte es factura electrónica?</label>
    <div className="tog">
      <button type="button" aria-pressed={f.fe === true} onClick={() => setF(x => ({ ...x, fe: true }))}>Sí, electrónica</button>
      <button type="button" aria-pressed={f.fe === false} onClick={() => setF(x => ({ ...x, fe: false }))}>No (recibo u otro)</button>
    </div>
    {f.fe !== null && <>
      <label className="f">{f.fe ? 'Factura electrónica (foto o PDF)' : 'Comprobante (foto del recibo o factura)'}</label>
      {f.soporte ? <Archivo file={f.soporte} onClear={() => set('soporte', null)} /> : <Subir label="Tomar foto o subir archivo" onFile={x => set('soporte', x)} />}
      {f.fe ? <p className="hint">Con factura electrónica no se pide RUT.</p> : <>
        <label className="f">RUT del proveedor</label>
        {f.rut ? <Archivo file={f.rut} onClear={() => set('rut', null)} /> : <Subir label="Tomar foto o subir el RUT" onFile={x => set('rut', x)} />}
        <p className="hint">Obligatorio cuando el soporte no es factura electrónica.</p>
      </>}
    </>}
    <label className="f" htmlFor="f-o">Observaciones (opcional)</label>
    <textarea id="f-o" className="inp" rows={2} value={f.obs} onChange={e => set('obs', e.target.value)} />
    <p className="err">{err}</p>
    <button className="big" onClick={enviar} disabled={!!busy}>{busy || (f.editId ? 'Reenviar a revisión' : 'Enviar reporte')}</button>
  </>
}
