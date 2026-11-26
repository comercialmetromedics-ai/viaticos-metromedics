-- =====================================================================
--  Viáticos de campo · Metromedics S.A.S
--  Esquema de base de datos para Supabase (PostgreSQL)
--  Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
--  Se puede ejecutar una sola vez sobre un proyecto nuevo.
-- =====================================================================

-- ---------- Perfiles de usuario ----------
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  email text,
  rol text not null default 'tecnico' check (rol in ('tecnico','admin')),
  activo boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'admin' and activo)
$$;

create or replace function public.es_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo)
$$;

-- Al registrarse un usuario se crea su perfil (inactivo hasta que el administrador lo active)
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'),''), split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- ---------- Catálogos ----------
create table public.ciudades (
  id serial primary key,
  nombre text not null unique,
  orden int not null default 0,
  activo boolean not null default true
);

create table public.conceptos (
  id text primary key,
  nombre text not null,
  unidad text not null default 'por gasto',
  subtipos text[] not null default '{}',
  requiere_descripcion boolean not null default false,
  por_noche boolean not null default false,
  activo boolean not null default true,
  orden int not null default 0
);

create table public.topes (
  concepto_id text not null references public.conceptos(id) on delete cascade,
  ciudad_id int not null references public.ciudades(id) on delete cascade,
  valor integer check (valor is null or valor >= 0),
  primary key (concepto_id, ciudad_id)
);

create table public.config (
  id int primary key default 1 check (id = 1),
  lim_lv time not null default '20:00',
  lim_sab time not null default '11:00',
  lim_dom time not null default '20:00',
  avisos int[] not null default '{60,15}',
  politica text not null default 'marcar' check (politica in ('marcar','bloquear')),
  zona text not null default 'America/Bogota'
);

create table public.habilitaciones (
  tecnico uuid not null references public.perfiles(id) on delete cascade,
  fecha date not null,
  creado_por uuid default auth.uid(),
  primary key (tecnico, fecha)
);

