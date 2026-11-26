-- =====================================================================
--  Migración 005: confirmación de retención en la fuente (ej. hotel)
-- =====================================================================
alter table public.conceptos add column if not exists pide_retencion boolean not null default false;
update public.conceptos set pide_retencion = true where id = 'hotel';
alter table public.conceptos add column if not exists retencion_pct numeric(5,2) check (retencion_pct is null or (retencion_pct > 0 and retencion_pct < 100));
alter table public.conceptos add column if not exists retencion_base integer check (retencion_base is null or retencion_base >= 0); -- monto desde el cual aplica

alter table public.reportes add column if not exists retencion boolean;          -- ¿se practicó la retención?
alter table public.reportes add column if not exists retencion_valor integer;    -- valor retenido
alter table public.reportes add column if not exists retencion_nota text;        -- por qué no se practicó

create or replace function public.validar_retencion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select pide_retencion from conceptos where id = new.concepto_id), false) then
    new.retencion := null; new.retencion_valor := null; new.retencion_nota := null; return new;
  end if;
  if new.retencion is null then raise exception 'Indica si se practicó la retención (retencion_requerida).'; end if;
  if new.retencion then
    new.retencion_nota := nullif(trim(new.retencion_nota), '');
    if coalesce(new.retencion_valor, 0) <= 0 then raise exception 'Escribe el valor retenido (retencion_valor).'; end if;
  else
    new.retencion_valor := null;
    if coalesce(trim(new.retencion_nota), '') = '' then raise exception 'Explica por qué no se practicó la retención (retencion_nota).'; end if;
  end if;
  return new;
end $$;
drop trigger if exists validar_retencion on public.reportes;
create trigger validar_retencion before insert or update of retencion, retencion_valor, retencion_nota, concepto_id on public.reportes
  for each row execute function public.validar_retencion();

drop function if exists public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text);
create or replace function public.reenviar_reporte(
  p_id bigint, p_fecha date, p_concepto text, p_subtipo text, p_descripcion text, p_noches int,
  p_monto int, p_fe boolean, p_soporte text, p_rut text, p_obs text, p_anexo text default null,
  p_ret boolean default null, p_ret_valor int default null, p_ret_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r reportes;
begin
  select * into r from reportes where id = p_id for update;
  if not found or r.tecnico <> auth.uid() then raise exception 'Reporte no encontrado.'; end if;
  if r.legalizacion_id is not null then raise exception 'Este reporte ya fue legalizado como no aprobado; no se puede corregir.'; end if;
  if r.estado <> 'rechazado' then raise exception 'Solo se pueden corregir reportes rechazados.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto no válido.'; end if;
  if split_part(p_soporte,'/',1) <> auth.uid()::text or (p_rut is not null and split_part(p_rut,'/',1) <> auth.uid()::text) then
    raise exception 'Archivo de soporte no válido.'; end if;
  perform validar_gasto(p_concepto, p_subtipo, p_descripcion, p_fecha);
  update reportes set fecha_gasto = p_fecha, concepto_id = p_concepto, subtipo = nullif(p_subtipo,''),
    descripcion = nullif(trim(p_descripcion),''), noches = greatest(coalesce(p_noches,1),1), monto = p_monto,
    factura_electronica = p_fe, soporte_path = p_soporte, rut_path = case when p_fe then null else p_rut end, anexo_path = p_anexo,
    retencion = p_ret, retencion_valor = p_ret_valor, retencion_nota = p_ret_nota,
    observaciones = nullif(trim(p_obs),''), estado = 'pendiente', aprobado = null, reenvios = reenvios + 1
  where id = p_id;
  insert into historial (reporte_id, texto) values (p_id, 'Corregido y reenviado');
end $$;
revoke all on function public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text, boolean, int, text) from public, anon;
grant execute on function public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text, boolean, int, text) to authenticated;

-- ---------- Documentos pendientes por cargar (RUT / anexo que el vendedor envía después) ----------
alter table public.reportes add column if not exists rut_pendiente boolean not null default false;
alter table public.reportes add column if not exists anexo_pendiente boolean not null default false;

