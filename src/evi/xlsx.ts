/**
 * Lectura y escritura de inventarios .xlsx a nivel de XML (JSZip + DOMParser).
 * Se modifica el archivo original sin reconstruirlo: se conservan tablas, filtros,
 * fórmulas, gráficos y formatos. Solo se agregan columnas de evidencia, imágenes y
 * (si hay) filas de equipos agregados en campo.
 */
import JSZip from 'jszip'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const T_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
const T_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const T_TABLE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table'

const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
const ser = (d: Document) => new XMLSerializer().serializeToString(d)
const kids = (el: Element | Document, local: string) =>
  Array.from((el as Element).childNodes || []).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === local)
const kid = (el: Element | Document, local: string) => kids(el, local)[0] as Element | undefined

export const colLetra = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
export const colNum = (s: string) => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0)
const refPartes = (r: string) => { const m = /^([A-Z]+)(\d+)$/.exec(r)!; return { c: colNum(m[1]), r: +m[2] } }

function resolver(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/'); parts.pop()
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p) }
  return parts.join('/')
}
const relsDe = (path: string) => { const p = path.split('/'); const f = p.pop(); return [...p, '_rels', f + '.rels'].join('/') }

export interface HojaInfo { nombre: string; path: string }
export interface Libro { zip: JSZip; hojas: HojaInfo[]; compartidas: string[] }

export async function abrirLibro(data: ArrayBuffer | Blob): Promise<Libro> {
  const zip = await JSZip.loadAsync(data)
  const wb = zip.file('xl/workbook.xml')
  if (!wb) throw new Error('El archivo no es un Excel .xlsx válido.')
  const wbx = parse(await wb.async('string'))
  const rels = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const rmap = new Map(Array.from(rels.getElementsByTagNameNS(NS_REL, 'Relationship')).map(r => [r.getAttribute('Id')!, r.getAttribute('Target')!]))
  const hojas = Array.from(wbx.getElementsByTagNameNS(NS, 'sheet')).map(s => ({
    nombre: s.getAttribute('name')!, path: resolver('xl/workbook.xml', rmap.get(s.getAttributeNS(NS_R, 'id')!)!)
  })).filter(h => zip.file(h.path))
  const compartidas: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) for (const si of Array.from(parse(await ss.async('string')).getElementsByTagNameNS(NS, 'si')))
    compartidas.push(Array.from(si.getElementsByTagNameNS(NS, 't')).filter(t => (t.parentNode as Element).localName !== 'rPh').map(t => t.textContent || '').join(''))
  return { zip, hojas, compartidas }
}

const numTxt = (v: string) => { const n = Number(v); return Number.isFinite(n) ? String(Math.round(n * 1e9) / 1e9) : v }

/** Devuelve las filas como texto (índice 0 = fila 1 de Excel) */
export async function leerHoja(lib: Libro, hoja: HojaInfo, maxFilas = 20000): Promise<string[][]> {
  const doc = parse(await lib.zip.file(hoja.path)!.async('string'))
  const filas: string[][] = []
  for (const row of Array.from(doc.getElementsByTagNameNS(NS, 'row'))) {
    const rn = +(row.getAttribute('r') || filas.length + 1)
    if (rn > maxFilas) break
    const vals: string[] = []
    let i = 0
    for (const c of kids(row, 'c')) {
      const ref = c.getAttribute('r'); const col = ref ? refPartes(ref).c : ++i; i = col
      const t = c.getAttribute('t'); const v = kid(c, 'v')?.textContent ?? ''
      let txt = ''
      if (t === 's') txt = lib.compartidas[+v] ?? ''
      else if (t === 'inlineStr') txt = Array.from(c.getElementsByTagNameNS(NS, 't')).map(x => x.textContent || '').join('')
      else if (t === 'b') txt = v === '1' ? 'VERDADERO' : 'FALSO'
      else if (t === 'str' || t === 'e') txt = v
      else txt = v === '' ? '' : numTxt(v)
      vals[col - 1] = txt.trim()
    }
    filas[rn - 1] = Array.from(vals, x => x ?? '')
  }
  return Array.from(filas, x => x ?? [])
}

