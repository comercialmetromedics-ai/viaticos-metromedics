import { useEffect, useState } from 'react'
import { useApp } from './lib/store'
import { configurado, sb } from './lib/sb'
import Login, { NuevaClave } from './Login'
import TecApp from './tec/TecApp'
import AdminApp from './admin/AdminApp'

export default function App() {
  const { session, yo, cargando, recargar } = useApp()
  const [recuperar, setRecuperar] = useState(false)
  const [modo, setModo] = useState<'admin' | 'tec'>(() => (localStorage.getItem('modo') as 'admin' | 'tec') || 'admin')
  useEffect(() => {
    const { data } = sb.auth.onAuthStateChange(e => { if (e === 'PASSWORD_RECOVERY') setRecuperar(true) })
    return () => data.subscription.unsubscribe()
  }, [])
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
  if (yo.rol === 'admin' && modo === 'admin') return <AdminApp onTec={() => cambiar('tec')} />
  return <TecApp onAdmin={yo.rol === 'admin' ? () => cambiar('admin') : undefined} />
}
