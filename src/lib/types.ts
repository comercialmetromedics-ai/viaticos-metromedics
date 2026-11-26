export type Rol = 'tecnico' | 'admin'
export interface Perfil { id: string; nombre: string; email: string | null; rol: Rol; activo: boolean; created_at: string }
export interface Ciudad { id: number; nombre: string; orden: number; activo: boolean }
export interface Concepto {
  id: string; nombre: string; unidad: string; subtipos: string[]
  requiere_descripcion: boolean; por_noche: boolean; activo: boolean; orden: number
}
export interface Tope { concepto_id: string; ciudad_id: number; valor: number | null }
export interface Config { id: number; lim_lv: string; lim_sab: string; lim_dom: string; avisos: number[]; politica: 'marcar' | 'bloquear'; zona: string }
export interface Orden { num: string; cliente: string; ciudad_id: number; creada_por: string | null; responsable: string; created_at: string }
export type Estado = 'pendiente' | 'aprobado' | 'parcial' | 'rechazado'
export interface Reporte {
  id: number; orden: string; tecnico: string; fecha_gasto: string; enviado_at: string
  concepto_id: string; subtipo: string | null; descripcion: string | null; noches: number; monto: number
  factura_electronica: boolean; soporte_path: string; rut_path: string | null; observaciones: string | null
  estado: Estado; aprobado: number | null; motivo: string | null; reenvios: number; extemporaneo: boolean
  revisado_por: string | null; revisado_at: string | null
}
export interface Consignacion { id: number; orden: string; tecnico: string; fecha: string; monto: number; medio: string; nota: string | null; created_at: string }
export interface Traspaso { id: number; orden: string; de: string; a: string; fecha: string; monto: number; nota: string | null; created_at: string }
export interface Saldo {
  orden: string; tecnico: string; consignado: number; traspaso_recibido: number; traspaso_entregado: number
  reportado: number; aprobado: number; por_revisar: number; rechazado: number; es_responsable: boolean
}
export interface Historial { id: number; reporte_id: number; at: string; texto: string }
