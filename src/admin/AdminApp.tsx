import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { sb } from '../lib/sb'
import Revisar from './Revisar'
import { Aprobados, Rechazados } from './Listas'
import Viaticos from './Viaticos'
import Indicadores from './Indicadores'
import Ajustes from './Ajustes'
import Usuarios from './Usuarios'
import Legalizaciones from './Legalizaciones'
import Ordenes from './Ordenes'
import Estados from './Estados'

const TABS = [
  ['rev', 'Por revisar'], ['apr', 'Aprobados'], ['rec', 'Rechazados'], ['via', 'Viáticos entregados'], ['leg', 'Legalizaciones'],
  ['est', 'Estados de cuenta'], ['ind', 'Indicadores'], ['ord', 'Órdenes'], ['aju', 'Ajustes'], ['usu', 'Usuarios']
] as const
type Tab = typeof TABS[number][0]

export default function AdminApp({ onTec }: { onTec: () => void }) {
  const { yo, perfiles } = useApp()
  const [tab, setTab] = useState<Tab>(() => { const h = location.hash.slice(1); return (TABS.some(t => t[0] === h) ? h : 'rev') as Tab })
  const [n, setN] = useState({ pen: 0, rec: 0 })
  const [tick, setTick] = useState(0)

  const contar = useCallback(async () => {
    const [a, b] = await Promise.all([
      sb.from('reportes').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
      sb.from('reportes').select('id', { count: 'exact', head: true }).eq('estado', 'rechazado')
    ])
    setN({ pen: a.count || 0, rec: b.count || 0 })
  }, [])

  useEffect(() => {
    contar()
    const ch = sb.channel('admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reportes' }, () => { contar(); setTick(t => t + 1) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consignaciones' }, () => setTick(t => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traspasos' }, () => setTick(t => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'legalizaciones' }, () => setTick(t => t + 1))
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [contar])

  useEffect(() => { history.replaceState(null, '', '#' + tab) }, [tab])
  const pendientesUsuarios = perfiles.filter(p => !p.activo).length

  return (
    <div className="admin">
      <header className="abar noprint">
        <div className="brand"><img src="icon.svg" alt="" width={32} height={32} /><div><b>Viáticos · Administración</b><small>{yo?.nombre}</small></div></div>
        <div className="abar-r">
          <button className="btn sm" onClick={onTec}>Vista técnico</button>
          <button className="btn sm" onClick={() => sb.auth.signOut()}>Salir</button>
        </div>
      </header>
      <nav className="tabs noprint">
        {TABS.map(([k, l]) => {
          const c = k === 'rev' ? n.pen : k === 'rec' ? n.rec : k === 'usu' ? pendientesUsuarios : null
          return <button key={k} aria-current={tab === k} className={(k === 'rev' || k === 'usu') && c ? 'hot' : ''} onClick={() => setTab(k)}>
            {l}{c != null && c > 0 && <em>{c}</em>}</button>
        })}
      </nav>
      <main className="apane">
        {tab === 'rev' && <Revisar tick={tick} onCambio={contar} />}
        {tab === 'apr' && <Aprobados tick={tick} />}
        {tab === 'rec' && <Rechazados tick={tick} />}
        {tab === 'via' && <Viaticos tick={tick} />}
        {tab === 'leg' && <Legalizaciones tick={tick} />}
        {tab === 'est' && <Estados tick={tick} />}
        {tab === 'ord' && <Ordenes tick={tick} />}
        {tab === 'ind' && <Indicadores tick={tick} />}
        {tab === 'aju' && <Ajustes />}
        {tab === 'usu' && <Usuarios />}
      </main>
    </div>
  )
}
