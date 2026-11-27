-- =====================================================================
--  Migración 008: servicios propios del módulo Evidencias (independientes de las órdenes de viáticos)
-- =====================================================================
create table if not exists public.servicios (
  num text primary key check (num ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  cliente text not null check (length(trim(cliente)) > 1),
  ciudad_id int not null references public.ciudades(id),
  responsable uuid not null references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  archivado boolean not null default false
);
create unique index if not exists servicios_numero_unico on public.servicios ((substring(num from '^[0-9]+')));
alter table public.servicios enable row level security;
drop policy if exists "ver servicios" on public.servicios;
create policy "ver servicios" on public.servicios for select to authenticated using (public.es_activo());
drop policy if exists "admin edita servicios" on public.servicios;
create policy "admin edita servicios" on public.servicios for update to authenticated using (public.es_admin()) with check (public.es_admin());
grant select, update on public.servicios to authenticated;

-- Servicios para los inventarios que ya existan (tomados de la orden)
insert into public.servicios (num, cliente, ciudad_id, responsable, created_at)
select o.num, o.cliente, o.ciudad_id, o.responsable, o.created_at from public.ordenes o
where o.num in (select orden from public.inventarios)
on conflict (num) do nothing;

alter table public.inventarios drop constraint if exists inventarios_orden_fkey;
alter table public.inventarios add constraint inventarios_orden_fkey foreign key (orden) references public.servicios(num) on update cascade;

create or replace function public.crear_servicio(p_num text, p_cliente text, p_ciudad int) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  if exists (select 1 from servicios where num = p_num) then raise exception 'El servicio % ya existe; búscalo en la lista.', p_num; end if;
  insert into servicios (num, cliente, ciudad_id, responsable) values (p_num, trim(p_cliente), p_ciudad, auth.uid());
  return p_num;
end $$;
revoke all on function public.crear_servicio(text, text, int) from public, anon;
grant execute on function public.crear_servicio(text, text, int) to authenticated;

-- Las reglas de inventario y evidencias ahora miran el servicio
create or replace function public.cargar_inventario(
  p_orden text, p_archivo text, p_nombre text, p_hoja text, p_fila int,
  p_col_codigos int[], p_col_serie int, p_col_desc int[], p_ultima int, p_encabezados text[], p_equipos jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare s servicios; v_n int;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  select * into s from servicios where num = p_orden;
  if not found then raise exception 'El servicio % no existe.', p_orden; end if;
  if s.archivado then raise exception 'El servicio % está archivado.', p_orden; end if;
  if s.responsable <> auth.uid() and not es_admin() then
    raise exception 'Solo quien creó el servicio o un administrador puede cargar el inventario.'; end if;
  if exists (select 1 from inventarios where orden = p_orden) then
    raise exception 'El servicio % ya tiene inventario cargado.', p_orden; end if;
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

create or replace function public.agregar_equipo(p_orden text, p_codigo text, p_serie text, p_descripcion text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  if not exists (select 1 from inventarios where orden = p_orden) then raise exception 'El servicio no tiene inventario.'; end if;
  if exists (select 1 from servicios where num = p_orden and archivado) then raise exception 'El servicio está archivado.'; end if;
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

create or replace function public.cargar_evidencia(p_id bigint, p_foto_equipo text, p_foto_sticker text, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare e equipos;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  select * into e from equipos where id = p_id for update;
  if not found then raise exception 'Equipo no encontrado.'; end if;
  if exists (select 1 from servicios where num = e.orden and archivado) then raise exception 'El servicio está archivado.'; end if;
  if p_foto_equipo is null or p_foto_sticker is null then raise exception 'Faltan fotos: se necesita la del equipo y la del sticker.'; end if;
  if (split_part(p_foto_equipo,'/',1) <> auth.uid()::text and p_foto_equipo is distinct from e.foto_equipo)
     or (split_part(p_foto_sticker,'/',1) <> auth.uid()::text and p_foto_sticker is distinct from e.foto_sticker) then
    raise exception 'Archivo no válido.'; end if;
  update equipos set foto_equipo = p_foto_equipo, foto_sticker = p_foto_sticker, nota = nullif(trim(p_nota),''),
         evidencia_por = auth.uid(), evidencia_at = now()
   where id = p_id;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.servicios;
exception when others then null; end $$;
