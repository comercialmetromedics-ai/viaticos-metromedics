-- =====================================================================
--  Migración 004: anexos configurables por concepto
--   rut_modo:   RUT cuando el soporte NO es factura electrónica (obligatorio | opcional | no)
--   anexo_*:    otro anexo con nombre libre (ej. "Tiquete de bus")  (obligatorio | opcional | no)
-- =====================================================================
alter table public.conceptos add column if not exists rut_modo text not null default 'obligatorio'
  check (rut_modo in ('obligatorio','opcional','no'));
alter table public.conceptos add column if not exists anexo_nombre text;
alter table public.conceptos add column if not exists anexo_modo text not null default 'no'
  check (anexo_modo in ('obligatorio','opcional','no'));
alter table public.reportes add column if not exists anexo_path text;

-- Desplazamiento: no pide RUT
update public.conceptos set rut_modo = 'no' where id = 'transporte';

alter table public.reportes drop constraint if exists rut_si_no_es_electronica;

create or replace function public.validar_soportes() returns trigger
language plpgsql security definer set search_path = public as $$
declare k conceptos;
begin
  select * into k from conceptos where id = new.concepto_id;
  -- RUT
  if new.factura_electronica or k.rut_modo = 'no' then new.rut_path := null;
  elsif k.rut_modo = 'obligatorio' and new.rut_path is null then
    raise exception 'Adjunta el RUT del proveedor (rut_requerido).';
  end if;
  -- Otro anexo
  if k.anexo_modo = 'no' then new.anexo_path := null;
  elsif k.anexo_modo = 'obligatorio' and new.anexo_path is null then
    raise exception 'Adjunta: % (anexo_requerido).', coalesce(k.anexo_nombre, 'anexo');
  end if;
  if new.anexo_path is not null and split_part(new.anexo_path,'/',1) <> new.tecnico::text then
    raise exception 'Archivo de soporte no válido.';
  end if;
  return new;
end $$;
drop trigger if exists validar_soportes on public.reportes;
create trigger validar_soportes before insert or update of factura_electronica, rut_path, anexo_path, concepto_id on public.reportes
  for each row execute function public.validar_soportes();

drop function if exists public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text);
create or replace function public.reenviar_reporte(
  p_id bigint, p_fecha date, p_concepto text, p_subtipo text, p_descripcion text, p_noches int,
  p_monto int, p_fe boolean, p_soporte text, p_rut text, p_obs text, p_anexo text default null) returns void
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
    observaciones = nullif(trim(p_obs),''), estado = 'pendiente', aprobado = null, reenvios = reenvios + 1
  where id = p_id;
  insert into historial (reporte_id, texto) values (p_id, 'Corregido y reenviado');
end $$;
revoke all on function public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text) from public, anon;
grant execute on function public.reenviar_reporte(bigint, date, text, text, text, int, int, boolean, text, text, text, text) to authenticated;
