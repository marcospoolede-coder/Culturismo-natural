-- Cuaderno de Fuerza, tablas y permisos
-- Pégalo entero en Supabase, en SQL Editor, y dale a Run.

create table if not exists public.entrenamientos (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  estado      jsonb not null,
  actualizado timestamptz not null default now()
);

alter table public.entrenamientos enable row level security;

-- Cada persona solo toca su propia fila. Sin esto, cualquiera
-- con la clave anon podría leer el entrenamiento de los demás.
drop policy if exists "leer lo propio"       on public.entrenamientos;
drop policy if exists "crear lo propio"      on public.entrenamientos;
drop policy if exists "actualizar lo propio" on public.entrenamientos;
drop policy if exists "borrar lo propio"     on public.entrenamientos;

create policy "leer lo propio" on public.entrenamientos
  for select using (auth.uid() = user_id);

create policy "crear lo propio" on public.entrenamientos
  for insert with check (auth.uid() = user_id);

create policy "actualizar lo propio" on public.entrenamientos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "borrar lo propio" on public.entrenamientos
  for delete using (auth.uid() = user_id);
