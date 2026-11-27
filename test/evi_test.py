"""Prueba de punta a punta del módulo Evidencias con un Supabase simulado."""
import json, re, sys
src = open('/home/claude/viaticos/test/ui_test.py').read()
exec(src[:src.index("errs = []")])
INV = open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/inv/inv.xlsx', 'rb').read()
JPG = open('/tmp/xt/eq.jpg', 'rb').read()
DB['inventarios'] = []; DB['equipos'] = []; DB['avance_inventarios'] = []; DB['servicios'] = []
for o in DB['ordenes']: o['responsable'] = C
seq = {'eq': 0}
def avance():
    out = []
    for i in DB['inventarios']:
        es = [e for e in DB['equipos'] if e['orden'] == i['orden']]
        out.append({'orden': i['orden'], 'total': len(es), 'con_evidencia': sum(1 for e in es if e['foto_equipo'] and e['foto_sticker']),
                    'agregados': sum(1 for e in es if e['fila'] is None), 'ultima': max([e['evidencia_at'] for e in es if e['evidencia_at']] or [None])})
    DB['avance_inventarios'] = out
def nuevo_eq(**k):
    seq['eq'] += 1
    e = dict(id=seq['eq'], fila=None, codigo=None, codigos=[], serie=None, descripcion=None, datos=[], agregado_por=None, agregado_at=None,
             foto_equipo=None, foto_sticker=None, nota=None, evidencia_por=None, evidencia_at=None); e.update(k); return e
