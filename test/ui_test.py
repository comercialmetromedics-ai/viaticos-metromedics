"""Prueba de interfaz con un Supabase simulado (respuestas fijas). No prueba permisos: eso lo cubre test/flujo.sql."""
import json, re, sys, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

A = '00000000-0000-0000-0000-00000000000a'; C = '00000000-0000-0000-0000-00000000000c'; J = '00000000-0000-0000-0000-00000000000b'
hoy = time.strftime('%Y-%m-%d')
DB = {
  'perfiles': [
    {'id': A, 'nombre': 'Andrés Espitia', 'email': 'a@m.co', 'rol': 'admin', 'activo': True, 'created_at': '2026-11-01T10:00:00Z'},
    {'id': C, 'nombre': 'Carlos Pérez', 'email': 'c@m.co', 'rol': 'tecnico', 'activo': True, 'created_at': '2026-11-01T10:00:00Z'},
    {'id': J, 'nombre': 'Juan Rodríguez', 'email': 'j@m.co', 'rol': 'tecnico', 'activo': False, 'created_at': '2026-11-20T10:00:00Z'}],
  'ciudades': [{'id': 1, 'nombre': 'Bogotá', 'orden': 1, 'activo': True}, {'id': 4, 'nombre': 'Barranquilla', 'orden': 4, 'activo': True}],
  'conceptos': [
    {'id': 'desayuno', 'nombre': 'Desayuno', 'unidad': 'por comida', 'subtipos': [], 'requiere_descripcion': False, 'por_noche': False, 'activo': True, 'orden': 1},
    {'id': 'hotel', 'nombre': 'Hotel', 'unidad': 'por noche', 'subtipos': [], 'requiere_descripcion': False, 'por_noche': True, 'activo': True, 'orden': 4},
    {'id': 'transporte', 'nombre': 'Desplazamiento', 'unidad': 'por trayecto', 'subtipos': ['Taxi', 'InDrive'], 'requiere_descripcion': False, 'por_noche': False, 'activo': True, 'orden': 5}],
  'topes': [{'concepto_id': 'desayuno', 'ciudad_id': 4, 'valor': 18000}, {'concepto_id': 'hotel', 'ciudad_id': 4, 'valor': 160000}, {'concepto_id': 'desayuno', 'ciudad_id': 1, 'valor': 20000}],
  'config': [{'id': 1, 'lim_lv': '20:00:00', 'lim_sab': '11:00:00', 'lim_dom': '20:00:00', 'avisos': [60, 15], 'politica': 'marcar', 'zona': 'America/Bogota'}],
  'ordenes': [{'num': 'MMCS-1241', 'cliente': 'Lácteos del Norte S.A.', 'ciudad_id': 4, 'creada_por': C, 'responsable': C, 'created_at': '2026-11-24T10:00:00Z'}],
  'reportes': [
    {'id': 1, 'orden': 'MMCS-1241', 'tecnico': C, 'fecha_gasto': hoy, 'enviado_at': hoy + 'T13:00:00Z', 'concepto_id': 'desayuno', 'subtipo': None, 'descripcion': None, 'noches': 1, 'monto': 25000,
     'factura_electronica': True, 'soporte_path': C + '/a.jpg', 'rut_path': None, 'observaciones': None, 'estado': 'pendiente', 'aprobado': None, 'motivo': None, 'reenvios': 0, 'extemporaneo': False, 'revisado_por': None, 'revisado_at': None},
    {'id': 2, 'orden': 'MMCS-1241', 'tecnico': C, 'fecha_gasto': hoy, 'enviado_at': hoy + 'T14:00:00Z', 'concepto_id': 'transporte', 'subtipo': 'Taxi', 'descripcion': None, 'noches': 1, 'monto': 22000,
     'factura_electronica': False, 'soporte_path': C + '/b.jpg', 'rut_path': C + '/r.jpg', 'observaciones': None, 'estado': 'rechazado', 'aprobado': None, 'motivo': 'Imagen ilegible', 'reenvios': 0, 'extemporaneo': True, 'revisado_por': A, 'revisado_at': hoy + 'T15:00:00Z'},
    {'id': 3, 'orden': 'MMCS-1241', 'tecnico': C, 'fecha_gasto': hoy, 'enviado_at': hoy + 'T12:00:00Z', 'concepto_id': 'hotel', 'subtipo': None, 'descripcion': None, 'noches': 2, 'monto': 300000,
     'factura_electronica': True, 'soporte_path': C + '/c.pdf', 'rut_path': None, 'observaciones': None, 'estado': 'aprobado', 'aprobado': 300000, 'motivo': None, 'reenvios': 0, 'extemporaneo': False, 'revisado_por': A, 'revisado_at': hoy + 'T15:00:00Z'}],
  'saldos': [{'orden': 'MMCS-1241', 'tecnico': C, 'consignado': 1100000, 'traspaso_recibido': 0, 'traspaso_entregado': 0, 'reportado': 347000, 'aprobado': 300000, 'por_revisar': 25000, 'rechazado': 22000, 'es_responsable': True}],
  'consignaciones': [{'id': 1, 'orden': 'MMCS-1241', 'tecnico': C, 'fecha': hoy, 'monto': 500000, 'medio': 'Transferencia', 'nota': 'Día 1', 'created_at': hoy + 'T10:00:00Z'},
                     {'id': 2, 'orden': 'MMCS-1241', 'tecnico': C, 'fecha': hoy, 'monto': 600000, 'medio': 'Transferencia', 'nota': None, 'created_at': hoy + 'T11:00:00Z'}],
  'traspasos': [], 'habilitaciones': [], 'historial': []}
