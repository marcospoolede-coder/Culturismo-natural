-- Aprobacion manual de acceso, Cuaderno de Fuerza
-- Pegalo entero en Supabase, SQL Editor, y dale a Run.
-- Cualquiera puede registrarse, pero no guarda nada hasta que lo apruebes.

create table if not exists public.acceso (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  estado     text not null default 'pendiente'
             check (estado in ('pendiente','aprobado','denegado')),
  solicitado timestamptz not null default now(),
  decidido   timestamptz,
  nota       text
);

alter table public.acceso enable row level security;

-- Cada uno ve solo su propia fila, para que la app pueda decirle como esta.
-- Nadie puede cambiarla: aprobar y denegar se hace solo desde el panel.
drop policy if exists "ver lo propio" on public.acceso;
create policy "ver lo propio" on public.acceso
  for select using (auth.uid() = user_id);

-- Al registrarse, la solicitud se crea sola en pendiente.
create or replace function public.nueva_solicitud()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.acceso (user_id, email) values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists crea_solicitud on auth.users;
create trigger crea_solicitud
  after insert on auth.users
  for each row execute function public.nueva_solicitud();

-- Los que ya tenian cuenta entran aprobados, para no echar a nadie.
insert into public.acceso (user_id, email, estado, decidido)
select u.id, u.email, 'aprobado', now() from auth.users u
on conflict (user_id) do nothing;

-- El candado. Se consulta con una funcion para que la propia tabla acceso
-- no vuelva a pasar por sus politicas y se muerda la cola.
create or replace function public.esta_aprobado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.acceso a
    where a.user_id = auth.uid() and a.estado = 'aprobado'
  );
$$;

drop policy if exists "leer lo propio"       on public.entrenamientos;
drop policy if exists "crear lo propio"      on public.entrenamientos;
drop policy if exists "actualizar lo propio" on public.entrenamientos;
drop policy if exists "borrar lo propio"     on public.entrenamientos;

create policy "leer lo propio" on public.entrenamientos
  for select using (auth.uid() = user_id and public.esta_aprobado());

create policy "crear lo propio" on public.entrenamientos
  for insert with check (auth.uid() = user_id and public.esta_aprobado());

create policy "actualizar lo propio" on public.entrenamientos
  for update using      (auth.uid() = user_id and public.esta_aprobado())
           with check   (auth.uid() = user_id and public.esta_aprobado());

create policy "borrar lo propio" on public.entrenamientos
  for delete using (auth.uid() = user_id and public.esta_aprobado());

-- ------------------------------------------------------------------
-- El dia a dia, copia la linea que necesites
--
-- Quien esta esperando:
--   select email, solicitado from public.acceso
--   where estado = 'pendiente' order by solicitado;
--
-- Aprobar a alguien:
--   update public.acceso set estado = 'aprobado', decidido = now()
--   where lower(email) = lower('correo@ejemplo.com');
--
-- Denegar o retirar el acceso:
--   update public.acceso set estado = 'denegado', decidido = now()
--   where lower(email) = lower('correo@ejemplo.com');
--
-- Todo el mundo, con su estado y si ha entrenado:
--   select a.email, a.estado, a.solicitado, e.actualizado as ultimo_entreno
--   from public.acceso a
--   left join public.entrenamientos e on e.user_id = a.user_id
--   order by a.solicitado desc;
-- ------------------------------------------------------------------
