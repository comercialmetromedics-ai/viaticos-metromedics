-- =====================================================================
--  Migración 003: topes base por concepto + hotel a 90.000
-- =====================================================================
alter table public.conceptos add column if not exists tope_base integer check (tope_base is null or tope_base >= 0);

update public.conceptos set tope_base = v.valor
from (values ('desayuno',10000),('almuerzo',15000),('cena',15000),('transporte',25000),('hotel',90000)) as v(id, valor)
where conceptos.id = v.id;

-- Hotel a 90.000 en todas las ciudades actuales
insert into public.topes (concepto_id, ciudad_id, valor)
select 'hotel', c.id, 90000 from public.ciudades c
on conflict (concepto_id, ciudad_id) do update set valor = excluded.valor;

-- Crear ciudad con sus topes en un solo paso.
-- p_topes: {"desayuno": 10000, "hotel": null, ...}; si p_topes es null se copian los topes base.
create or replace function public.crear_ciudad(p_nombre text, p_topes jsonb default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_id int;
begin
  if not es_admin() then raise exception 'Solo un administrador puede crear ciudades.'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Escribe el nombre de la ciudad.'; end if;
  insert into ciudades (nombre, orden) values (trim(p_nombre), 50) returning id into v_id;
  insert into topes (concepto_id, ciudad_id, valor)
  select k.id, v_id,
         case when p_topes is null then k.tope_base
              when p_topes ? k.id then nullif(p_topes->>k.id, '')::int
              else k.tope_base end
  from conceptos k;
  return v_id;
end $$;
revoke all on function public.crear_ciudad(text, jsonb) from public, anon;
grant execute on function public.crear_ciudad(text, jsonb) to authenticated;

-- Copiar los topes base a una ciudad existente
create or replace function public.aplicar_topes_base(p_ciudad int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo un administrador puede cambiar topes.'; end if;
  insert into topes (concepto_id, ciudad_id, valor)
  select k.id, p_ciudad, k.tope_base from conceptos k
  on conflict (concepto_id, ciudad_id) do update set valor = excluded.valor;
end $$;
revoke all on function public.aplicar_topes_base(int) from public, anon;
grant execute on function public.aplicar_topes_base(int) to authenticated;