create or replace function public.validar_soportes() returns trigger
language plpgsql security definer set search_path = public as $$
declare k conceptos;
begin
  select * into k from conceptos where id = new.concepto_id;
  -- RUT
  if new.factura_electronica or k.rut_modo = 'no' then new.rut_path := null; new.rut_pendiente := false;
  elsif new.rut_path is not null then new.rut_pendiente := false;
  elsif k.rut_modo = 'obligatorio' and not new.rut_pendiente then
    raise exception 'Adjunta el RUT del proveedor o márcalo como pendiente (rut_requerido).';
  elsif k.rut_modo = 'opcional' then new.rut_pendiente := false;
  end if;
  -- Otro anexo
  if k.anexo_modo = 'no' then new.anexo_path := null; new.anexo_pendiente := false;
  elsif new.anexo_path is not null then new.anexo_pendiente := false;
  elsif k.anexo_modo = 'obligatorio' and not new.anexo_pendiente then
    raise exception 'Adjunta: % (anexo_requerido).', coalesce(k.anexo_nombre, 'anexo');
  elsif k.anexo_modo = 'opcional' then new.anexo_pendiente := false;
  end if;
  if new.anexo_path is not null and split_part(new.anexo_path,'/',1) <> new.tecnico::text then
    raise exception 'Archivo de soporte no válido.';
  end if;
  return new;
end $$;
drop trigger if exists validar_soportes on public.reportes;
create trigger validar_soportes before insert or update of factura_electronica, rut_path, anexo_path, rut_pendiente, anexo_pendiente, concepto_id on public.reportes
  for each row execute function public.validar_soportes();

-- El técnico carga después el documento pendiente (en cualquier estado, mientras no esté legalizado)
create or replace function public.cargar_documento(p_id bigint, p_tipo text, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare r reportes;
begin
  select * into r from reportes where id = p_id for update;
  if not found or r.tecnico <> auth.uid() then raise exception 'Reporte no encontrado.'; end if;
  if r.legalizacion_id is not null then raise exception 'Este reporte ya fue legalizado; no se pueden cargar documentos.'; end if;
  if p_path is null or split_part(p_path,'/',1) <> auth.uid()::text then raise exception 'Archivo de soporte no válido.'; end if;
  if p_tipo = 'rut' then
    update reportes set rut_path = p_path, rut_pendiente = false where id = p_id;
    insert into historial (reporte_id, texto) values (p_id, 'RUT cargado');
  elsif p_tipo = 'anexo' then
    update reportes set anexo_path = p_path, anexo_pendiente = false where id = p_id;
    insert into historial (reporte_id, texto) values (p_id, 'Anexo cargado');
  else raise exception 'Tipo de documento no válido.'; end if;
end $$;
revoke all on function public.cargar_documento(bigint, text, text) from public, anon;
grant execute on function public.cargar_documento(bigint, text, text) to authenticated;

drop function if exists public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text, boolean, int, text);
create or replace function public.reenviar_reporte(
  p_id bigint, p_fecha date, p_concepto text, p_subtipo text, p_descripcion text, p_noches int,
  p_monto int, p_fe boolean, p_soporte text, p_rut text, p_obs text, p_anexo text default null,
  p_ret boolean default null, p_ret_valor int default null, p_ret_nota text default null,
  p_rut_pend boolean default false, p_anexo_pend boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r reportes;
begin
  select * into r from reportes where id = p_id for update;
  if not found or r.tecnico <> auth.uid() then raise exception 'Reporte no encontrado.'; end if;
  if r.legalizacion_id is not null then raise exception 'Este reporte ya fue legalizado como no aprobado; no se puede corregir.'; end if;
  if r.estado <> 'rechazado' then raise exception 'Solo se pueden corregir reportes rechazados.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto no válido.'; end if;
  if split_part(p_soporte,'/',1) <> auth.uid()::text or (p_rut is not null and split_part(p_rut,'/',1) <> auth.uid()::text) then
    raise exception 'Archivo de soporte no válido.'; end if;
  perform validar_gasto(p_concepto, p_subtipo, p_descripcion, p_fecha);
  update reportes set fecha_gasto = p_fecha, concepto_id = p_concepto, subtipo = nullif(p_subtipo,''),
    descripcion = nullif(trim(p_descripcion),''), noches = greatest(coalesce(p_noches,1),1), monto = p_monto,
    factura_electronica = p_fe, soporte_path = p_soporte, rut_path = case when p_fe then null else p_rut end, anexo_path = p_anexo,
    rut_pendiente = coalesce(p_rut_pend, false), anexo_pendiente = coalesce(p_anexo_pend, false),
    retencion = p_ret, retencion_valor = p_ret_valor, retencion_nota = p_ret_nota,
    observaciones = nullif(trim(p_obs),''), estado = 'pendiente', aprobado = null, reenvios = reenvios + 1
  where id = p_id;
  insert into historial (reporte_id, texto) values (p_id, 'Corregido y reenviado');
end $$;
revoke all on function public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text, boolean, int, text, boolean, boolean) from public, anon;
grant execute on function public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text, boolean, int, text, boolean, boolean) to authenticated;

