-- Alimentacion, Cuaderno de Fuerza: comidas, gasto, peso, Whoop y Apple Salud.
-- Pegalo entero en Supabase, SQL Editor, y dale a Run. Se puede repetir sin miedo.
-- Necesita antes aprobacion.sql (tabla acceso y funcion esta_aprobado).

-- ------------------------------------------------------------------
-- 1. El plan de cada persona
--   gratis : apunta comidas a mano. Sin foto.
--   pago   : foto y texto con IA por la API de Claude (Edge Function analiza-comida).
--   propio : foto y texto con IA por la suscripcion de Claude de Marcos, desde su Mac.
alter table public.acceso add column if not exists plan text not null default 'gratis';
alter table public.acceso drop constraint if exists acceso_plan_check;
alter table public.acceso add constraint acceso_plan_check
  check (plan in ('gratis','pago','propio'));

create or replace function public.mi_plan()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select plan from public.acceso where user_id = auth.uid()), 'gratis');
$$;

-- ------------------------------------------------------------------
-- 2. Comidas
create table if not exists public.comidas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fecha       date not null,
  hora        text,
  origen      text not null check (origen in ('foto','texto','manual')),
  foto        text,
  descripcion text,
  estado      text not null default 'hecha'
              check (estado in ('pendiente','analizando','hecha','error')),
  via         text check (via in ('api','suscripcion')),
  items       jsonb not null default '[]'::jsonb,
  kcal        integer,
  prot        integer,
  carb        integer,
  grasa       integer,
  confianza   text,
  pregunta    text,
  nota        text,
  creado      timestamptz not null default now(),
  analizado   timestamptz
);
create index if not exists comidas_usuario_fecha on public.comidas (user_id, fecha);
create index if not exists comidas_pendientes on public.comidas (estado) where estado = 'pendiente';

alter table public.comidas enable row level security;
drop policy if exists "comidas propias" on public.comidas;
create policy "comidas propias" on public.comidas
  for all using (auth.uid() = user_id and public.esta_aprobado())
  with check (auth.uid() = user_id and public.esta_aprobado());

-- ------------------------------------------------------------------
-- 3. Gasto de cada dia, por fuente (whoop, apple o manual)
create table if not exists public.gasto_diario (
  user_id     uuid not null references auth.users(id) on delete cascade,
  fecha       date not null,
  fuente      text not null check (fuente in ('whoop','apple','manual')),
  total       integer,
  activa      integer,
  basal       integer,
  pasos       integer,
  parcial     boolean not null default false,
  actualizado timestamptz not null default now(),
  primary key (user_id, fecha, fuente)
);
alter table public.gasto_diario enable row level security;
drop policy if exists "ver gasto propio" on public.gasto_diario;
create policy "ver gasto propio" on public.gasto_diario
  for select using (auth.uid() = user_id and public.esta_aprobado());
-- a mano solo se escribe la fuente manual; whoop y apple las escriben las funciones
drop policy if exists "gasto manual propio" on public.gasto_diario;
create policy "gasto manual propio" on public.gasto_diario
  for all using (auth.uid() = user_id and fuente = 'manual' and public.esta_aprobado())
  with check (auth.uid() = user_id and fuente = 'manual' and public.esta_aprobado());

-- ------------------------------------------------------------------
-- 4. Peso corporal, uno por dia
create table if not exists public.peso_corporal (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fecha       date not null,
  kg          numeric(5,2) not null check (kg between 25 and 300),
  fuente      text not null default 'manual',
  primary key (user_id, fecha)
);
alter table public.peso_corporal enable row level security;
drop policy if exists "peso propio" on public.peso_corporal;
create policy "peso propio" on public.peso_corporal
  for all using (auth.uid() = user_id and public.esta_aprobado())
  with check (auth.uid() = user_id and public.esta_aprobado());