base = handler
def h2(route, req):
    u = urlparse(req.url); path = u.path
    hdr = {'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range'}
    if req.method == 'OPTIONS': return route.fulfill(status=200, headers=hdr)
    if path.startswith('/storage/v1/object/sign/') and 'token=' in (u.query or ''):
        return route.fulfill(status=200, headers={'content-type': 'image/jpeg', 'access-control-allow-origin': '*'}, body=JPG)
    if path.startswith('/storage/v1/object/sign/'):
        return route.fulfill(status=200, headers=hdr, body=json.dumps({'signedURL': '/object/sign/x.jpg?token=t'}))
    if path.startswith('/storage/v1/object/soportes/') and req.method == 'GET':
        return route.fulfill(status=200, headers={'content-type': 'application/octet-stream', 'access-control-allow-origin': '*'}, body=INV)
    m = re.match(r'/rest/v1/rpc/(\w+)', path)
    if m:
        b = json.loads(req.post_data or '{}'); f = m.group(1)
        if f == 'crear_servicio':
            DB['servicios'].insert(0, {'num': b['p_num'], 'cliente': b['p_cliente'], 'ciudad_id': b['p_ciudad'], 'responsable': USER, 'created_at': hoy + 'T14:00:00Z', 'archivado': False})
            return route.fulfill(status=200, headers=hdr, body=json.dumps(b['p_num']))
        if f == 'cargar_inventario':
            DB['inventarios'].append({'orden': b['p_orden'], 'archivo_path': b['p_archivo'], 'nombre_archivo': b['p_nombre'], 'hoja': b['p_hoja'],
              'fila_encabezado': b['p_fila'], 'col_codigos': b['p_col_codigos'], 'col_serie': b['p_col_serie'], 'col_desc': b['p_col_desc'],
              'ultima_col': b['p_ultima'], 'encabezados': b['p_encabezados'], 'cargado_por': USER, 'cargado_at': hoy + 'T15:00:00Z'})
            for e in b['p_equipos']:
                DB['equipos'].append(nuevo_eq(orden=b['p_orden'], fila=e['fila'], codigo=e['codigo'] or None, codigos=e['codigos'], serie=e['serie'] or None, descripcion=e['descripcion'], datos=e['datos']))
            avance(); print('RPC cargar_inventario', b['p_fila'], b['p_col_codigos'], b['p_col_serie'], b['p_col_desc'], b['p_ultima'], len(b['p_equipos']))
            return route.fulfill(status=200, headers=hdr, body=json.dumps(len(b['p_equipos'])))
        if f == 'agregar_equipo':
            e = nuevo_eq(orden=b['p_orden'], codigo=b['p_codigo'] or None, codigos=[b['p_codigo']] if b['p_codigo'] else [], serie=b['p_serie'] or None, descripcion=b['p_descripcion'], agregado_por=USER, agregado_at=hoy + 'T15:00:00Z')
            DB['equipos'].append(e); avance(); return route.fulfill(status=200, headers=hdr, body=json.dumps(e['id']))
        if f == 'cargar_evidencia':
            for e in DB['equipos']:
                if e['id'] == b['p_id']: e.update(foto_equipo=b['p_foto_equipo'], foto_sticker=b['p_foto_sticker'], nota=b['p_nota'] or None, evidencia_por=USER, evidencia_at=hoy + 'T16:00:00Z')
            avance(); print('RPC cargar_evidencia', b['p_id']); return route.fulfill(status=204, headers=hdr, body='')
    return base(route, req)

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    USER = C
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); ctx.route('https://x.supabase.co/**', h2)
    ctx.add_init_script(f"localStorage.setItem('sb-x-auth-token', {json.dumps(sesion(C))})")
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('tec: ' + str(e)))
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=¿A qué módulo quieres entrar?', timeout=8000)
    pg.screenshot(path='/tmp/e0.png')
    pg.click('.modcard:has-text("Evidencias")'); pg.wait_for_selector('text=+ Nuevo servicio'); pg.screenshot(path='/tmp/e1.png')
    pg.click('text=+ Nuevo servicio'); pg.fill('#ns-n', '4120 cal mmcs'); pg.fill('#ns-c', 'Fundación Neumológica'); pg.select_option('#ns-ci', '1')
    pg.click('button.big:has-text("Crear servicio")')
    pg.wait_for_selector('text=Cargar inventario (Excel)'); pg.click('text=Cargar inventario (Excel)')
    pg.set_input_files('.big-up input', files=[{'name': 'Inventario_neumologica.xlsx', 'mimeType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'buffer': INV}])
    pg.wait_for_selector('text=equipos encontrados', timeout=8000); pg.screenshot(path='/tmp/e2.png', full_page=True)
    pg.click('button.big:has-text("Cargar")'); pg.wait_for_selector('#eq-q', timeout=8000)
    pg.screenshot(path='/tmp/e3.png', full_page=True)
    for cod in ['H00540', '1600021016']:
        pg.fill('#eq-q', cod); pg.wait_for_timeout(200)
        if cod == 'H00540': pg.screenshot(path='/tmp/e4.png')
        pg.locator('.eqrow').first.click(); pg.wait_for_selector('text=1. Foto del equipo')
        ins = pg.locator('.fslot input[capture]')
        ins.nth(0).set_input_files(files=[{'name': 'a.jpg', 'mimeType': 'image/jpeg', 'buffer': JPG}])
        ins.nth(1).set_input_files(files=[{'name': 'b.jpg', 'mimeType': 'image/jpeg', 'buffer': JPG}])
        pg.wait_for_timeout(300)
        if cod == 'H00540': pg.screenshot(path='/tmp/e5.png', full_page=True)
        pg.click('button.big'); pg.wait_for_selector('#eq-q', timeout=8000)
    pg.fill('#eq-q', 'ZZ-777'); pg.wait_for_timeout(200); pg.screenshot(path='/tmp/e6.png')
    pg.click('text=Agregar como equipo nuevo'); pg.fill('#n-d', 'Centrífuga · Hettich · EBA 200'); pg.click('button.big')
    pg.wait_for_selector('text=1. Foto del equipo')
    ins = pg.locator('.fslot input[capture]')
    ins.nth(0).set_input_files(files=[{'name': 'a.jpg', 'mimeType': 'image/jpeg', 'buffer': JPG}]); ins.nth(1).set_input_files(files=[{'name': 'b.jpg', 'mimeType': 'image/jpeg', 'buffer': JPG}])
    pg.click('button.big'); pg.wait_for_selector('#eq-q', timeout=8000); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/e7.png', full_page=True)
    ctx.close()
    USER = A
    ctx = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True); ctx.route('https://x.supabase.co/**', h2)
    ctx.add_init_script(f"localStorage.setItem('sb-x-auth-token', {json.dumps(sesion(A))}); sessionStorage.setItem('modulo','evi'); localStorage.setItem('modo','admin')")
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('adm: ' + str(e)))
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Descargar avance', timeout=8000); pg.screenshot(path='/tmp/e8.png', full_page=True)
    with pg.expect_download(timeout=30000) as d: pg.click('button:has-text("Descargar avance")')
    d.value.save_as('/tmp/xt/avance_ui.xlsx'); print('descargado', d.value.suggested_filename)
    pg.click('text=Ver equipos'); pg.wait_for_timeout(600); pg.screenshot(path='/tmp/e9.png')
print('ERRS', errs)
