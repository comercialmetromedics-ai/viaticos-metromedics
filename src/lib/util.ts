import type { Concepto, Config, Orden, Saldo, Tope } from './types'

export const TZ = 'America/Bogota'
const NF = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const fmt = (n?: number | null) => (n == null ? '—' : NF.format(n))
export const num = (v: unknown) => Number(String(v ?? '').replace(/\D/g, '')) || 0
export const miles = (n: number) => (n ? n.toLocaleString('es-CO') : '')
export const codigo = (id: number) => 'V-' + String(id).padStart(4, '0')

/** Fecha YYYY-MM-DD en Colombia */
export const ymd = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const asDate = (s: string) => new Date(s.length === 10 ? s + 'T12:00:00-05:00' : s)
export const fdate = (s: string) => asDate(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: TZ })
export const flarga = (s: string) => asDate(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })
export const fhora = (s: string | Date) => new Date(s).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
export const durTxt = (m: number) => {
  m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60
  return h ? `${h} h${r ? ' ' + r + ' min' : ''}` : `${r} min`
}
export const sumaDias = (ds: string, n: number) => { const d = asDate(ds); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }

/** Momento límite para reportar los gastos de una fecha */
export function limiteDe(ds: string, cfg: Config) {
  const w = asDate(ds).getUTCDay()
  const t = (w === 6 ? cfg.lim_sab : w === 0 ? cfg.lim_dom : cfg.lim_lv).slice(0, 5)
  return new Date(`${ds}T${t}:00-05:00`)
}

export function topeDe(conceptoId: string, orden: Orden | undefined, noches: number, conceptos: Concepto[], topes: Tope[]) {
  if (!orden) return null
  const t = topes.find(x => x.concepto_id === conceptoId && x.ciudad_id === orden.ciudad_id)?.valor
  if (t == null) return null
  const c = conceptos.find(x => x.id === conceptoId)
  return c?.por_noche ? t * Math.max(1, noches || 1) : t
}

export const neto = (s: Saldo) => s.consignado + s.traspaso_recibido - s.traspaso_entregado
export const disponible = (s: Saldo) => neto(s) - s.reportado
export const recibido = (s: Saldo) => s.consignado + s.traspaso_recibido

export const ESTADOS: Record<string, string> = { pendiente: 'Por revisar', aprobado: 'Aprobado', parcial: 'Aprobado hasta tope', rechazado: 'Rechazado' }