-- ------------------------------------------------------------------
-- 5. Conexiones. Lo que la app puede ver: si esta conectado y el codigo
--    del atajo de Apple Salud. Los tokens de Whoop van aparte y la app no
--    los puede leer (tabla sin politicas: solo las Edge Functions).
create table if not exists public.integraciones (
  user_id     uuid not null references auth.users(id) on delete cascade,
  proveedor   text not null check (proveedor in ('whoop','apple')),
  token       text unique,
  ultima_sync timestamptz,
  detalle     text,
  creado      timestamptz not null default now(),
  primary key (user_id, proveedor)
);
alter table public.integraciones enable row level security;
drop policy if exists "ver conexiones propias" on public.integraciones;
create policy "ver conexiones propias" on public.integraciones
  for select using (auth.uid() = user_id);
drop policy if exists "quitar conexiones propias" on public.integraciones;
create policy "quitar conexiones propias" on public.integraciones
  for delete using (auth.uid() = user_id);

create table if not exists public.whoop_tokens (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  whoop_id    bigint,
  access      text not null,
  refresh     text not null,
  expira      timestamptz not null,
  bloqueo     timestamptz
);
alter table public.whoop_tokens enable row level security;

create table if not exists public.whoop_estados (
  estado      text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  creado      timestamptz not null default now()
);
alter table public.whoop_estados enable row level security;

-- Codigo personal para el atajo de Apple Salud. Se crea o se renueva desde la app.
create or replace function public.codigo_salud()
returns text language plpgsql security definer set search_path = public as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.esta_aprobado() then raise exception 'sin acceso'; end if;
  insert into public.integraciones (user_id, proveedor, token, detalle)
  values (auth.uid(), 'apple', t, 'esperando el primer envio')
  on conflict (user_id, proveedor) do update set token = excluded.token, detalle = excluded.detalle;
  return t;
end;
$$;

-- Al desconectar Whoop desde la app se borran sus tokens y sus datos.
create or replace function public.borra_whoop()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.whoop_tokens  where user_id = auth.uid();
  delete from public.integraciones where user_id = auth.uid() and proveedor = 'whoop';
  delete from public.gasto_diario  where user_id = auth.uid() and fuente = 'whoop';
end;
$$;

-- ------------------------------------------------------------------
-- 6. Fotos de las comidas: privadas, cada uno en su carpeta
insert into storage.buckets (id, name, public)
values ('comidas', 'comidas', false)
on conflict (id) do nothing;

drop policy if exists "fotos comidas subir" on storage.objects;
create policy "fotos comidas subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comidas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "fotos comidas ver" on storage.objects;
create policy "fotos comidas ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'comidas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "fotos comidas borrar" on storage.objects;
create policy "fotos comidas borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'comidas' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------------
-- 7. Whoop solo deja guardar copias el tiempo justo: se borran sus datos
--    de mas de 30 dias cada noche. Si pg_cron no esta activado, actívalo en
--    Database, Extensions, pg_cron, y vuelve a pasar este bloque.
create extension if not exists pg_cron;
select cron.unschedule('limpia-whoop') where exists (select 1 from cron.job where jobname = 'limpia-whoop');
select cron.schedule('limpia-whoop', '15 4 * * *',
  $$delete from public.gasto_diario where fuente = 'whoop' and fecha < current_date - 30;
    delete from public.whoop_estados where creado < now() - interval '1 hour';$$);

-- ------------------------------------------------------------------
-- El dia a dia, copia la linea que necesites
--
-- Dar la foto con IA por tu suscripcion (solo para ti):
--   update public.acceso set plan = 'propio' where lower(email) = lower('tu-correo@ejemplo.com');
--
-- Pasar a alguien a la version de pago:
--   update public.acceso set plan = 'pago' where lower(email) = lower('correo@ejemplo.com');
--
-- Quitarle la version de pago:
--   update public.acceso set plan = 'gratis' where lower(email) = lower('correo@ejemplo.com');
--
-- Cuantas fotos ha analizado cada uno este mes:
--   select a.email, c.via, count(*) from public.comidas c join public.acceso a using (user_id)
--   where c.origen <> 'manual' and c.creado > date_trunc('month', now())
--   group by 1, 2 order by 3 desc;
