-- =====================================================================
--  Migración 006: el administrador corrige la fecha del gasto
-- =====================================================================
create or replace function public.corregir_fecha_gasto(p_id bigint, p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare r reportes;
begin
  if not es_admin() then raise exception 'Solo el administrador puede corregir la fecha.'; end if;
  select * into r from reportes where id = p_id for update;
  if not found then raise exception 'Reporte no encontrado.'; end if;
  if r.legalizacion_id is not null then raise exception 'Este reporte ya fue legalizado; no se puede modificar.'; end if;
  if p_fecha is null or p_fecha > hoy_local() then raise exception 'La fecha del gasto no puede ser futura.'; end if;
  if p_fecha = r.fecha_gasto then return; end if;
  update reportes set fecha_gasto = p_fecha, extemporaneo = enviado_at > limite_reporte(p_fecha) where id = p_id;
  insert into historial (reporte_id, texto)
    values (p_id, 'Fecha del gasto corregida por el administrador: ' || to_char(r.fecha_gasto,'DD/MM/YYYY') || ' → ' || to_char(p_fecha,'DD/MM/YYYY'));
end $$;
revoke all on function public.corregir_fecha_gasto(bigint, date) from public, anon;
grant execute on function public.corregir_fecha_gasto(bigint, date) to authenticated;
