\set ON_ERROR_STOP 0
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@m.co','{"nombre":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000c','carlos@m.co','{"nombre":"Carlos Pérez"}'),
 ('00000000-0000-0000-0000-00000000000b','juan@m.co','{"nombre":"Juan Rodríguez"}'),
 ('00000000-0000-0000-0000-00000000000d','nuevo@m.co','{}');
update perfiles set rol='admin',activo=true where email='admin@m.co';
update perfiles set activo=true where email in ('carlos@m.co','juan@m.co');
select nombre, rol, activo from perfiles order by email;
update config set lim_lv='23:59', lim_sab='23:59', lim_dom='23:59';

-- usuario inactivo no puede ver órdenes ni crear
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
\echo '--- inactivo intenta crear orden (debe fallar)'
insert into ordenes(num,cliente,ciudad_id,creada_por,responsable) values ('MMCS-1','X',1,auth.uid(),auth.uid());

-- Carlos crea orden y reporta
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
insert into ordenes(num,cliente,ciudad_id,creada_por,responsable) values ('MMCS-1241','Lácteos del Norte S.A.',4,auth.uid(),auth.uid());
\echo '--- formato de orden inválido (debe fallar)'
insert into ordenes(num,cliente,ciudad_id,creada_por,responsable) values ('ABC','X S.A.',4,auth.uid(),auth.uid());
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'desayuno',25000,true,'00000000-0000-0000-0000-00000000000c/a.jpg');
\echo '--- sin RUT y no electrónica (debe fallar)'
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'cena',20000,false,'00000000-0000-0000-0000-00000000000c/b.jpg');
\echo '--- transporte sin subtipo (debe fallar)'
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'transporte',20000,true,'00000000-0000-0000-0000-00000000000c/b.jpg');
insert into reportes(orden,fecha_gasto,concepto_id,subtipo,monto,factura_electronica,soporte_path,rut_path) values ('MMCS-1241',hoy_local(),'transporte','Taxi',20000,false,'00000000-0000-0000-0000-00000000000c/c.jpg','00000000-0000-0000-0000-00000000000c/r.jpg');
\echo '--- soporte en carpeta ajena (debe fallar)'
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'almuerzo',20000,true,'00000000-0000-0000-0000-00000000000b/a.jpg');
\echo '--- gasto de hace 3 días = extemporáneo'
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local()-3,'almuerzo',20000,true,'00000000-0000-0000-0000-00000000000c/d.jpg');
select id, concepto_id, monto, estado, extemporaneo, tope_de(concepto_id,orden,noches) tope from reportes order by id;

-- Juan no es responsable
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
\echo '--- Juan reporta en orden ajena (debe fallar)'
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'almuerzo',20000,true,'00000000-0000-0000-0000-00000000000b/a.jpg');
\echo '--- Juan ve reportes (0 filas)'
select count(*) from reportes;
\echo '--- Juan intenta aprobar (debe fallar)'
select decidir_reporte(1,'aprobar');

-- Admin
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select decidir_reporte(1,'parcial');
select decidir_reporte(4,'rechazar','Falta RUT legible');
\echo '--- parcial sobre gasto dentro de tope (debe fallar)'
select decidir_reporte(6,'parcial');
select decidir_reporte(6,'aprobar');
insert into consignaciones(orden,fecha,monto,medio) values ('MMCS-1241',hoy_local()-1,500000,'Transferencia'),('MMCS-1241',hoy_local(),600000,'Transferencia');
select orden, (select nombre from perfiles where id=tecnico) tec, monto from consignaciones;
select * from saldos;

-- Carlos corrige el rechazado
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select reenviar_reporte(4,hoy_local(),'transporte','Taxi',null,1,20000,false,'00000000-0000-0000-0000-00000000000c/c2.jpg','00000000-0000-0000-0000-00000000000c/r2.jpg','');
\echo '--- reenviar uno aprobado (debe fallar)'
select reenviar_reporte(6,hoy_local(),'almuerzo',null,null,1,20000,true,'00000000-0000-0000-0000-00000000000c/x.jpg',null,'');
select id, estado, reenvios from reportes order by id;
select reporte_id, texto from historial order by id;

-- Admin cambia responsable a Juan con saldo
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select cambiar_responsable('MMCS-1241','00000000-0000-0000-0000-00000000000b', 900000, hoy_local(), 'Carlos regresa');
insert into consignaciones(orden,fecha,monto) values ('MMCS-1241',hoy_local(),400000);
select (select nombre from perfiles where id=tecnico) tec, consignado, traspaso_recibido, traspaso_entregado, reportado, aprobado, por_revisar, es_responsable from saldos order by 1;

-- Carlos ya no puede reportar; Juan sí
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
\echo '--- Carlos reporta tras traspaso (debe fallar)'
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'cena',20000,true,'00000000-0000-0000-0000-00000000000c/e.jpg');
select tecnico is not null, consignado from saldos;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'cena',20000,true,'00000000-0000-0000-0000-00000000000b/e.jpg');
select consignado, traspaso_recibido, reportado from saldos;

-- Política de bloqueo
reset role;
update config set politica='bloquear', lim_lv='00:01', lim_sab='00:01', lim_dom='00:01';
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
\echo '--- bloqueado (debe fallar)'
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'cena',20000,true,'00000000-0000-0000-0000-00000000000b/f.jpg');
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into habilitaciones(tecnico,fecha) values ('00000000-0000-0000-0000-00000000000b',hoy_local());
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('MMCS-1241',hoy_local(),'cena',20000,true,'00000000-0000-0000-0000-00000000000b/f.jpg');
select id, extemporaneo from reportes order by id desc limit 1;
\echo '--- storage: Juan sube a su carpeta ok, a la ajena falla'
insert into storage.objects(bucket_id,name) values ('soportes','00000000-0000-0000-0000-00000000000b/z.jpg');
insert into storage.objects(bucket_id,name) values ('soportes','00000000-0000-0000-0000-00000000000c/z.jpg');
select count(*) from storage.objects;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select anular_traspaso(1);
select responsable = '00000000-0000-0000-0000-00000000000c' as volvio_a_carlos from ordenes;
select limite_reporte('2026-11-28'::date) as sabado, limite_reporte('2026-11-25'::date) as miercoles;
