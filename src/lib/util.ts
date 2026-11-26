import type { Concepto, Config, Orden, Saldo, Tope } from './types'

export const TZ = 'America/Bogota'
const NF = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const fmt = (n?: number | null) => (n == null ? '—' : NF.format(n))
export const num = (v: unknown) => Number(String(v ?? '').replace(/\D/g, '')) || 0
export const miles = (n: number) => (n ? n.toLocaleString('es-CO') : '')
/** Orden en mayúsculas, sin espacios: "4120 cal mmcs" → "4120-CAL-MMCS" */
export const normOrden = (s: string) => s.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
/** Número inicial de la orden (único): "4120-CAL-MMCS" → "4120" */
export const numBase = (s: string) => (normOrden(s).match(/^\d+/) || [''])[0]
export const ORDEN_OK = /^[A-Z0-9][A-Z0-9-]{0,39}$/
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

export function descargarCSV(nombre: string, filas: (string | number | null)[][]) {
  const csv = filas.map(f => f.map(v => {
    const s = v == null ? '' : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(';')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** Texto del resultado de una legalización (positivo: el técnico reintegró; negativo: la empresa reembolsó) */
export const textoResultado = (r: number, pasado = true) =>
  r > 0 ? `${pasado ? 'Reintegró' : 'Reintegra'} ${fmt(r)}` : r < 0 ? `${pasado ? 'Reembolsado' : 'Reembolsar'} ${fmt(-r)}` : 'Cuadrado'

/** Retención esperada a partir de lo pagado (neto). Factura ≈ pagado / (1 − %). aplica=false si la factura es menor a la base */
export function retencionEsperada(k: { pide_retencion: boolean; retencion_pct: number | null; retencion_base: number | null }, pagado: number) {
  if (!k.pide_retencion || !pagado) return { aplica: false, factura: pagado, valor: 0 }
  const p = Number(k.retencion_pct || 0) / 100
  const factura = p ? Math.round(pagado / (1 - p)) : pagado
  if (k.retencion_base != null && factura < k.retencion_base) return { aplica: false, factura, valor: 0 }
  return { aplica: true, factura, valor: Math.round(factura * p) }
}
