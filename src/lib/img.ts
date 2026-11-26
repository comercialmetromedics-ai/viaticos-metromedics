import { sb } from './sb'

/** Reduce una foto a máx. 1600 px y JPEG 0,75 (una factura queda en ~200–400 KB) */
async function comprimir(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const b = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.75))
    return b && b.size < file.size ? b : file
  } catch { return file }
}

export const MAX_MB = 8

/** Sube un soporte a la carpeta del usuario y devuelve la ruta guardada */
export async function subirSoporte(uid: string, file: File): Promise<string> {
  if (file.size > MAX_MB * 1024 * 1024 && !file.type.startsWith('image/')) throw new Error(`El archivo supera ${MAX_MB} MB.`)
  const blob = await comprimir(file)
  const esPdf = file.type === 'application/pdf'
  const ext = esPdf ? 'pdf' : blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${uid}/${crypto.randomUUID()}.${ext}`
  const { error } = await sb.storage.from('soportes').upload(path, blob, { contentType: esPdf ? 'application/pdf' : blob.type || file.type, upsert: false })
  if (error) throw error
  return path
}

const cache = new Map<string, { url: string; t: number }>()
export async function urlFirmada(path: string): Promise<string | null> {
  const c = cache.get(path)
  if (c && Date.now() - c.t < 50 * 60 * 1000) return c.url
  const { data } = await sb.storage.from('soportes').createSignedUrl(path, 3600)
  if (data?.signedUrl) cache.set(path, { url: data.signedUrl, t: Date.now() })
  return data?.signedUrl ?? null
}
export const esPdf = (p: string) => p.toLowerCase().endsWith('.pdf')
