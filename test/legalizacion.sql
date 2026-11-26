\set ON_ERROR_STOP 0
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@m.co','{"nombre":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000c','carlos@m.co','{"nombre":"Carlos"}'),
 ('00000000-0000-0000-0000-00000000000b','juan@m.co','{"nombre":"Juan"}');
update perfiles set activo=true; update perfiles set rol='admin' where email='admin@m.co';
update config set lim_lv='23:59', lim_sab='23:59', lim_dom='23:59';
set role authenticated;
-- Abril: Carlos
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
insert into ordenes(num,cliente,ciudad_id,creada_por,responsable) values ('4120-CAL-MMCS','Cliente S.A.',4,auth.uid(),auth.uid());
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values
 ('4120-CAL-MMCS',hoy_local(),'desayuno',25000,true,'00000000-0000-0000-0000-00000000000c/a.jpg'),
 ('4120-CAL-MMCS',hoy_local(),'almuerzo',20000,true,'00000000-0000-0000-0000-00000000000c/b.jpg'),
 ('4120-CAL-MMCS',hoy_local(),'cena',15000,true,'00000000-0000-0000-0000-00000000000c/c.jpg');
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into consignaciones(orden,fecha,monto) values ('4120-CAL-MMCS',hoy_local(),100000);
\echo '--- legalizar con pendientes (debe fallar)'
select legalizar('4120-CAL-MMCS','00000000-0000-0000-0000-00000000000c',hoy_local(),'Efectivo','',null);
select decidir_reporte(id,'parcial') from reportes where concepto_id='desayuno';
select decidir_reporte(id,'aprobar') from reportes where concepto_id='almuerzo';
select decidir_reporte(id,'rechazar','Ilegible') from reportes where concepto_id='cena';
select legalizar('4120-CAL-MMCS','00000000-0000-0000-0000-00000000000c',hoy_local(),'Efectivo','Devolvió en caja',null) as leg1;
select consignado, reportado, aprobado, no_aprobado, resultado, n_reportes from legalizaciones;
\echo '--- saldo de Carlos tras legalizar (solo fila responsable en cero)'
select tecnico, consignado, reportado, aprobado from saldos;
\echo '--- anular consignación legalizada (0 filas borradas)'
delete from consignaciones;
select count(*) from consignaciones;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
\echo '--- corregir rechazado ya legalizado (debe fallar)'
select reenviar_reporte(id,hoy_local(),'cena',null,null,1,15000,true,'00000000-0000-0000-0000-00000000000c/x.jpg',null,'') from reportes where concepto_id='cena';
-- Junio: Juan toma la orden
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select cambiar_responsable('4120-CAL-MMCS','00000000-0000-0000-0000-00000000000b',0,hoy_local(),'Junio');
insert into consignaciones(orden,fecha,monto) values ('4120-CAL-MMCS',hoy_local(),200000);
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,retencion,retencion_valor,soporte_path) values ('4120-CAL-MMCS',hoy_local(),'hotel',150000,true,true,5400,'00000000-0000-0000-0000-00000000000b/h.jpg');
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select decidir_reporte(id,'aprobar') from reportes where concepto_id='hotel';
\echo '--- traspaso de 0 pendiente de Carlos: legalizar Carlos otra vez cierra el traspaso'
select legalizar('4120-CAL-MMCS','00000000-0000-0000-0000-00000000000c',hoy_local(),null,null,null) as leg_carlos_2;
select legalizar('4120-CAL-MMCS','00000000-0000-0000-0000-00000000000b',hoy_local(),'Transferencia',null,null) as leg_juan;
select (select nombre from perfiles where id=tecnico) tec, consignado, traspaso_recibido, traspaso_entregado, aprobado, resultado from legalizaciones order by id;
\echo '--- nada que legalizar (debe fallar)'
select legalizar('4120-CAL-MMCS','00000000-0000-0000-0000-00000000000b',hoy_local(),null,null,null);
\echo '--- archivar y reportar (debe fallar)'
update ordenes set archivada=true;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
insert into reportes(orden,fecha_gasto,concepto_id,monto,factura_electronica,soporte_path) values ('4120-CAL-MMCS',hoy_local(),'cena',10000,true,'00000000-0000-0000-0000-00000000000b/z.jpg');
\echo '--- tecnico ve sus legalizaciones (1)'
select count(*) from legalizaciones;