-- Legalizar: lo que tenga documentos pendientes cuenta como NO aprobado y queda rechazado
create or replace function public.legalizar(p_orden text, p_tecnico uuid, p_fecha date, p_medio text, p_nota text, p_comprobante text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_c int; v_ti int; v_to int; v_rep int; v_apr int; v_n int; v_desde date; v_hasta date; v_id bigint;
begin
  if not es_admin() then raise exception 'Solo el administrador puede legalizar.'; end if;
  if exists (select 1 from reportes where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null and estado = 'pendiente') then
    raise exception 'Este técnico tiene reportes por revisar en la orden %; revísalos antes de legalizar.', p_orden; end if;
  select coalesce(sum(monto),0) into v_c from consignaciones where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  select coalesce(sum(monto),0) into v_ti from traspasos where orden = p_orden and a = p_tecnico and legalizacion_a is null;
  select coalesce(sum(monto),0) into v_to from traspasos where orden = p_orden and de = p_tecnico and legalizacion_de is null;
  select coalesce(sum(monto),0), coalesce(sum(aprobado) filter (where not rut_pendiente and not anexo_pendiente),0), count(*), min(fecha_gasto), max(fecha_gasto)
    into v_rep, v_apr, v_n, v_desde, v_hasta
    from reportes where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  if v_n = 0
     and not exists (select 1 from consignaciones where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null)
     and not exists (select 1 from traspasos where orden = p_orden and ((a = p_tecnico and legalizacion_a is null) or (de = p_tecnico and legalizacion_de is null))) then
    raise exception 'No hay movimientos pendientes de legalizar.'; end if;
  insert into legalizaciones (orden, tecnico, consignado, traspaso_recibido, traspaso_entregado, reportado, aprobado, no_aprobado,
    resultado, n_reportes, desde, hasta, fecha, medio, nota, comprobante_path, creado_por)
  values (p_orden, p_tecnico, v_c, v_ti, v_to, v_rep, v_apr, v_rep - v_apr, (v_c + v_ti - v_to) - v_apr, v_n, v_desde, v_hasta,
    coalesce(p_fecha, hoy_local()), nullif(trim(p_medio),''), nullif(trim(p_nota),''), p_comprobante, auth.uid())
  returning id into v_id;
  insert into historial (reporte_id, texto)
    select id, case when estado = 'rechazado' then 'Legalizado como NO aprobado (rechazado sin corregir)'
                    when rut_pendiente or anexo_pendiente then 'Legalizado como NO aprobado (documento pendiente sin cargar)'
                    else 'Legalizado' end
    from reportes where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  update reportes set estado = 'rechazado', aprobado = null,
         motivo = 'No se cargó ' || case when rut_pendiente then 'el RUT' else 'el anexo' end || ' antes de legalizar'
   where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null and (rut_pendiente or anexo_pendiente) and estado <> 'rechazado';
  update reportes set legalizacion_id = v_id where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  update consignaciones set legalizacion_id = v_id where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  update traspasos set legalizacion_a = v_id where orden = p_orden and a = p_tecnico and legalizacion_a is null;
  update traspasos set legalizacion_de = v_id where orden = p_orden and de = p_tecnico and legalizacion_de is null;
  return v_id;
end $$;
revoke execute on function public.legalizar(text, uuid, date, text, text, text) from anon;
grant execute on function public.legalizar(text, uuid, date, text, text, text) to authenticated;
