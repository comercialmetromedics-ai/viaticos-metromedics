import { useApp } from '../lib/store'
import { msgError, sb } from '../lib/sb'
import type { Perfil } from '../lib/types'
import { fdate } from '../lib/util'
import { Tag } from '../ui'

export default function Usuarios() {
  const { perfiles, yo, toast, recargar } = useApp()
  async function cambiar(p: Perfil, c: Partial<Perfil>) {
    if (p.id === yo?.id && (c.rol === 'tecnico' || c.activo === false)) return toast('No puedes quitarte a ti mismo el acceso de administrador.', 'error')
    const { error } = await sb.from('perfiles').update(c).eq('id', p.id)
    if (error) return toast(msgError(error), 'error')
    await recargar(['perfiles']); toast('Usuario actualizado')
  }
  const orden = [...perfiles].sort((a, b) => Number(a.activo) - Number(b.activo) || a.nombre.localeCompare(b.nombre))
  return <>
    <p className="note top">Cada técnico crea su cuenta desde la app con “Crear cuenta”. Aparece aquí como <b>pendiente</b>: actívalo para que pueda reportar. Desactivar a alguien le quita el acceso sin borrar su historial.</p>
    <table className="stack"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Registro</th></tr></thead>
      <tbody>{orden.map(p => <tr key={p.id}>
        <td><input className="inp sm" defaultValue={p.nombre} aria-label="Nombre" onBlur={e => e.target.value.trim() && e.target.value.trim() !== p.nombre && cambiar(p, { nombre: e.target.value.trim() })} /></td>
        <td>{p.email}</td>
        <td><select className="inp sm" value={p.rol} onChange={e => cambiar(p, { rol: e.target.value as Perfil['rol'] })}><option value="tecnico">Técnico</option><option value="admin">Administrador</option></select></td>
        <td>{p.activo ? <><Tag k="ok">Activo</Tag> <button className="btn sm" onClick={() => cambiar(p, { activo: false })}>Desactivar</button></>
          : <><Tag k="w">Pendiente</Tag> <button className="btn ok sm" onClick={() => cambiar(p, { activo: true })}>Activar</button></>}</td>
        <td>{fdate(p.created_at)}</td>
      </tr>)}</tbody></table>
  </>
}