// ------------------------------------------------------------- detección de columnas
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const RX_SERIE = /\b(SERIE|SERIAL|S\/N|SN|N[°º.]?\s*(DE\s*)?SERIE|NO\.?\s*SERIE)\b/
const RX_COD = /(CODIGO|COD\.?|PLACA|ACTIVO|INVENTARIO|INTERNO|\bID\b|IDENTIFICACION)/
const RX_DESC = /(EQUIPO|DESCRIPCION|NOMBRE|INSTRUMENTO|MARCA|MODELO|TIPO)/

export interface Mapeo { fila: number; codigos: number[]; serie: number | null; desc: number[] }

export function detectar(filas: string[][]): Mapeo {
  let mejor = { fila: 1, pts: -1 }
  filas.slice(0, 40).forEach((f, i) => {
    const hs = f.map(norm).filter(Boolean)
    const pts = hs.filter(h => RX_SERIE.test(h) || RX_COD.test(h) || RX_DESC.test(h)).length * 3 + hs.length * 0.1
    if (pts > mejor.pts) mejor = { fila: i + 1, pts }
  })
  return { fila: mejor.fila, ...columnasDe(filas[mejor.fila - 1] || []) }
}
export function columnasDe(enc: string[]) {
  const h = enc.map(norm)
  const serie = h.findIndex(x => RX_SERIE.test(x))
  const codigos = h.map((x, i) => (i !== serie && RX_COD.test(x) && !RX_SERIE.test(x) ? i + 1 : 0)).filter(Boolean)
  const desc = h.map((x, i) => (RX_DESC.test(x) && !RX_COD.test(x) ? i + 1 : 0)).filter(Boolean).slice(0, 3)
  return { serie: serie >= 0 ? serie + 1 : null, codigos, desc }
}

export const VACIO = /^(|N\.?\s*R\.?|N\/?A|NO\s*REGISTRA|SIN\s*(SERIE|PLACA|CODIGO)|-+|0)$/i
const limpio = (s: string | undefined) => (s && !VACIO.test(s.trim()) ? s.trim() : '')

export interface FilaEquipo { fila: number; codigo: string; codigos: string[]; serie: string; descripcion: string; datos: string[] }

export function extraerEquipos(filas: string[][], m: Mapeo, ultima: number): FilaEquipo[] {
  const out: FilaEquipo[] = []
  for (let r = m.fila; r < filas.length; r++) {
    const f = filas[r] || []
    const datos = Array.from({ length: ultima }, (_, i) => f[i] || '')
    if (!datos.some(Boolean)) continue
    const codigos = m.codigos.map(c => limpio(f[c - 1])).filter(Boolean)
    const serie = m.serie ? limpio(f[m.serie - 1]) : ''
    out.push({ fila: r + 1, codigo: codigos[0] || '', codigos, serie, descripcion: m.desc.map(c => f[c - 1]).filter(Boolean).join(' · '), datos })
  }
  return out
}
export const ultimaColumna = (filas: string[][], filaEnc: number) =>
  Math.max(1, ...filas.slice(filaEnc - 1).map(f => { let n = f.length; while (n > 0 && !f[n - 1]) n--; return n }))

// ------------------------------------------------------------- generación del avance
export interface Foto { bytes: Uint8Array; w: number; h: number }
export interface ItemAvance { fila: number | null; equipo?: Foto; sticker?: Foto; registro: string; nuevo?: { codigo: string; serie: string; descripcion: string } }
export interface Plantilla { hoja: string; fila_encabezado: number; ultima_col: number; col_codigos: number[]; col_serie: number | null; col_desc: number[] }

const TITULOS = ['Evidencia equipo', 'Evidencia sticker', 'Registro evidencia']
const PX = 9525                 // EMU por pixel
const ALTO_FILA = 96            // puntos (≈128 px)
const ANCHO_COL = 20            // caracteres (≈145 px)
const LADO = 118                // px máximos de la miniatura

