-- Lista blanca de acceso, Cuaderno de Fuerza
-- Pégalo entero en Supabase, SQL Editor, y dale a Run.
-- A partir de aquí solo puede registrarse quien esté en public.permitidos.

create table if not exists public.permitidos (
  email text primary key,
  nota  text,
  alta  timestamptz not null default now()
);

-- Sin políticas y con RLS activo: nadie que tenga la clave publicada
-- puede leer esta tabla ni añadirse. Solo se toca desde el panel.
alter table public.permitidos enable row level security;

create or replace function public.solo_permitidos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.permitidos
    where lower(email) = lower(new.email)
  ) then
    raise exception 'correo no autorizado';
  end if;
  return new;
end;
$$;

drop trigger if exists comprueba_permitidos on auth.users;
create trigger comprueba_permitidos
  before insert on auth.users
  for each row execute function public.solo_permitidos();

-- Tu propio correo, para no quedarte fuera de tu aplicación.
insert into public.permitidos (email, nota)
values ('marcos@relevofamiliar.com', 'Marcos')
on conflict (email) do nothing;

-- Los que ya tuvieran cuenta antes de poner la lista siguen entrando.
-- Esto los mete en la lista para no perderlos de vista.
insert into public.permitidos (email, nota)
select u.email, 'ya tenía cuenta'
from auth.users u
where u.email is not null
on conflict (email) do nothing;
