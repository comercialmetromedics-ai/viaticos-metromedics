import { useEffect, useState } from 'react'
import { useApp } from './lib/store'
import { configurado, sb } from './lib/sb'
import Login, { NuevaClave } from './Login'
import TecApp from './tec/TecApp'
import AdminApp from './admin/AdminApp'
import EviTec from './evi/EviTec'
import EviAdmin from './evi/EviAdmin'
import type { Modulo } from './ui'

export default function App() {
  const { session, yo, cargando, recargar } = useApp()
  const [recuperar, setRecuperar] = useState(false)
  const [modo, setModo] = useState<'admin' | 'tec'>(() => (localStorage.getItem('modo') as 'admin' | 'tec') || 'admin')
  useEffect(() => {
    const { data } = sb.auth.onAuthStateChange(e => { if (e === 'PASSWORD_RECOVERY') setRecuperar(true) })
    return () => data.subscription.unsubscribe()
  }, [])
  const [modulo, setModulo] = useState<Modulo | null>(() => (sessionStorage.getItem('modulo') as Modulo) || null)
  const cambiarMod = (m: Modulo | null) => { try { if (m) sessionStorage.setItem('modulo', m); else sessionStorage.removeItem('modulo') } catch { /* sin almacenamiento */ } setModulo(m) }
  const cambiar = (m: 'admin' | 'tec') => { try { localStorage.setItem('modo', m) } catch { /* sin almacenamiento */ } setModo(m) }

  if (!configurado) return (
    <main className="login"><div className="card"><h1>Falta configurar</h1>
      <p>Crea el archivo <code>.env</code> con <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> (ver README).</p></div></main>
  )
  if (recuperar) return <NuevaClave onListo={() => setRecuperar(false)} />
  if (cargando) return <main className="login"><p className="hint">Cargando…</p></main>
  if (!session) return <Login />
  if (!yo || !yo.activo) return (
    <main className="login"><div className="card">
      <h1>Cuenta pendiente</h1>
      <p>Hola{yo ? ' ' + yo.nombre.split(' ')[0] : ''}. Tu cuenta fue creada, pero el administrador todavía debe activarla.</p>
      <p className="hint">Cuando te avise, toca “Ya me activaron”.</p>
      <button className="big" onClick={() => recargar()}>Ya me activaron</button>
      <div className="links"><button onClick={() => sb.auth.signOut()}>Salir</button></div>
    </div></main>
  )
  if (!modulo) return <Inicio nombre={yo.nombre} onElegir={cambiarMod} />
  const admin = yo.rol === 'admin' && modo === 'admin'
  const onAdmin = yo.rol === 'admin' ? () => cambiar('admin') : undefined
  if (modulo === 'evi') return admin ? <EviAdmin key="ea" onTec={() => cambiar('tec')} onModulo={cambiarMod} /> : <EviTec key="et" onAdmin={onAdmin} onModulo={cambiarMod} />
  if (admin) return <AdminApp key="va" onTec={() => cambiar('tec')} onModulo={cambiarMod} />
  return <TecApp key="vt" onAdmin={onAdmin} onModulo={cambiarMod} />
}

function Inicio({ nombre, onElegir }: { nombre: string; onElegir: (m: Modulo) => void }) {
  return <main className="inicio">
    <div className="ini-c">
      <img src="icon.svg" alt="" width={48} height={48} />
      <h1>Hola, {nombre.split(' ')[0]}</h1>
      <p className="hint ink">¿A qué módulo quieres entrar?</p>
      <button className="modcard" onClick={() => onElegir('via')}>
        <span className="ic">$</span><div><b>Viáticos</b><small>Reportar gastos por orden de servicio, ver saldos y novedades.</small></div><i>›</i>
      </button>
      <button className="modcard" onClick={() => onElegir('evi')}>
        <span className="ic">📷</span><div><b>Evidencias de calibración</b><small>Inventario del servicio y fotos del equipo y del sticker.</small></div><i>›</i>
      </button>
      <div className="links"><button onClick={() => sb.auth.signOut()}>Salir</button></div>
    </div>
  </main>
}