-- ---------- Órdenes de servicio ----------
create table public.ordenes (
  num text primary key check (num ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  cliente text not null check (length(trim(cliente)) > 1),
  ciudad_id int not null references public.ciudades(id),
  creada_por uuid references public.perfiles(id) default auth.uid(),
  responsable uuid not null references public.perfiles(id),
  created_at timestamptz not null default now()
);

-- El número inicial de la orden es único (4120-CAL-MMCS y 4120-MTO-MMCS no pueden coexistir)
create unique index ordenes_numero_unico on public.ordenes ((substring(num from '^[0-9]+')));

-- ---------- Reportes de gasto ----------
create table public.reportes (
  id bigint generated always as identity primary key,
  orden text not null references public.ordenes(num) on update cascade,
  tecnico uuid not null references public.perfiles(id) default auth.uid(),
  fecha_gasto date not null,
  enviado_at timestamptz not null default now(),
  concepto_id text not null references public.conceptos(id),
  subtipo text,
  descripcion text,
  noches int not null default 1 check (noches >= 1),
  monto integer not null check (monto > 0),
  factura_electronica boolean not null,
  soporte_path text not null,
  rut_path text,
  observaciones text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','parcial','rechazado')),
  aprobado integer,
  motivo text,
  reenvios int not null default 0,
  extemporaneo boolean not null default false,
  revisado_por uuid references public.perfiles(id),
  revisado_at timestamptz,
  constraint rut_si_no_es_electronica check (factura_electronica or rut_path is not null)
);
create index on public.reportes (estado);
create index on public.reportes (tecnico);
create index on public.reportes (orden);
create index on public.reportes (fecha_gasto);

create table public.historial (
  id bigint generated always as identity primary key,
  reporte_id bigint not null references public.reportes(id) on delete cascade,
  at timestamptz not null default now(),
  usuario uuid default auth.uid(),
  texto text not null
);
create index on public.historial (reporte_id);

-- ---------- Dinero entregado ----------
create table public.consignaciones (
  id bigint generated always as identity primary key,
  orden text not null references public.ordenes(num) on update cascade,
  tecnico uuid references public.perfiles(id),
  fecha date not null,
  monto integer not null check (monto > 0),
  medio text not null default 'Transferencia',
  nota text,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.traspasos (
  id bigint generated always as identity primary key,
  orden text not null references public.ordenes(num) on update cascade,
  de uuid not null references public.perfiles(id),
  a uuid not null references public.perfiles(id),
  fecha date not null,
  monto integer not null default 0 check (monto >= 0),
  nota text,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- =====================================================================
--  Funciones de negocio
-- =====================================================================

-- Fecha de hoy en Colombia
create or replace function public.hoy_local() returns date
language sql stable set search_path = public as $$
  select (now() at time zone (select zona from config where id = 1))::date
$$;

-- Momento límite para reportar los gastos de una fecha (según el día de la semana)
create or replace function public.limite_reporte(p_fecha date) returns timestamptz
language sql stable set search_path = public as $$
  select (p_fecha + case extract(dow from p_fecha)
                      when 6 then c.lim_sab
                      when 0 then c.lim_dom
                      else c.lim_lv end) at time zone c.zona
  from config c where c.id = 1
$$;

-- Tope aplicable a un gasto (por noche en hotel)
create or replace function public.tope_de(p_concepto text, p_orden text, p_noches int) returns integer
language sql stable set search_path = public as $$
  select t.valor * case when c.por_noche then greatest(coalesce(p_noches,1),1) else 1 end
  from ordenes o
  join topes t on t.ciudad_id = o.ciudad_id and t.concepto_id = p_concepto
  join conceptos c on c.id = p_concepto
  where o.num = p_orden
$$;

-- Validación común de un gasto (concepto, descripción, tipo)
create or replace function public.validar_gasto(p_concepto text, p_subtipo text, p_descripcion text, p_fecha date) returns void
language plpgsql stable set search_path = public as $$
declare c conceptos;
begin
  select * into c from conceptos where id = p_concepto and activo;
  if not found then raise exception 'Concepto no válido'; end if;
  if c.requiere_descripcion and coalesce(trim(p_descripcion),'') = '' then
    raise exception 'Describe el gasto (%).', c.nombre; end if;
  if array_length(c.subtipos,1) > 0 and coalesce(p_subtipo,'') = '' then
    raise exception 'Selecciona el tipo de %.', lower(c.nombre); end if;
  if p_fecha > hoy_local() then raise exception 'La fecha del gasto no puede ser futura.'; end if;
end $$;

-- Antes de guardar un reporte nuevo: completa y valida
create or replace function public.antes_de_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_resp uuid; v_pol text;
begin
  if not es_activo() then raise exception 'Tu usuario no está activo.'; end if;
  new.tecnico := auth.uid();
  new.enviado_at := now();
  new.estado := 'pendiente'; new.aprobado := null; new.motivo := null;
  new.reenvios := 0; new.revisado_por := null; new.revisado_at := null;
  select responsable into v_resp from ordenes where num = new.orden;
  if v_resp is null then raise exception 'La orden % no existe.', new.orden; end if;
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
create trigger reporte_nuevo before insert on public.reportes
  for each row execute function public.antes_de_reporte();

create or replace function public.despues_de_reporte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into historial (reporte_id, usuario, texto)
  values (new.id, new.tecnico, case when new.extemporaneo then 'Enviado (extemporáneo)' else 'Enviado' end);
  return new;
end $$;
create trigger reporte_historial after insert on public.reportes
  for each row execute function public.despues_de_reporte();

-- Técnico corrige y reenvía un reporte rechazado
create or replace function public.reenviar_reporte(
  p_id bigint, p_fecha date, p_concepto text, p_subtipo text, p_descripcion text, p_noches int,
  p_monto int, p_fe boolean, p_soporte text, p_rut text, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare r reportes;
begin
  select * into r from reportes where id = p_id for update;
  if not found or r.tecnico <> auth.uid() then raise exception 'Reporte no encontrado.'; end if;
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

-- Administrador decide: aprobar | parcial | rechazar
create or replace function public.decidir_reporte(p_id bigint, p_accion text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r reportes; v_tope int;
begin
  if not es_admin() then raise exception 'Solo el administrador puede revisar reportes.'; end if;
  select * into r from reportes where id = p_id for update;
  if not found then raise exception 'Reporte no encontrado.'; end if;
  if r.estado <> 'pendiente' then raise exception 'Este reporte ya fue revisado.'; end if;
  if p_accion = 'aprobar' then
    update reportes set estado = 'aprobado', aprobado = r.monto, motivo = null, revisado_por = auth.uid(), revisado_at = now() where id = p_id;
    insert into historial (reporte_id, texto) values (p_id, 'Aprobado');
  elsif p_accion = 'parcial' then
    v_tope := tope_de(r.concepto_id, r.orden, r.noches);
    if v_tope is null or v_tope >= r.monto then raise exception 'Este gasto no supera el tope; apruébalo completo.'; end if;
    update reportes set estado = 'parcial', aprobado = v_tope, motivo = null, revisado_por = auth.uid(), revisado_at = now() where id = p_id;
    insert into historial (reporte_id, texto) values (p_id, 'Aprobado hasta el tope: ' || v_tope);
  elsif p_accion = 'rechazar' then
    if coalesce(trim(p_motivo),'') = '' then raise exception 'Escribe el motivo del rechazo.'; end if;
    update reportes set estado = 'rechazado', aprobado = null, motivo = trim(p_motivo), revisado_por = auth.uid(), revisado_at = now() where id = p_id;
    insert into historial (reporte_id, texto) values (p_id, 'Rechazado: ' || trim(p_motivo));
  else
    raise exception 'Acción no válida.';
  end if;
end $$;

-- Las consignaciones van siempre al responsable actual de la orden
create or replace function public.antes_de_consignacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select responsable into new.tecnico from ordenes where num = new.orden;
  if new.tecnico is null then raise exception 'La orden % no existe.', new.orden; end if;
  new.creado_por := auth.uid();
  return new;
end $$;
create trigger consignacion_nueva before insert on public.consignaciones
  for each row execute function public.antes_de_consignacion();

-- Cambio de responsable con traspaso de saldo
create or replace function public.cambiar_responsable(p_orden text, p_nuevo uuid, p_monto int, p_fecha date, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actual uuid;
begin
  if not es_admin() then raise exception 'Solo el administrador puede cambiar el responsable.'; end if;
  select responsable into v_actual from ordenes where num = p_orden for update;
  if v_actual is null then raise exception 'La orden no existe.'; end if;
  if v_actual = p_nuevo then raise exception 'El nuevo responsable debe ser distinto al actual.'; end if;
  if not exists (select 1 from perfiles where id = p_nuevo and activo) then raise exception 'El técnico no está activo.'; end if;
  insert into traspasos (orden, de, a, fecha, monto, nota, creado_por)
  values (p_orden, v_actual, p_nuevo, coalesce(p_fecha, hoy_local()), greatest(coalesce(p_monto,0),0), nullif(trim(p_nota),''), auth.uid());
  update ordenes set responsable = p_nuevo where num = p_orden;
end $$;

-- Anular un traspaso (si la orden sigue con quien lo recibió, vuelve al anterior)
create or replace function public.anular_traspaso(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t traspasos;
begin
  if not es_admin() then raise exception 'Solo el administrador.'; end if;
  delete from traspasos where id = p_id returning * into t;
  if not found then raise exception 'Traspaso no encontrado.'; end if;
  update ordenes set responsable = t.de where num = t.orden and responsable = t.a;
end $$;

-- Saldos por orden y técnico
create or replace view public.saldos with (security_invoker = true) as
with pares as (
  select orden, tecnico from consignaciones
  union select orden, tecnico from reportes
  union select orden, de from traspasos
  union select orden, a from traspasos
  union select num, responsable from ordenes
)
select p.orden, p.tecnico,
  coalesce((select sum(monto) from consignaciones c where c.orden = p.orden and c.tecnico = p.tecnico),0)::int as consignado,
  coalesce((select sum(monto) from traspasos t where t.orden = p.orden and t.a = p.tecnico),0)::int as traspaso_recibido,
  coalesce((select sum(monto) from traspasos t where t.orden = p.orden and t.de = p.tecnico),0)::int as traspaso_entregado,
  coalesce((select sum(monto) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico),0)::int as reportado,
  coalesce((select sum(aprobado) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico),0)::int as aprobado,
  coalesce((select sum(monto) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico and r.estado = 'pendiente'),0)::int as por_revisar,
  coalesce((select sum(monto) from reportes r where r.orden = p.orden and r.tecnico = p.tecnico and r.estado = 'rechazado'),0)::int as rechazado,
  (select o.responsable = p.tecnico from ordenes o where o.num = p.orden) as es_responsable
from pares p
where p.tecnico = auth.uid() or es_admin();

-- =====================================================================
--  Seguridad (Row Level Security)
-- =====================================================================
alter table public.perfiles enable row level security;
alter table public.ciudades enable row level security;
alter table public.conceptos enable row level security;
alter table public.topes enable row level security;
alter table public.config enable row level security;
alter table public.habilitaciones enable row level security;
alter table public.ordenes enable row level security;
alter table public.reportes enable row level security;
alter table public.historial enable row level security;
alter table public.consignaciones enable row level security;
alter table public.traspasos enable row level security;

create policy "ver perfiles" on public.perfiles for select to authenticated using (true);
create policy "admin edita perfiles" on public.perfiles for update to authenticated using (es_admin()) with check (es_admin());

create policy "ver ciudades" on public.ciudades for select to authenticated using (true);
create policy "admin ciudades" on public.ciudades for all to authenticated using (es_admin()) with check (es_admin());
create policy "ver conceptos" on public.conceptos for select to authenticated using (true);
create policy "admin conceptos" on public.conceptos for all to authenticated using (es_admin()) with check (es_admin());
create policy "ver topes" on public.topes for select to authenticated using (true);
create policy "admin topes" on public.topes for all to authenticated using (es_admin()) with check (es_admin());
create policy "ver config" on public.config for select to authenticated using (true);
create policy "admin config" on public.config for update to authenticated using (es_admin()) with check (es_admin());

create policy "ver habilitaciones" on public.habilitaciones for select to authenticated using (tecnico = auth.uid() or es_admin());
create policy "admin habilitaciones" on public.habilitaciones for all to authenticated using (es_admin()) with check (es_admin());

create policy "ver ordenes" on public.ordenes for select to authenticated using (es_activo());
create policy "crear orden" on public.ordenes for insert to authenticated
  with check (es_activo() and creada_por = auth.uid() and responsable = auth.uid());
create policy "admin ordenes" on public.ordenes for update to authenticated using (es_admin()) with check (es_admin());

create policy "ver reportes" on public.reportes for select to authenticated using (tecnico = auth.uid() or es_admin());
create policy "crear reporte" on public.reportes for insert to authenticated with check (es_activo());
create policy "admin borra reportes" on public.reportes for delete to authenticated using (es_admin());

create policy "ver historial" on public.historial for select to authenticated
  using (exists (select 1 from reportes r where r.id = reporte_id));

create policy "ver consignaciones" on public.consignaciones for select to authenticated using (tecnico = auth.uid() or es_admin());
create policy "admin consignaciones" on public.consignaciones for insert to authenticated with check (es_admin());
create policy "admin anula consignaciones" on public.consignaciones for delete to authenticated using (es_admin());

create policy "ver traspasos" on public.traspasos for select to authenticated using (de = auth.uid() or a = auth.uid() or es_admin());

-- Permisos explícitos para la API (no dependen de la configuración del proyecto)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ---------- Archivos (facturas y RUT) ----------
insert into storage.buckets (id, name, public) values ('soportes','soportes', false) on conflict (id) do nothing;
create policy "subir soportes propios" on storage.objects for insert to authenticated
  with check (bucket_id = 'soportes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ver soportes" on storage.objects for select to authenticated
  using (bucket_id = 'soportes' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin()));

-- ---------- Tiempo real (avisos instantáneos en la app) ----------
alter publication supabase_realtime add table public.reportes, public.consignaciones, public.traspasos, public.ordenes;

-- =====================================================================
--  Datos iniciales (se pueden editar luego desde Ajustes)
-- =====================================================================
insert into public.config (id) values (1);
insert into public.ciudades (nombre, orden) values
  ('Bogotá',1),('Medellín',2),('Cali',3),('Barranquilla',4),('Otros municipios',99);
insert into public.conceptos (id, nombre, unidad, subtipos, requiere_descripcion, por_noche, orden) values
  ('desayuno','Desayuno','por comida','{}',false,false,1),
  ('almuerzo','Almuerzo','por comida','{}',false,false,2),
  ('cena','Cena','por comida','{}',false,false,3),
  ('hotel','Hotel','por noche','{}',false,true,4),
  ('transporte','Desplazamiento','por trayecto','{"Taxi","InDrive","Uber / DiDi","Bus intermunicipal","Peaje o parqueadero"}',false,false,5),
  ('repuestos','Compra de repuestos','por compra','{}',true,false,6),
  ('otro','Otro','por gasto','{}',true,false,99);
-- Topes de ejemplo: AJÚSTALOS en la app (Ajustes)
insert into public.topes (concepto_id, ciudad_id, valor)
select c.id, ci.id, v.valor
from (values
  ('desayuno','Bogotá',20000),('desayuno','Medellín',20000),('desayuno','Cali',18000),('desayuno','Barranquilla',18000),('desayuno','Otros municipios',15000),
  ('almuerzo','Bogotá',30000),('almuerzo','Medellín',28000),('almuerzo','Cali',25000),('almuerzo','Barranquilla',25000),('almuerzo','Otros municipios',22000),
  ('cena','Bogotá',28000),('cena','Medellín',26000),('cena','Cali',24000),('cena','Barranquilla',24000),('cena','Otros municipios',20000),
  ('hotel','Bogotá',180000),('hotel','Medellín',170000),('hotel','Cali',150000),('hotel','Barranquilla',160000),('hotel','Otros municipios',120000),
  ('transporte','Bogotá',40000),('transporte','Medellín',35000),('transporte','Cali',30000),('transporte','Barranquilla',30000),('transporte','Otros municipios',25000)
) as v(concepto, ciudad, valor)
join public.conceptos c on c.id = v.concepto
join public.ciudades ci on ci.nombre = v.ciudad;

-- =====================================================================
--  DESPUÉS de registrarte en la app, conviértete en administrador con:
--  update public.perfiles set rol = 'admin', activo = true where email = 'TU_CORREO@metromedicslab.com';
-- =====================================================================
