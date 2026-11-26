import { useState, type FormEvent } from 'react'
import { msgError, sb } from './lib/sb'

export default function Login() {
  const [modo, setModo] = useState<'entrar' | 'registro' | 'olvido'>('entrar')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [nombre, setNombre] = useState('')
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault(); setMsg(null); setBusy(true)
    try {
      if (modo === 'entrar') {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass })
        if (error) throw error
      } else if (modo === 'registro') {
        if (nombre.trim().length < 3) throw new Error('Escribe tu nombre completo.')
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password: pass, options: { data: { nombre: nombre.trim() } } })
        if (error) throw error
        if (!data.session) setMsg({ ok: true, t: 'Cuenta creada. Revisa tu correo para confirmarla y luego entra. El administrador debe activarte.' })
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname })
        if (error) throw error
        setMsg({ ok: true, t: 'Te enviamos un correo para crear una nueva contraseña.' })
      }
    } catch (err) { setMsg({ t: msgError(err) }) } finally { setBusy(false) }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={enviar}>
        <img src="icon.svg" alt="" width={56} height={56} />
        <h1>Viáticos</h1>
        <p className="hint">Metromedics S.A.S · reporte de gastos de servicios en campo</p>
        {modo === 'registro' && <>
          <label className="f" htmlFor="l-n">Nombre completo</label>
          <input id="l-n" className="inp" value={nombre} onChange={e => setNombre(e.target.value)} autoComplete="name" required />
        </>}
        <label className="f" htmlFor="l-e">Correo</label>
        <input id="l-e" className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
        {modo !== 'olvido' && <>
          <label className="f" htmlFor="l-p">Contraseña</label>
          <input id="l-p" className="inp" type="password" value={pass} onChange={e => setPass(e.target.value)} minLength={6}
            autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} required />
        </>}
        {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.t}</p>}
        <button className="big" disabled={busy}>{busy ? 'Un momento…' : modo === 'entrar' ? 'Entrar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar correo'}</button>
        <div className="links">
          {modo !== 'entrar' && <button type="button" onClick={() => { setModo('entrar'); setMsg(null) }}>Ya tengo cuenta</button>}
          {modo !== 'registro' && <button type="button" onClick={() => { setModo('registro'); setMsg(null) }}>Crear cuenta</button>}
          {modo !== 'olvido' && <button type="button" onClick={() => { setModo('olvido'); setMsg(null) }}>Olvidé mi contraseña</button>}
        </div>
      </form>
    </main>
  )
}

/** Pantalla para fijar nueva contraseña al volver desde el correo de recuperación */
export function NuevaClave({ onListo }: { onListo: () => void }) {
  const [pass, setPass] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  return (
    <main className="login">
      <form className="card" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setErr('')
        const { error } = await sb.auth.updateUser({ password: pass })
        setBusy(false); if (error) setErr(msgError(error)); else onListo()
      }}>
        <h1>Nueva contraseña</h1>
        <label className="f" htmlFor="nc">Contraseña nueva</label>
        <input id="nc" className="inp" type="password" minLength={6} value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" required />
        {err && <p className="err">{err}</p>}
        <button className="big" disabled={busy}>Guardar</button>
      </form>
    </main>
  )
}
