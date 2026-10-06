-- Panel de control, Cuaderno de Fuerza
-- Pegalo entero en Supabase, SQL Editor, y dale a Run.
-- Corre DESPUES de aprobacion.sql.
--
-- Monta tres cosas:
--   1. Una tabla de visitas, para saber cuanta gente abre la app.
--   2. Una lista de administradores. Solo tu.
--   3. Una funcion que devuelve el panel, y que solo responde si eres admin.
--
-- La clave que usa la web es la publicable, la misma que ya esta en GitHub.
-- La seguridad no esta en esconder la clave: esta en que la funcion comprueba
-- quien pregunta. Si no eres admin, no devuelve nada.

-- ------------------------------------------------------------------
-- 1. Visitas
-- ------------------------------------------------------------------
create table if not exists public.visitas (
  user_id uuid not null references auth.users(id) on delete cascade,
  dia     date not null default current_date,
  n       int  not null default 0,
  primary key (user_id, dia)
);

alter table public.visitas enable row level security;

drop policy if exists "ve las mias" on public.visitas;
create policy "ve las mias" on public.visitas
  for select using (auth.uid() = user_id);

-- Cada persona suma su propia visita, nunca la de otro.
create or replace function public.visita()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.visitas (user_id, dia, n)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, dia) do update set n = public.visitas.n + 1;
end;
$$;
grant execute on function public.visita() to authenticated;

-- ------------------------------------------------------------------
-- 2. Quien es administrador
-- ------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nota    text
);
alter table public.admins enable row level security;
-- sin politicas: nadie la lee ni la escribe desde la app

insert into public.admins (user_id, nota)
select id, 'Marcos' from auth.users
where lower(email) in ('marcos@relevofamiliar.com', 'marcospoolede@gmail.com')
on conflict (user_id) do nothing;

-- Si ninguno de esos correos tiene cuenta todavia, registrate primero en la
-- app y vuelve a correr solo este insert.

-- ------------------------------------------------------------------
-- 3. El panel
-- ------------------------------------------------------------------
create or replace function public.panel()
returns table (
  email           text,
  nombre          text,
  alta            timestamptz,
  confirmado      boolean,
  estado          text,
  ultimo_acceso   timestamptz,
  visitas_hoy     int,
  visitas_semana  int,
  visitas_mes     int,
  sesiones        int,
  ultimo_entreno  timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  -- el candado: si quien pregunta no es admin, no sale nada
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    return;
  end if;

  return query
  select
    u.email::text,
    coalesce(u.raw_user_meta_data->>'nombre', u.raw_user_meta_data->>'full_name', '')::text,
    u.created_at,
    (u.email_confirmed_at is not null),
    coalesce(ac.estado, 'sin solicitud')::text,
    u.last_sign_in_at,
    coalesce((select v.n from public.visitas v
              where v.user_id = u.id and v.dia = current_date), 0),
    coalesce((select sum(v.n)::int from public.visitas v
              where v.user_id = u.id and v.dia >= date_trunc('week', current_date)::date), 0),
    coalesce((select sum(v.n)::int from public.visitas v
              where v.user_id = u.id and v.dia >= date_trunc('month', current_date)::date), 0),
    coalesce(jsonb_array_length(e.estado->'hechas'), 0),
    e.actualizado
  from auth.users u
  left join public.acceso ac on ac.user_id = u.id
  left join public.entrenamientos e on e.user_id = u.id
  order by u.created_at desc;
end;
$$;
grant execute on function public.panel() to authenticated;

-- ------------------------------------------------------------------
-- Para aprobar o denegar desde el panel
-- ------------------------------------------------------------------
create or replace function public.decide(correo text, nuevo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception 'no autorizado';
  end if;
  if nuevo not in ('pendiente','aprobado','denegado') then
    raise exception 'estado no valido';
  end if;
  update public.acceso set estado = nuevo, decidido = now()
  where lower(email) = lower(correo);
end;
$$;
grant execute on function public.decide(text, text) to authenticated;
