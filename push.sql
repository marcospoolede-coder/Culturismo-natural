-- Avisos del cronómetro fuera de la app (notificaciones push).
-- Pégalo entero en Supabase, SQL Editor, y dale a Run.
--
-- Cómo funciona: la app apunta aquí "avísame a tal hora" al arrancar cada
-- descanso, y lo borra si lo atiendes dentro de la app. Un reloj de la base
-- de datos mira cada 10 segundos si hay avisos vencidos y, si los hay, llama
-- a la función "empuja" (Edge Function), que es la que manda la notificación.
-- Así ninguna función tiene que quedarse esperando, que en el plan gratuito
-- se cortaría a los 150 segundos.

create table if not exists public.avisos (
  id     uuid primary key,
  vence  timestamptz not null,
  sub    jsonb not null,
  titulo text,
  cuerpo text,
  creado timestamptz not null default now()
);

alter table public.avisos enable row level security;

-- La app crea avisos y los anula por su id, que es un uuid aleatorio.
-- Leerlos no hace falta desde fuera: la función del servidor salta el RLS.
drop policy if exists "crear aviso"  on public.avisos;
drop policy if exists "anular aviso" on public.avisos;

create policy "crear aviso" on public.avisos
  for insert with check (vence <= now() + interval '15 minutes');

create policy "anular aviso" on public.avisos
  for delete using (true);

-- El reloj: cada 10 segundos, si hay algo vencido, llama a "empuja".
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('avisos-cada-10s')
where exists (select 1 from cron.job where jobname = 'avisos-cada-10s');

select cron.schedule(
  'avisos-cada-10s',
  '10 seconds',
  $$
  select net.http_post(
    url     := 'https://ocrmaythsawmuotoqvzr.supabase.co/functions/v1/empuja',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  )
  where exists (select 1 from public.avisos where vence <= now());
  $$
);

-- Consultas del día a día:
--   avisos en cola:        select id, vence, titulo from public.avisos order by vence;
--   parar el reloj:        select cron.unschedule('avisos-cada-10s');
--   ver si el reloj corre: select jobname, schedule, active from cron.job;