calls = []

def handler(route, req):
    u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    calls.append((req.method, path + ('?' + u.query if u.query else '')))
    hdr = {'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range'}
    if req.method == 'OPTIONS': return route.fulfill(status=200, headers=hdr)
    if path.startswith('/storage/v1/object/sign/'):
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'signedURL': '/object/sign/x.jpg?token=t'}))
    if path.startswith('/storage/v1/object/'):
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'Key': 'soportes/x', 'Id': '1'}))
    if path.startswith('/auth/v1/user'):
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'id': USER, 'email': 'x@m.co', 'aud': 'authenticated'}))
    m = re.match(r'/rest/v1/(rpc/)?(\w+)', path)
    if not m: return route.fulfill(status=404, headers=hdr, body='{}')
    if m.group(1): return route.fulfill(status=204, headers=hdr, body='')
    rows = DB.get(m.group(2), [])
    if req.method == 'POST':
        body = json.loads(req.post_data or '{}')
        if isinstance(body, dict): body = [body]
        new = [dict(id=99, **b) if m.group(2) != 'ordenes' else b for b in body]
        if m.group(2) == 'reportes':
            for n in new: n.update(estado='pendiente', reenvios=0, extemporaneo=False, enviado_at=hoy + 'T20:00:00Z', tecnico=USER, aprobado=None, motivo=None)
        DB.setdefault(m.group(2), []).extend(new)
        single = 'vnd.pgrst.object' in req.headers.get('accept', '')
        return route.fulfill(status=201, headers=hdr, body=json.dumps(new[0] if single else new))
    if req.method in ('PATCH', 'DELETE'): return route.fulfill(status=204, headers=hdr, body='')
    # filtros simples eq / in
    for k, v in q.items():
        if k in ('select', 'order', 'limit', 'or'): continue
        v = v[0]
        if v.startswith('eq.'): rows = [r for r in rows if str(r.get(k)).lower() == v[3:].lower()]
        elif v.startswith('in.('): vals = v[4:-1].replace('"', '').split(','); rows = [r for r in rows if str(r.get(k)) in vals]
    hdr['content-range'] = f'0-{max(len(rows)-1,0)}/{len(rows)}'
    if req.method == 'HEAD': return route.fulfill(status=200, headers=hdr, body='')
    if 'vnd.pgrst.object' in req.headers.get('accept', ''):
        return route.fulfill(status=200, headers=hdr, body=json.dumps(rows[0] if rows else None))
    return route.fulfill(status=200, headers=hdr, body=json.dumps(rows))

