-- =====================================================================
--  Migración 007: módulo Evidencias de calibración
--   inventarios: un Excel por orden (el original queda en storage)
--   equipos:     una fila por equipo del Excel (o agregado en campo) con sus 2 fotos
-- =====================================================================
create table if not exists public.inventarios (
  orden text primary key references public.ordenes(num) on update cascade,
  archivo_path text not null,
  nombre_archivo text,
  hoja text not null,
  fila_encabezado int not null check (fila_encabezado >= 1),
  col_codigos int[] not null default '{}',       -- columnas de código interno (placa, activo fijo…)
  col_serie int check (col_serie >= 1),
  col_desc int[] not null default '{}',
  ultima_col int not null check (ultima_col >= 1),
  encabezados text[] not null default '{}',
  cargado_por uuid not null references public.perfiles(id) default auth.uid(),
  cargado_at timestamptz not null default now(),
  check (cardinality(col_codigos) > 0 or col_serie is not null)
);

create table if not exists public.equipos (
  id bigint generated always as identity primary key,
  orden text not null references public.inventarios(orden) on update cascade on delete cascade,
  fila int,                                   -- fila del Excel; null = agregado en campo
  codigo text, serie text, descripcion text,
  codigos text[] not null default '{}',       -- todos los códigos internos del equipo
  datos text[] not null default '{}',         -- valores de la fila (mismo orden que encabezados)
  agregado_por uuid references public.perfiles(id),
  agregado_at timestamptz,
  foto_equipo text, foto_sticker text, nota text,
  evidencia_por uuid references public.perfiles(id),
  evidencia_at timestamptz,
  check (coalesce(trim(codigo),'') <> '' or coalesce(trim(serie),'') <> '' or fila is not null)
);
create index if not exists equipos_orden on public.equipos(orden);
create index if not exists equipos_serie on public.equipos(orden, upper(serie));

alter table public.inventarios enable row level security;
alter table public.equipos enable row level security;
drop policy if exists "ver inventarios" on public.inventarios;
create policy "ver inventarios" on public.inventarios for select to authenticated using (public.es_activo());
drop policy if exists "ver equipos" on public.equipos;
create policy "ver equipos" on public.equipos for select to authenticated using (public.es_activo());
grant select on public.inventarios, public.equipos to authenticated;