export async function generarAvance(original: ArrayBuffer | Blob, p: Plantilla, items: ItemAvance[]): Promise<Blob> {
  const lib = await abrirLibro(original)
  const { zip } = lib
  const hoja = lib.hojas.find(h => h.nombre === p.hoja) || lib.hojas[0]
  const doc = parse(await zip.file(hoja.path)!.async('string'))
  const ws = doc.documentElement
  const sheetData = kid(ws, 'sheetData')!
  const c1 = p.ultima_col + 1
  const filasEl = new Map(kids(sheetData, 'row').map(r => [+r.getAttribute('r')!, r]))

  const fila = (n: number) => {
    let r = filasEl.get(n)
    if (!r) {
      r = doc.createElementNS(NS, 'row'); r.setAttribute('r', String(n))
      const sig = kids(sheetData, 'row').find(x => +x.getAttribute('r')! > n)
      sheetData.insertBefore(r, sig || null); filasEl.set(n, r)
    }
    return r
  }
  const celda = (n: number, col: number, texto: string, estilo?: string | null) => {
    const r = fila(n); const ref = colLetra(col) + n
    let c = kids(r, 'c').find(x => x.getAttribute('r') === ref)
    if (!c) {
      c = doc.createElementNS(NS, 'c'); c.setAttribute('r', ref)
      const sig = kids(r, 'c').find(x => refPartes(x.getAttribute('r')!).c > col)
      r.insertBefore(c, sig || null)
    }
    while (c.firstChild) c.removeChild(c.firstChild)
    c.setAttribute('t', 'inlineStr')
    if (estilo) c.setAttribute('s', estilo)
    const is = doc.createElementNS(NS, 'is'); const t = doc.createElementNS(NS, 't')
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.textContent = texto; is.appendChild(t); c.appendChild(is)
    const sp = r.getAttribute('spans'); if (sp) r.removeAttribute('spans')
  }
  const estiloDe = (n: number, col: number) => kids(filasEl.get(n) || doc.createElement('x'), 'c').find(x => x.getAttribute('r') === colLetra(col) + n)?.getAttribute('s')

  // Encabezados
  const sEnc = estiloDe(p.fila_encabezado, p.ultima_col)
  TITULOS.forEach((t, i) => celda(p.fila_encabezado, c1 + i, t, sEnc))

  // Filas nuevas (agregadas en campo) al final de los datos
  let ultimaFila = Math.max(p.fila_encabezado, ...kids(sheetData, 'row').filter(r => kids(r, 'c').some(c => refPartes(c.getAttribute('r')!).c <= p.ultima_col && (c.textContent || '').trim())).map(r => +r.getAttribute('r')!))
  const sDato = estiloDe(ultimaFila, p.ultima_col)
  for (const it of items) if (it.fila == null && it.nuevo) {
    it.fila = ++ultimaFila
    if (p.col_codigos[0] && it.nuevo.codigo) celda(it.fila, p.col_codigos[0], it.nuevo.codigo, estiloDe(it.fila - 1, p.col_codigos[0]))
    if (p.col_serie && it.nuevo.serie) celda(it.fila, p.col_serie, it.nuevo.serie, estiloDe(it.fila - 1, p.col_serie))
    const partes = it.nuevo.descripcion.split(/\s*[·|\/]\s*/).filter(Boolean)
    if (p.col_desc.length > 1 && partes.length > 1) {
      p.col_desc.forEach((cd, i) => {
        const v = i === p.col_desc.length - 1 ? partes.slice(i).join(' · ') : partes[i]
        if (v) celda(it.fila!, cd, v, estiloDe(it.fila! - 1, cd))
      })
    } else {
      const cd = p.col_desc[0] || [1, 2, 3].find(c => !p.col_codigos.includes(c) && c !== p.col_serie)
      if (cd) celda(it.fila, cd, it.nuevo.descripcion, estiloDe(it.fila - 1, cd))
    }
  }
  // Registro de cada equipo
  for (const it of items) if (it.fila) celda(it.fila, c1 + 2, it.registro, sDato)

  // Alto de filas con foto y ancho de las columnas nuevas
  for (const it of items) if (it.fila && (it.equipo || it.sticker)) { const r = fila(it.fila); r.setAttribute('ht', String(ALTO_FILA)); r.setAttribute('customHeight', '1') }
  let cols = kid(ws, 'cols')
  if (!cols) { cols = doc.createElementNS(NS, 'cols'); ws.insertBefore(cols, sheetData) }
  for (const c of kids(cols, 'col')) if (+c.getAttribute('max')! >= c1) { if (+c.getAttribute('min')! >= c1) cols.removeChild(c); else c.setAttribute('max', String(c1 - 1)) }
  TITULOS.forEach((_, i) => {
    const col = doc.createElementNS(NS, 'col'); const n = String(c1 + i)
    col.setAttribute('min', n); col.setAttribute('max', n); col.setAttribute('width', String(i < 2 ? ANCHO_COL : 34)); col.setAttribute('customWidth', '1')
    cols!.appendChild(col)
  })
  const dim = kid(ws, 'dimension')
  if (dim) dim.setAttribute('ref', `A1:${colLetra(c1 + 2)}${Math.max(ultimaFila, ...items.map(i => i.fila || 0))}`)

  // Tabla de Excel: ampliarla para incluir las columnas y filas nuevas
  const relsPath = relsDe(hoja.path)
  const relsDoc = zip.file(relsPath) ? parse(await zip.file(relsPath)!.async('string'))
    : parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_REL}"/>`)
  const relsEl = relsDoc.documentElement
  const relaciones = () => Array.from(relsEl.getElementsByTagNameNS(NS_REL, 'Relationship'))
  for (const rel of relaciones().filter(r => r.getAttribute('Type') === T_TABLE)) {
    const tp = resolver(hoja.path, rel.getAttribute('Target')!)
    const td = parse(await zip.file(tp)!.async('string')); const t = td.documentElement
    const [a, b] = t.getAttribute('ref')!.split(':'); const A = refPartes(a), B = refPartes(b)
    if (A.r !== p.fila_encabezado || B.c !== p.ultima_col) continue
    const nuevoRef = `${a}:${colLetra(c1 + 2)}${Math.max(B.r, ultimaFila)}`
    t.setAttribute('ref', nuevoRef)
    const af = kid(t, 'autoFilter'); if (af) af.setAttribute('ref', nuevoRef)
    const tcs = kid(t, 'tableColumns')!
    let id = Math.max(0, ...kids(tcs, 'tableColumn').map(x => +x.getAttribute('id')!))
    for (const titulo of TITULOS) { const tc = td.createElementNS(NS, 'tableColumn'); tc.setAttribute('id', String(++id)); tc.setAttribute('name', titulo); tcs.appendChild(tc) }
    tcs.setAttribute('count', String(kids(tcs, 'tableColumn').length))
    zip.file(tp, ser(td))
  }

  // Imágenes en un dibujo de la hoja
  const fotos: { fila: number; col: number; f: Foto }[] = []
  for (const it of items) if (it.fila) { if (it.equipo) fotos.push({ fila: it.fila, col: c1, f: it.equipo }); if (it.sticker) fotos.push({ fila: it.fila, col: c1 + 1, f: it.sticker }) }
  if (fotos.length) {
    const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    let dPath: string
    const dEl = kid(ws, 'drawing')
    if (dEl) dPath = resolver(hoja.path, relaciones().find(r => r.getAttribute('Id') === dEl.getAttributeNS(NS_R, 'id'))!.getAttribute('Target')!)
    else {
      let n = 1; while (zip.file(`xl/drawings/drawing${n}.xml`)) n++
      dPath = `xl/drawings/drawing${n}.xml`
      zip.file(dPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}"/>`)
      const rid = nuevoRid(relaciones())
      const rel = relsDoc.createElementNS(NS_REL, 'Relationship'); rel.setAttribute('Id', rid); rel.setAttribute('Type', T_DRAWING)
      rel.setAttribute('Target', '../drawings/' + dPath.split('/').pop()); relsEl.appendChild(rel)
      const d = doc.createElementNS(NS, 'drawing'); d.setAttributeNS(NS_R, 'r:id', rid)
      const ANTES = ['legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst']
      const sig = Array.from(ws.childNodes).find(x => x.nodeType === 1 && ANTES.includes((x as Element).localName))
      ws.insertBefore(d, sig || null)
      await tipo(zip, '/' + dPath, 'application/vnd.openxmlformats-officedocument.drawing+xml')
    }
    const dd = parse(await zip.file(dPath)!.async('string')); const wsDr = dd.documentElement
    const dRelsPath = relsDe(dPath)
    const dRels = zip.file(dRelsPath) ? parse(await zip.file(dRelsPath)!.async('string'))
      : parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_REL}"/>`)
    let pid = Math.max(1, ...Array.from(dd.getElementsByTagNameNS(XDR, 'cNvPr')).map(x => +x.getAttribute('id')! || 0))
    let m = 1; const medias = new Set(Object.keys(zip.files))
    await tipoDefault(zip, 'jpeg', 'image/jpeg')
    for (const ft of fotos) {
      while (medias.has(`xl/media/evidencia${m}.jpeg`)) m++
      const media = `xl/media/evidencia${m}.jpeg`; medias.add(media); zip.file(media, ft.f.bytes)
      const rid = nuevoRid(Array.from(dRels.documentElement.getElementsByTagNameNS(NS_REL, 'Relationship')))
      const rel = dRels.createElementNS(NS_REL, 'Relationship'); rel.setAttribute('Id', rid); rel.setAttribute('Type', T_IMAGE); rel.setAttribute('Target', '../media/' + media.split('/').pop())
      dRels.documentElement.appendChild(rel)
      const k = Math.min(LADO / ft.f.w, LADO / ft.f.h, 1)
      const w = Math.round(ft.f.w * k) * PX, h = Math.round(ft.f.h * k) * PX, off = 6 * PX
      const frag = parse(`<xdr:twoCellAnchor xmlns:xdr="${XDR}" xmlns:a="${A}" xmlns:r="${NS_R}" editAs="oneCell">
<xdr:from><xdr:col>${ft.col - 1}</xdr:col><xdr:colOff>${off}</xdr:colOff><xdr:row>${ft.fila - 1}</xdr:row><xdr:rowOff>${off}</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${ft.col - 1}</xdr:col><xdr:colOff>${off + w}</xdr:colOff><xdr:row>${ft.fila - 1}</xdr:row><xdr:rowOff>${off + h}</xdr:rowOff></xdr:to>
<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${++pid}" name="Evidencia ${pid}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`)
      wsDr.appendChild(dd.importNode(frag.documentElement, true))
    }
    zip.file(dPath, ser(dd)); zip.file(dRelsPath, ser(dRels))
  }
  zip.file(relsPath, ser(relsDoc))
  zip.file(hoja.path, ser(doc))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' })
}