def sesion(uid):
    return json.dumps({'access_token': 'x.' + 'e30' + '.y', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
                       'refresh_token': 'r', 'user': {'id': uid, 'email': 'x@m.co', 'aud': 'authenticated', 'app_metadata': {}, 'user_metadata': {}}})

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- técnico (Carlos) en celular ----------
    USER = C
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); ctx.route('https://x.supabase.co/**', handler)
    ctx.add_init_script(f"localStorage.setItem('sb-x-auth-token', {json.dumps(sesion(C))})")
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('tec: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'WebSocket' not in m.text and 'realtime' not in m.text.lower() and errs.append('console: ' + m.text))
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Hola, Carlos', timeout=8000)
    pg.screenshot(path='/tmp/r1.png', full_page=True)
    assert 'Mi saldo de viáticos' in pg.content()
    pg.click('text=+ Nuevo reporte de viáticos'); pg.fill('#oq', '1250'); pg.click('text=Crear orden')
    pg.fill('#no-c', 'Clínica Prueba S.A.S.'); pg.select_option('#no-ci', '1'); pg.click('text=Crear y continuar')
    pg.wait_for_selector('#f-c'); pg.select_option('#f-c', 'desayuno'); pg.fill('#f-m', '25000')
    print('CMP:', pg.inner_text('.cmp'))
    pg.click('text=Sí, electrónica')
    pg.set_input_files('.up input', files=[{'name': 'f.png', 'mimeType': 'image/png', 'buffer': open('/tmp/r1.png', 'rb').read()}])
    pg.wait_for_selector('.file'); pg.screenshot(path='/tmp/r2.png', full_page=True)
    pg.click('text=Enviar reporte'); pg.wait_for_selector('text=Reporte enviado', timeout=8000)
    pg.screenshot(path='/tmp/r3.png')
    pg.click('.pnav button:nth-child(4)'); pg.wait_for_selector('text=Corregir y reenviar'); pg.click('text=Corregir y reenviar')
    pg.wait_for_selector('text=Devuelto por el administrador'); pg.screenshot(path='/tmp/r4.png', full_page=True)
    pg.go_back(); pg.wait_for_selector('text=Novedades')
    pg.click('.pnav button:nth-child(3)'); pg.wait_for_selector('h2:text("Mis reportes")')
    ctx.close()
    # ---------- administrador en PC ----------
    USER = A
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}); ctx.route('https://x.supabase.co/**', handler)
    ctx.add_init_script(f"localStorage.setItem('sb-x-auth-token', {json.dumps(sesion(A))})")
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('adm: ' + str(e)))
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Viáticos · Administración', timeout=8000)
    pg.wait_for_selector('.rc'); pg.screenshot(path='/tmp/a1.png', full_page=True)
    assert 'Aprobar hasta el tope' in pg.content()
    pg.click('text=Aprobar hasta el tope')
    for t, f in [('Aprobados', 'a2'), ('Rechazados', 'a3'), ('Viáticos entregados', 'a4'), ('Indicadores', 'a5'), ('Ajustes', 'a6'), ('Usuarios', 'a7')]:
        pg.click(f'.tabs button:has-text("{t}")'); pg.wait_for_timeout(600); pg.screenshot(path=f'/tmp/{f}.png', full_page=True)
    pg.click('.tabs button:has-text("Viáticos entregados")'); pg.fill('#c-m', '200000'); pg.click('button:has-text("Registrar consignación")'); pg.wait_for_timeout(300)
    pg.click('text=Vista técnico'); pg.wait_for_selector('text=Panel admin')
    ctx.close()
print('RPC/POST:', [c for c in calls if c[0] in ('POST', 'PATCH')][-4:])
print('ERRORES:', errs)
