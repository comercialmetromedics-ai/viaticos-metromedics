import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && key)

export const sb = createClient(url || 'https://sin-configurar.supabase.co', key || 'sin-configurar', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})

/** Mensaje legible de un error de Supabase */
export function msgError(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e)
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.'
  if (/Email not confirmed/i.test(m)) return 'Confirma tu correo antes de entrar (revisa tu bandeja).'
  if (/User already registered/i.test(m)) return 'Ese correo ya tiene una cuenta. Usa “Entrar”.'
  if (/Password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.'
  if (/duplicate key.*ordenes_pkey/i.test(m)) return 'Esa orden ya existe; búscala en la lista.'
  if (/ordenes_num_check/i.test(m)) return 'Número de orden no válido: usa letras, números y guiones (ej. 4120-CAL-MMCS).'
  if (/ordenes_numero_unico/i.test(m)) return 'Ya existe una orden con ese número; búscala en la lista.'
  if (/ciudades_nombre_key/i.test(m)) return 'Esa ciudad ya existe (puede estar oculta).'
  if (/rut_si_no_es_electronica/i.test(m)) return 'Adjunta el RUT del proveedor.'
  if (/row-level security/i.test(m)) return 'No tienes permiso para esta acción.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión. Revisa tu señal e inténtalo de nuevo.'
  return m
}