-- Cargar el inventario (responsable de la orden o administrador; una sola vez)
create or replace function public.cargar_inventario(
  p_orden text, p_archivo text, p_nombre text, p_hoja text, p_fila int,
  p_col_codigos int[], p_col_serie int, p_col_desc int[], p_ultima int, p_encabezados text[], p_equipos jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare o ordenes; v_n int;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  select * into o from ordenes where num = p_orden;
  if not found then raise exception 'La orden % no existe.', p_orden; end if;
  if o.archivada then raise exception 'La orden % está archivada.', p_orden; end if;
  if o.responsable <> auth.uid() and not es_admin() then
    raise exception 'Solo el responsable de la orden o un administrador puede cargar el inventario.'; end if;
  if exists (select 1 from inventarios where orden = p_orden) then
    raise exception 'La orden % ya tiene inventario cargado.', p_orden; end if;
  if split_part(p_archivo,'/',1) <> auth.uid()::text then raise exception 'Archivo no válido.'; end if;
  if jsonb_array_length(coalesce(p_equipos,'[]')) = 0 then raise exception 'El inventario no tiene equipos.'; end if;
  insert into inventarios (orden, archivo_path, nombre_archivo, hoja, fila_encabezado, col_codigos, col_serie, col_desc, ultima_col, encabezados)
  values (p_orden, p_archivo, p_nombre, p_hoja, p_fila, coalesce(p_col_codigos,'{}'), p_col_serie, coalesce(p_col_desc,'{}'), p_ultima, coalesce(p_encabezados,'{}'));
  insert into equipos (orden, fila, codigo, serie, descripcion, codigos, datos)
  select p_orden, (e->>'fila')::int, nullif(trim(e->>'codigo'),''), nullif(trim(e->>'serie'),''), nullif(trim(e->>'descripcion'),''),
         coalesce(array(select jsonb_array_elements_text(e->'codigos')), '{}'),
         coalesce(array(select jsonb_array_elements_text(e->'datos')), '{}')
  from jsonb_array_elements(p_equipos) e;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Borrar el inventario (solo admin y solo si aún no tiene evidencias)
create or replace function public.borrar_inventario(p_orden text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo un administrador puede borrar el inventario.'; end if;
  if exists (select 1 from equipos where orden = p_orden and (foto_equipo is not null or foto_sticker is not null)) then
    raise exception 'El inventario ya tiene evidencias cargadas; no se puede borrar.'; end if;
  delete from inventarios where orden = p_orden;
end $$;

-- Agregar en campo un equipo que no está en el inventario
create or replace function public.agregar_equipo(p_orden text, p_codigo text, p_serie text, p_descripcion text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  if not exists (select 1 from inventarios where orden = p_orden) then raise exception 'La orden no tiene inventario.'; end if;
  if coalesce(trim(p_codigo),'') = '' and coalesce(trim(p_serie),'') = '' then
    raise exception 'Escribe el código interno o el número de serie.'; end if;
  if coalesce(trim(p_descripcion),'') = '' then raise exception 'Describe el equipo (nombre, marca, modelo).'; end if;
  if exists (select 1 from equipos where orden = p_orden and
     ((nullif(trim(p_codigo),'') is not null and upper(trim(p_codigo)) in (select upper(trim(x)) from unnest(codigos) x)) or
      (nullif(trim(p_serie),'') is not null and upper(trim(serie)) = upper(trim(p_serie))))) then
    raise exception 'Ese equipo ya está en el inventario.'; end if;
  insert into equipos (orden, codigo, serie, descripcion, codigos, agregado_por, agregado_at)
  values (p_orden, nullif(trim(p_codigo),''), nullif(trim(p_serie),''), trim(p_descripcion),
          case when nullif(trim(p_codigo),'') is null then '{}' else array[trim(p_codigo)] end, auth.uid(), now())
  returning id into v_id;
  return v_id;
end $$;

-- Cargar (o reemplazar) la evidencia de un equipo
create or replace function public.cargar_evidencia(p_id bigint, p_foto_equipo text, p_foto_sticker text, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare e equipos;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  select * into e from equipos where id = p_id for update;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if exists (select 1 from ordenes where num = e.orden and archivada) then raise exception 'La orden está archivada.'; end if;
  if p_foto_equipo is null or p_foto_sticker is null then raise exception 'Faltan fotos: se necesita la del equipo y la del sticker.'; end if;
  -- cada foto debe ser nueva (carpeta propia) o la misma que ya tenía el equipo
  if (split_part(p_foto_equipo,'/',1) <> auth.uid()::text and p_foto_equipo is distinct from e.foto_equipo)
     or (split_part(p_foto_sticker,'/',1) <> auth.uid()::text and p_foto_sticker is distinct from e.foto_sticker) then
    raise exception 'Archivo no válido.'; end if;
  update equipos set foto_equipo = p_foto_equipo, foto_sticker = p_foto_sticker, nota = nullif(trim(p_nota),''),
         evidencia_por = auth.uid(), evidencia_at = now()
   where id = p_id;
end $$;

revoke all on function public.cargar_inventario(text, text, text, text, int, int[], int, int[], int, text[], jsonb) from public, anon;
revoke all on function public.borrar_inventario(text) from public, anon;
revoke all on function public.agregar_equipo(text, text, text, text) from public, anon;
revoke all on function public.cargar_evidencia(bigint, text, text, text) from public, anon;
grant execute on function public.cargar_inventario(text, text, text, text, int, int[], int, int[], int, text[], jsonb) to authenticated;
grant execute on function public.borrar_inventario(text) to authenticated;
grant execute on function public.agregar_equipo(text, text, text, text) to authenticated;
grant execute on function public.cargar_evidencia(bigint, text, text, text) to authenticated;

-- Fotos de evidencia e inventarios: visibles para todo usuario activo ({uid}/evi/... y {uid}/inv/...)
drop policy if exists "ver evidencias" on storage.objects;
create policy "ver evidencias" on storage.objects for select to authenticated
  using (bucket_id = 'soportes' and (storage.foldername(name))[2] in ('evi','inv') and public.es_activo());

do $$ begin
  alter publication supabase_realtime add table public.equipos;
exception when others then null; end $$;

-- Avance por orden
create or replace view public.avance_inventarios with (security_invoker = true) as
select i.orden, count(e.id)::int as total,
       (count(e.id) filter (where e.foto_equipo is not null and e.foto_sticker is not null))::int as con_evidencia,
       (count(e.id) filter (where e.fila is null))::int as agregados,
       max(e.evidencia_at) as ultima
from public.inventarios i left join public.equipos e on e.orden = i.orden
group by i.orden;
grant select on public.avance_inventarios to authenticated;