const nuevoRid = (rels: Element[]) => { let n = rels.length + 1; const ids = new Set(rels.map(r => r.getAttribute('Id'))); while (ids.has('rId' + n)) n++; return 'rId' + n }
async function tipo(zip: JSZip, parte: string, ct: string) {
  const d = parse(await zip.file('[Content_Types].xml')!.async('string'))
  if (Array.from(d.documentElement.childNodes).some(x => (x as Element).getAttribute?.('PartName') === parte)) return
  const o = d.createElementNS(d.documentElement.namespaceURI, 'Override'); o.setAttribute('PartName', parte); o.setAttribute('ContentType', ct)
  d.documentElement.appendChild(o); zip.file('[Content_Types].xml', ser(d))
}
async function tipoDefault(zip: JSZip, ext: string, ct: string) {
  const d = parse(await zip.file('[Content_Types].xml')!.async('string'))
  if (Array.from(d.documentElement.childNodes).some(x => (x as Element).getAttribute?.('Extension')?.toLowerCase() === ext)) return
  const o = d.createElementNS(d.documentElement.namespaceURI, 'Default'); o.setAttribute('Extension', ext); o.setAttribute('ContentType', ct)
  d.documentElement.insertBefore(o, d.documentElement.firstChild); zip.file('[Content_Types].xml', ser(d))
}
