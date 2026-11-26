-- =====================================================================
--  Versión 2: legalización de viáticos y archivo de órdenes
--  Se ejecuta una sola vez sobre una base que ya tiene schema.sql
-- =====================================================================

alter table public.ordenes add column if not exists archivada boolean not null default false;

create table if not exists public.legalizaciones (
  id bigint generated always as identity primary key,
  orden text not null references public.ordenes(num) on update cascade,
  tecnico uuid not null references public.perfiles(id),
  consignado integer not null default 0,
  traspaso_recibido integer not null default 0,
  traspaso_entregado integer not null default 0,
  reportado integer not null default 0,
  aprobado integer not null default 0,
  no_aprobado integer not null default 0,
  resultado integer not null default 0,          -- > 0: el técnico reintegra · < 0: la empresa le reembolsa
  n_reportes integer not null default 0,
  desde date, hasta date,
  fecha date not null,
  medio text,
  nota text,
  comprobante_path text,
  creado_por uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists legalizaciones_orden on public.legalizaciones(orden);
create index if not exists legalizaciones_tecnico on public.legalizaciones(tecnico);

alter table public.reportes add column if not exists legalizacion_id bigint references public.legalizaciones(id);
alter table public.consignaciones add column if not exists legalizacion_id bigint references public.legalizaciones(id);
alter table public.traspasos add column if not exists legalizacion_de bigint references public.legalizaciones(id);
alter table public.traspasos add column if not exists legalizacion_a bigint references public.legalizaciones(id);

alter table public.legalizaciones enable row level security;
drop policy if exists "ver legalizaciones" on public.legalizaciones;
create policy "ver legalizaciones" on public.legalizaciones for select to authenticated using (tecnico = auth.uid() or es_admin());
grant select on public.legalizaciones to authenticated;

-- Lo legalizado ya no se puede anular
drop policy if exists "admin anula consignaciones" on public.consignaciones;
create policy "admin anula consignaciones" on public.consignaciones for delete to authenticated
  using (es_admin() and legalizacion_id is null);

-- Archivar / reactivar órdenes (solo administrador; ya cubierto por "admin ordenes")

-- ---------- Reglas que cambian ----------
create or replace function public.antes_de_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_resp uuid; v_pol text; v_arch boolean;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  new.tecnico := auth.uid();
  new.enviado_at := now();
  new.estado := 'pendiente'; new.aprobado := null; new.motivo := null;
  new.reenvios := 0; new.revisado_por := null; new.revisado_at := null; new.legalizacion_id := null;
  select responsable, archivada into v_resp, v_arch from ordenes where num = new.orden;
  if v_resp is null then raise exception 'La orden % no existe.', new.orden; end if;
  if v_arch then raise exception 'La orden % está archivada; pide al administrador que la reactive.', new.orden; end if;
  if v_resp <> new.tecnico then
    raise exception 'No eres el responsable de reportar los gastos de la orden %.', new.orden; end if;
  if split_part(new.soporte_path,'/',1) <> new.tecnico::text
     or (new.rut_path is not null and split_part(new.rut_path,'/',1) <> new.tecnico::text) then
    raise exception 'Archivo de soporte no válido.'; end if;
  perform validar_gasto(new.concepto_id, new.subtipo, new.descripcion, new.fecha_gasto);
  new.extemporaneo := now() > limite_reporte(new.fecha_gasto);
  if new.extemporaneo then
    select politica into v_pol from config where id = 1;
    if v_pol = 'bloquear' and not exists (select 1 from habilitaciones where tecnico = new.tecnico and fecha = hoy_local()) then
      raise exception 'El plazo para reportar los gastos del % cerró a las %. Pide al administrador que te habilite.',
        to_char(new.fecha_gasto,'DD/MM/YYYY'), to_char(limite_reporte(new.fecha_gasto) at time zone 'America/Bogota','HH12:MI AM');
    end if;
  end if;
  return new;
end $$;

create or replace function public.reenviar_reporte(
  p_id bigint, p_fecha date, p_concepto text, p_subtipo text, p_descripcion text, p_noches int,
  p_monto int, p_fe boolean, p_soporte text, p_rut text, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare r reportes;
begin
  select * into r from reportes where id = p_id for update;
  if not found or r.tecnico <> auth.uid() then raise exception 'Reporte no encontrado.'; end if;
  if r.legalizacion_id is not null then raise exception 'Este reporte ya fue legalizado como no aprobado; no se puede corregir.'; end if;
  if r.estado <> 'rechazado' then raise exception 'Solo se pueden corregir reportes rechazados.'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto no válido.'; end if;
  if not p_fe and p_rut is null then raise exception 'Adjunta el RUT del proveedor.'; end if;
  if split_part(p_soporte,'/',1) <> auth.uid()::text or (p_rut is not null and split_part(p_rut,'/',1) <> auth.uid()::text) then
    raise exception 'Archivo de soporte no válido.'; end if;
  perform validar_gasto(p_concepto, p_subtipo, p_descripcion, p_fecha);
  update reportes set fecha_gasto = p_fecha, concepto_id = p_concepto, subtipo = nullif(p_subtipo,''),
    descripcion = nullif(trim(p_descripcion),''), noches = greatest(coalesce(p_noches,1),1), monto = p_monto,
    factura_electronica = p_fe, soporte_path = p_soporte, rut_path = case when p_fe then null else p_rut end,
    observaciones = nullif(trim(p_obs),''), estado = 'pendiente', aprobado = null, reenvios = reenvios + 1
  where id = p_id;
  insert into historial (reporte_id, texto) values (p_id, 'Corregido y reenviado');
end $$;

create or replace function public.antes_de_consignacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_arch boolean;
begin
  select responsable, archivada into new.tecnico, v_arch from ordenes where num = new.orden;
  if new.tecnico is null then raise exception 'La orden % no existe.', new.orden; end if;
  if v_arch then raise exception 'La orden % está archivada.', new.orden; end if;
  new.creado_por := auth.uid();
  new.legalizacion_id := null;
  return new;
end $$;

create or replace function public.anular_traspaso(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t traspasos;
begin
  if not es_admin() then raise exception 'Solo el administrador.'; end if;
  select * into t from traspasos where id = p_id;
  if not found then raise exception 'Traspaso no encontrado.'; end if;
  if t.legalizacion_de is not null or t.legalizacion_a is not null then
    raise exception 'Este traspaso ya hace parte de una legalización; no se puede anular.'; end if;
  delete from traspasos where id = p_id;
  update ordenes set responsable = t.de where num = t.orden and responsable = t.a;
end $$;

-- Saldos: solo lo que aún no se ha legalizado (el ciclo abierto)
create or replace view public.saldos with (security_invoker = true) as
with pares as (
  select orden, tecnico from consignaciones where legalizacion_id is null
  union select orden, tecnico from reportes where legalizacion_id is null
  union select orden, de from traspasos where legalizacion_de is null
  union select orden, a from traspasos where legalizacion_a is null
  union select num, responsable from ordenes where not archivada
)
select p.orden, p.tecnico,
  coalesce((select sum(monto) from consignaciones c where c.orden = p.orden and c.tecnico = p.tecnico and c.legalizacion_id is null),0)::int as consignado,
  coalesce((select sum(monto) from traspasos t where t.orden = p.orden and t.a = p.tecnico and t.legalizacion_a is null),0)::int as traspaso_recibido,
  coalesce((select sum(monto) from traspasos t where t.orden = p.orden and t.de = p.tecnico and t.legalizacion_de is null),0)::int as traspaso_entregado,
  coalesce((select sum(monto) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico and r.legalizacion_id is null),0)::int as reportado,
  coalesce((select sum(aprobado) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico and r.legalizacion_id is null),0)::int as aprobado,
  coalesce((select sum(monto) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico and r.legalizacion_id is null and r.estado = 'pendiente'),0)::int as por_revisar,
  coalesce((select sum(monto) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico and r.legalizacion_id is null and r.estado = 'rechazado'),0)::int as rechazado,
  (select o.responsable = p.tecnico from ordenes o where o.num = p.orden) as es_responsable
from pares p
where p.tecnico = auth.uid() or es_admin();

-- ---------- Legalizar: cierra el ciclo de un técnico en una orden ----------
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
  select coalesce(sum(monto),0), coalesce(sum(aprobado),0), count(*), min(fecha_gasto), max(fecha_gasto)
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
    select id, case when estado = 'rechazado' then 'Legalizado como NO aprobado (rechazado sin corregir)' else 'Legalizado' end
    from reportes where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  update reportes set legalizacion_id = v_id where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  update consignaciones set legalizacion_id = v_id where orden = p_orden and tecnico = p_tecnico and legalizacion_id is null;
  update traspasos set legalizacion_a = v_id where orden = p_orden and a = p_tecnico and legalizacion_a is null;
  update traspasos set legalizacion_de = v_id where orden = p_orden and de = p_tecnico and legalizacion_de is null;
  return v_id;
end $$;
revoke execute on function public.legalizar(text, uuid, date, text, text, text) from anon;
grant execute on function public.legalizar(text, uuid, date, text, text, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.legalizaciones;
exception when others then null; end $$;
