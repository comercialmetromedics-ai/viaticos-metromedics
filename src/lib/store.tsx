import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb } from './sb'
import type { Ciudad, Concepto, Config, Orden, Perfil, Tope } from './types'

interface Cat {
  perfiles: Perfil[]; ciudades: Ciudad[]; conceptos: Concepto[]; topes: Tope[]; config: Config | null; ordenes: Orden[]
}
interface Ctx extends Cat {
  session: Session | null; yo: Perfil | null; cargando: boolean
  recargar: (que?: (keyof Cat)[]) => Promise<void>
  toast: (t: string, tipo?: 'ok' | 'error') => void
  nombre: (id?: string | null) => string
  orden: (num: string) => Orden | undefined
  ciudad: (id?: number) => string
  concepto: (id: string) => Concepto | undefined
}
const C = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(C)

const vacio: Cat = { perfiles: [], ciudades: [], conceptos: [], topes: [], config: null, ordenes: [] }

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [listo, setListo] = useState(false)
  const [cat, setCat] = useState<Cat>(vacio)
  const [cargando, setCargando] = useState(true)
  const [toastMsg, setToast] = useState<{ t: string; tipo: string; k: number } | null>(null)
  const timer = useRef<number>()

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setListo(true) })
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const recargar = useCallback(async (que?: (keyof Cat)[]) => {
    const q = new Set(que || (Object.keys(vacio) as (keyof Cat)[]))
    const next: Partial<Cat> = {}
    await Promise.all([
      q.has('perfiles') && sb.from('perfiles').select('*').order('nombre').then(r => { if (r.data) next.perfiles = r.data }),
      q.has('ciudades') && sb.from('ciudades').select('*').order('orden').order('nombre').then(r => { if (r.data) next.ciudades = r.data }),
      q.has('conceptos') && sb.from('conceptos').select('*').order('orden').then(r => { if (r.data) next.conceptos = r.data }),
      q.has('topes') && sb.from('topes').select('*').then(r => { if (r.data) next.topes = r.data }),
      q.has('config') && sb.from('config').select('*').eq('id', 1).maybeSingle().then(r => { next.config = r.data }),
      q.has('ordenes') && sb.from('ordenes').select('*').order('created_at', { ascending: false }).then(r => { if (r.data) next.ordenes = r.data })
    ])
    setCat(c => ({ ...c, ...next }))
  }, [])

  useEffect(() => {
    if (!listo) return
    if (!session) { setCat(vacio); setCargando(false); return }
    setCargando(true)
    recargar().finally(() => setCargando(false))
    const ch = sb.channel('catalogo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes' }, () => recargar(['ordenes']))
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [listo, session?.user.id, recargar])

  const toast = useCallback((t: string, tipo: 'ok' | 'error' = 'ok') => {
    setToast({ t, tipo, k: Date.now() }); clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), tipo === 'error' ? 5000 : 3000)
  }, [])

  const value = useMemo<Ctx>(() => {
    const yo = cat.perfiles.find(p => p.id === session?.user.id) || null
    return {
      ...cat, session, yo, cargando: !listo || cargando, recargar, toast,
      nombre: id => cat.perfiles.find(p => p.id === id)?.nombre || '—',
      orden: n => cat.ordenes.find(o => o.num === n),
      ciudad: id => cat.ciudades.find(c => c.id === id)?.nombre || '—',
      concepto: id => cat.conceptos.find(c => c.id === id)
    }
  }, [cat, session, listo, cargando, recargar, toast])

  return (
    <C.Provider value={value}>
      {children}
      {toastMsg && <div key={toastMsg.k} className={'toast on ' + toastMsg.tipo} role="status">{toastMsg.t}</div>}
    </C.Provider>
  )
}
