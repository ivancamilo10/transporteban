create extension if not exists pgcrypto;

create type public.user_role as enum ('passenger', 'driver');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  role public.user_role not null default 'passenger',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  whatsapp_conductor text not null,
  mensaje_bienvenida text not null default 'Viaja con confianza',
  minutos_bloqueo_puesto integer not null default 10 check (minutos_bloqueo_puesto between 1 and 120),
  horas_apertura_reservas integer not null default 24 check (horas_apertura_reservas between 0 and 720),
  updated_at timestamptz not null default now()
);

create table public.vehicle (
  id smallint primary key default 1 check (id = 1),
  marca text not null,
  modelo text not null,
  color text not null,
  placa text,
  capacidad_pasajeros integer not null default 7 check (capacidad_pasajeros between 1 and 30),
  updated_at timestamptz not null default now()
);

create table public.trip_templates (
  id uuid primary key default gen_random_uuid(),
  origen text not null,
  destino text not null,
  hora time not null,
  dias_semana smallint[] not null,
  precio numeric(10, 2) check (precio is null or precio >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_templates_different_places check (origen <> destino),
  constraint trip_templates_schedule_unique unique (origen, destino, hora, dias_semana),
  constraint trip_templates_valid_days check (
    cardinality(dias_semana) > 0 and dias_semana <@ array[1,2,3,4,5,6,7]::smallint[]
  )
);

create index trip_templates_active_route_idx on public.trip_templates (origen, destino, hora) where activo;
create index trip_templates_days_idx on public.trip_templates using gin (dias_semana);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger app_settings_set_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();
create trigger vehicle_set_updated_at before update on public.vehicle
for each row execute function public.set_updated_at();
create trigger trip_templates_set_updated_at before update on public.trip_templates
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    'passenger'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.vehicle enable row level security;
alter table public.trip_templates enable row level security;

create policy "Profiles are visible to their owner"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create or replace function public.is_driver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'driver'
  );
$$;

create policy "Users can update their own profile without changing their role"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check (
  (select auth.uid()) = id
  and role = case
    when public.is_driver() then 'driver'::public.user_role
    else 'passenger'::public.user_role
  end
);

create policy "App settings are readable by everyone"
on public.app_settings for select to anon, authenticated using (true);
create policy "Only driver edits app settings"
on public.app_settings for update to authenticated using (public.is_driver()) with check (public.is_driver());

create policy "Vehicle is readable by everyone"
on public.vehicle for select to anon, authenticated using (true);
create policy "Only driver edits vehicle"
on public.vehicle for update to authenticated using (public.is_driver()) with check (public.is_driver());

create policy "Active templates are readable by everyone"
on public.trip_templates for select to anon, authenticated using (activo or public.is_driver());
create policy "Only driver creates templates"
on public.trip_templates for insert to authenticated with check (public.is_driver());
create policy "Only driver updates templates"
on public.trip_templates for update to authenticated using (public.is_driver()) with check (public.is_driver());
create policy "Only driver deletes templates"
on public.trip_templates for delete to authenticated using (public.is_driver());

grant usage on schema public to anon, authenticated;
grant select on public.app_settings, public.vehicle, public.trip_templates to anon, authenticated;
grant update on public.app_settings, public.vehicle to authenticated;
grant select, insert, update, delete on public.trip_templates to authenticated;
grant select, update on public.profiles to authenticated;

insert into public.app_settings (id, whatsapp_conductor, mensaje_bienvenida, minutos_bloqueo_puesto, horas_apertura_reservas)
values (1, '3115485852', 'Viaja con confianza', 10, 24)
on conflict (id) do nothing;

insert into public.vehicle (id, marca, modelo, color, capacidad_pasajeros)
values (1, 'Chevrolet', 'N400', 'Blanca', 7)
on conflict (id) do nothing;

insert into public.trip_templates (origen, destino, hora, dias_semana)
select route.origen, route.destino,
       (route.first_departure + (departure.hour_offset * interval '1 hour'))::time,
       array[1,2,3,4,5]::smallint[]
from (values
  ('Isabel López', 'Sabanalarga', '05:00'::time),
  ('Sabanalarga', 'Isabel López', '05:30'::time)
) as route(origen, destino, first_departure)
cross join generate_series(0, 12) as departure(hour_offset)
on conflict (origen, destino, hora, dias_semana) do nothing;

insert into public.trip_templates (origen, destino, hora, dias_semana)
select route.origen, route.destino,
       (route.first_departure + (departure.hour_offset * interval '1 hour'))::time,
       array[6]::smallint[]
from (values
  ('Isabel López', 'Sabanalarga', '05:00'::time, 7),
  ('Sabanalarga', 'Isabel López', '05:30'::time, 6)
) as route(origen, destino, first_departure, saturday_last_offset)
cross join lateral generate_series(0, route.saturday_last_offset) as departure(hour_offset)
on conflict (origen, destino, hora, dias_semana) do nothing;
