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
  const [modulo, setModulo] = useState<Modulo>(() => (localStorage.getItem('modulo') as Modulo) || 'via')
  const cambiarMod = (m: Modulo) => { try { localStorage.setItem('modulo', m) } catch { /* sin almacenamiento */ } setModulo(m) }
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
  const admin = yo.rol === 'admin' && modo === 'admin'
  const onAdmin = yo.rol === 'admin' ? () => cambiar('admin') : undefined
  if (modulo === 'evi') return admin ? <EviAdmin key="ea" onTec={() => cambiar('tec')} onModulo={cambiarMod} /> : <EviTec key="et" onAdmin={onAdmin} onModulo={cambiarMod} />
  if (admin) return <AdminApp key="va" onTec={() => cambiar('tec')} onModulo={cambiarMod} />
  return <TecApp key="vt" onAdmin={onAdmin} onModulo={cambiarMod} />
}
