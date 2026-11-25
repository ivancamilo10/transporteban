-- ===== 202611250001_initial_schema_and_seed.sql =====
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

-- ===== 202611250002_trips_and_live_bookings.sql =====
create type public.trip_type as enum ('regular', 'especial');
create type public.trip_status as enum ('programado', 'abierto', 'salio', 'en_camino', 'llego', 'cancelado');
create type public.seat_status as enum ('libre', 'reservado_temporal', 'ocupado', 'bloqueado');
create type public.booking_status as enum ('confirmada', 'cancelada');
create type public.boarding_status as enum ('pendiente', 'abordo', 'no_se_presento');

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  origen text not null,
  destino text not null,
  fecha_salida timestamptz not null,
  tipo public.trip_type not null default 'regular',
  precio numeric(10, 2) check (precio is null or precio >= 0),
  estado public.trip_status not null default 'programado',
  reservas_abren_at timestamptz not null,
  driver_id uuid references public.profiles(id) on delete set null,
  template_id uuid references public.trip_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_different_places check (origen <> destino)
);

create unique index trips_template_departure_unique
on public.trips (template_id, fecha_salida)
where template_id is not null;
create index trips_search_departure_idx on public.trips (origen, destino, fecha_salida);
create index trips_state_departure_idx on public.trips (estado, fecha_salida);

create table public.seats (
  trip_id uuid not null references public.trips(id) on delete cascade,
  seat_number smallint not null check (seat_number > 0),
  estado public.seat_status not null default 'libre',
  passenger_id uuid references public.profiles(id) on delete set null,
  hold_expires_at timestamptz,
  primary key (trip_id, seat_number),
  constraint seat_hold_state_consistency check (
    (estado = 'reservado_temporal' and passenger_id is not null and hold_expires_at is not null)
    or (estado <> 'reservado_temporal' and hold_expires_at is null)
  )
);
create index seats_expired_holds_idx on public.seats (hold_expires_at) where estado = 'reservado_temporal';

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  seat_number smallint not null,
  estado public.booking_status not null default 'confirmada',
  punto_de_abordaje text not null,
  boarding_status public.boarding_status not null default 'pendiente',
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint bookings_seat_fk foreign key (trip_id, seat_number)
    references public.seats(trip_id, seat_number) on delete cascade,
  constraint bookings_cancelled_at_consistency check (
    (estado = 'cancelada' and cancelled_at is not null)
    or (estado = 'confirmada' and cancelled_at is null)
  )
);
create unique index bookings_one_active_seat
on public.bookings (trip_id, seat_number)
where estado = 'confirmada';
create index bookings_passenger_created_idx on public.bookings (passenger_id, created_at desc);
create index bookings_trip_state_idx on public.bookings (trip_id, estado);

create or replace function public.create_trip_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  passenger_capacity integer;
begin
  select v.capacidad_pasajeros into passenger_capacity
  from public.vehicle v
  where v.id = 1;

  if passenger_capacity is null or passenger_capacity < 1 then
    raise exception using message = 'No hay una capacidad válida configurada para el vehículo.';
  end if;

  insert into public.seats (trip_id, seat_number)
  select new.id, seat_number::smallint
  from generate_series(1, passenger_capacity) as seat_number;

  return new;
end;
$$;

create trigger trips_create_seats
after insert on public.trips
for each row execute function public.create_trip_seats();

create trigger trips_set_updated_at before update on public.trips
for each row execute function public.set_updated_at();

create or replace function public.release_trip_holds_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado = 'cancelado' and old.estado <> 'cancelado' then
    update public.seats
    set estado = 'libre', passenger_id = null, hold_expires_at = null
    where trip_id = new.id and estado = 'reservado_temporal';
  end if;
  return new;
end;
$$;

create trigger trips_release_holds_on_cancellation
after update of estado on public.trips
for each row execute function public.release_trip_holds_on_cancellation();

create or replace function public.generate_regular_trips()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  hours_before_opening integer;
  trips_created integer;
begin
  if (select auth.uid()) is not null and not public.is_driver() then
    raise exception using message = 'Solo el conductor puede generar viajes.';
  end if;

  select horas_apertura_reservas into hours_before_opening
  from public.app_settings where id = 1;

  if hours_before_opening is null then
    raise exception using message = 'Completa la configuración antes de generar viajes.';
  end if;

  insert into public.trips (
    origen, destino, fecha_salida, tipo, precio, estado,
    reservas_abren_at, driver_id, template_id
  )
  select
    template.origen,
    template.destino,
    (target_day + template.hora) at time zone 'America/Bogota',
    'regular',
    template.precio,
    'abierto',
    ((target_day + template.hora) at time zone 'America/Bogota')
      - make_interval(hours => hours_before_opening),
    (select p.id from public.profiles p where p.role = 'driver' order by p.created_at limit 1),
    template.id
  from generate_series(0, 6) as offsets(day_offset)
  cross join lateral (
    select (timezone('America/Bogota', now())::date + day_offset)::date as target_day
  ) as day_value
  join public.trip_templates template
    on template.activo
    and extract(isodow from day_value.target_day)::smallint = any(template.dias_semana)
  where ((day_value.target_day + template.hora) at time zone 'America/Bogota') > now()
  on conflict (template_id, fecha_salida) where template_id is not null do nothing;

  get diagnostics trips_created = row_count;
  return trips_created;
end;
$$;

create or replace function public.hold_trip_seat(p_trip_id uuid, p_seat_number smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  trip_record public.trips%rowtype;
  seat_record public.seats%rowtype;
  hold_minutes integer;
begin
  if current_user_id is null then
    raise exception using message = 'Inicia sesión para elegir tu puesto.';
  end if;

  select * into trip_record
  from public.trips
  where id = p_trip_id
  for share;

  if not found or trip_record.estado = 'cancelado' then
    raise exception using message = 'Este viaje ya no está disponible.';
  end if;
  if trip_record.estado not in ('programado', 'abierto') then
    raise exception using message = 'Este viaje ya salió y no acepta reservas.';
  end if;
  if trip_record.fecha_salida <= now() then
    raise exception using message = 'Este viaje ya salió y no acepta reservas.';
  end if;
  if trip_record.reservas_abren_at > now() then
    raise exception using message = 'Los puestos de este viaje todavía no están disponibles.';
  end if;

  select minutos_bloqueo_puesto into hold_minutes
  from public.app_settings where id = 1;

  update public.seats
  set estado = 'libre', passenger_id = null, hold_expires_at = null
  where trip_id = p_trip_id
    and estado = 'reservado_temporal'
    and hold_expires_at <= now();

  select * into seat_record
  from public.seats
  where trip_id = p_trip_id and seat_number = p_seat_number
  for update;

  if not found then
    raise exception using message = 'Ese puesto no existe en este viaje.';
  end if;

  if seat_record.estado = 'reservado_temporal'
    and seat_record.passenger_id = current_user_id
    and seat_record.hold_expires_at > now() then
    return jsonb_build_object('trip_id', p_trip_id, 'seat_number', p_seat_number, 'hold_expires_at', seat_record.hold_expires_at);
  end if;

  if seat_record.estado <> 'libre' then
    raise exception using message = 'Este puesto ya fue tomado. Elige otro.';
  end if;

  update public.seats
  set estado = 'reservado_temporal',
      passenger_id = current_user_id,
      hold_expires_at = now() + make_interval(mins => hold_minutes)
  where trip_id = p_trip_id and seat_number = p_seat_number
  returning * into seat_record;

  return jsonb_build_object('trip_id', p_trip_id, 'seat_number', p_seat_number, 'hold_expires_at', seat_record.hold_expires_at);
end;
$$;

create or replace function public.get_my_trip_seat_holds(p_trip_id uuid)
returns table (seat_number smallint, hold_expires_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select s.seat_number, s.hold_expires_at
  from public.seats s
  where s.trip_id = p_trip_id
    and s.estado = 'reservado_temporal'
    and s.passenger_id = (select auth.uid())
    and s.hold_expires_at > now();
$$;

create or replace function public.release_my_trip_seat_hold(p_trip_id uuid, p_seat_number smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using message = 'Inicia sesión para liberar el puesto.';
  end if;

  update public.seats
  set estado = 'libre', passenger_id = null, hold_expires_at = null
  where trip_id = p_trip_id
    and seat_number = p_seat_number
    and estado = 'reservado_temporal'
    and passenger_id = (select auth.uid());
end;
$$;

create or replace function public.confirm_trip_booking(
  p_trip_id uuid,
  p_seat_number smallint,
  p_punto_de_abordaje text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  seat_record public.seats%rowtype;
  trip_record public.trips%rowtype;
  new_booking_id uuid;
begin
  if current_user_id is null then
    raise exception using message = 'Inicia sesión para confirmar tu reserva.';
  end if;
  if nullif(trim(p_punto_de_abordaje), '') is null then
    raise exception using message = 'Escribe dónde te vas a subir.';
  end if;

  select * into trip_record
  from public.trips
  where id = p_trip_id
  for share;
  if not found or trip_record.estado not in ('programado', 'abierto') then
    raise exception using message = 'Este viaje ya no acepta reservas.';
  end if;
  if trip_record.fecha_salida <= now() then
    raise exception using message = 'Este viaje ya no acepta reservas.';
  end if;
  if trip_record.reservas_abren_at > now() then
    raise exception using message = 'Los puestos de este viaje todavía no están disponibles.';
  end if;

  select * into seat_record
  from public.seats
  where trip_id = p_trip_id and seat_number = p_seat_number
  for update;

  if not found
    or seat_record.estado <> 'reservado_temporal'
    or seat_record.passenger_id <> current_user_id
    or seat_record.hold_expires_at <= now() then
    raise exception using message = 'Se venció el tiempo para guardar el puesto. Elige uno disponible nuevamente.';
  end if;

  insert into public.bookings (trip_id, passenger_id, seat_number, punto_de_abordaje)
  values (p_trip_id, current_user_id, p_seat_number, trim(p_punto_de_abordaje))
  returning id into new_booking_id;

  update public.seats
  set estado = 'ocupado', hold_expires_at = null
  where trip_id = p_trip_id and seat_number = p_seat_number;

  return new_booking_id;
end;
$$;

create or replace function public.cancel_trip_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  booking_record public.bookings%rowtype;
  trip_departure timestamptz;
begin
  if current_user_id is null then
    raise exception using message = 'Inicia sesión para cancelar tu reserva.';
  end if;

  select * into booking_record
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception using message = 'No encontramos esta reserva.';
  end if;
  if booking_record.passenger_id <> current_user_id and not public.is_driver() then
    raise exception using message = 'No tienes permiso para cancelar esta reserva.';
  end if;
  if booking_record.estado <> 'confirmada' then
    raise exception using message = 'Esta reserva ya fue cancelada.';
  end if;
  select fecha_salida into trip_departure
  from public.trips
  where id = booking_record.trip_id
  for share;
  if booking_record.passenger_id = current_user_id and trip_departure <= now() then
    raise exception using message = 'Este viaje ya comenzó y no se puede cancelar desde la aplicación.';
  end if;

  perform 1 from public.seats
  where trip_id = booking_record.trip_id and seat_number = booking_record.seat_number
  for update;

  update public.bookings
  set estado = 'cancelada', cancelled_at = now()
  where id = booking_record.id;
  update public.seats
  set estado = 'libre', passenger_id = null, hold_expires_at = null
  where trip_id = booking_record.trip_id
    and seat_number = booking_record.seat_number
    and estado = 'ocupado';
end;
$$;

create or replace function public.release_expired_seat_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer;
begin
  update public.seats
  set estado = 'libre', passenger_id = null, hold_expires_at = null
  where estado = 'reservado_temporal' and hold_expires_at <= now();
  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

alter table public.trips enable row level security;
alter table public.seats enable row level security;
alter table public.bookings enable row level security;

create policy "Trips are visible to passengers and drivers"
on public.trips for select to anon, authenticated using (true);
create policy "Drivers can create trips"
on public.trips for insert to authenticated with check (public.is_driver());
create policy "Drivers can update trips"
on public.trips for update to authenticated using (public.is_driver()) with check (public.is_driver());

create policy "Seat availability is public"
on public.seats for select to anon, authenticated using (true);

create policy "Passengers see their own bookings and drivers see all bookings"
on public.bookings for select to authenticated
using (passenger_id = (select auth.uid()) or public.is_driver());

grant select on public.trips to anon, authenticated;
grant insert, update on public.trips to authenticated;
grant select (trip_id, seat_number, estado, hold_expires_at) on public.seats to anon, authenticated;
grant select on public.bookings to authenticated;

revoke all on function public.generate_regular_trips() from public, anon;
revoke all on function public.hold_trip_seat(uuid, smallint) from public, anon;
revoke all on function public.get_my_trip_seat_holds(uuid) from public, anon;
revoke all on function public.release_my_trip_seat_hold(uuid, smallint) from public, anon;
revoke all on function public.confirm_trip_booking(uuid, smallint, text) from public, anon;
revoke all on function public.cancel_trip_booking(uuid) from public, anon;
revoke all on function public.release_expired_seat_holds() from public, anon;
grant execute on function public.generate_regular_trips() to authenticated;
grant execute on function public.hold_trip_seat(uuid, smallint) to authenticated;
grant execute on function public.get_my_trip_seat_holds(uuid) to authenticated;
grant execute on function public.release_my_trip_seat_hold(uuid, smallint) to authenticated;
grant execute on function public.confirm_trip_booking(uuid, smallint, text) to authenticated;
grant execute on function public.cancel_trip_booking(uuid) to authenticated;
grant execute on function public.release_expired_seat_holds() to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips') then
    alter publication supabase_realtime add table public.trips;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'seats') then
    alter publication supabase_realtime add table public.seats;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
end;
$$;

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if not exists (select 1 from cron.job where jobname = 'transporteban-generate-trips') then
      perform cron.schedule('transporteban-generate-trips', '0 9 * * *', 'select public.generate_regular_trips();');
    end if;
    if not exists (select 1 from cron.job where jobname = 'transporteban-release-seat-holds') then
      perform cron.schedule('transporteban-release-seat-holds', '* * * * *', 'select public.release_expired_seat_holds();');
    end if;
  end if;
end;
$$;

select public.generate_regular_trips();

-- ===== 202611250003_admin_and_driver_operations.sql =====
alter type public.user_role add value if not exists 'admin';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid()) and p.role::text = 'admin'
  );
$$;

drop policy if exists "Users can update their own profile without changing their role" on public.profiles;
create policy "Users can update their own profile without changing their role"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check (
  (select auth.uid()) = id
  and (
    (role::text = 'passenger' and not public.is_driver() and not public.is_admin())
    or (role::text = 'driver' and public.is_driver())
    or (role::text = 'admin' and public.is_admin())
  )
);

create policy "Admins can view all profiles"
on public.profiles for select to authenticated
using (public.is_admin());

create policy "Drivers can view booked passengers"
on public.profiles for select to authenticated
using (
  public.is_driver()
  and exists (
    select 1
    from public.bookings b
    where b.passenger_id = profiles.id
      and (b.estado = 'confirmada' or b.boarding_status = 'no_se_presento')
  )
);

drop policy if exists "Only driver edits app settings" on public.app_settings;
create policy "Drivers and admins edit app settings"
on public.app_settings for update to authenticated
using (public.is_driver() or public.is_admin())
with check (public.is_driver() or public.is_admin());

drop policy if exists "Only driver edits vehicle" on public.vehicle;
create policy "Drivers and admins edit vehicle"
on public.vehicle for update to authenticated
using (public.is_driver() or public.is_admin())
with check (public.is_driver() or public.is_admin());

drop policy if exists "Only driver creates templates" on public.trip_templates;
create policy "Drivers and admins create templates"
on public.trip_templates for insert to authenticated
with check (public.is_driver() or public.is_admin());
drop policy if exists "Only driver updates templates" on public.trip_templates;
create policy "Drivers and admins update templates"
on public.trip_templates for update to authenticated
using (public.is_driver() or public.is_admin())
with check (public.is_driver() or public.is_admin());
drop policy if exists "Only driver deletes templates" on public.trip_templates;
create policy "Drivers and admins delete templates"
on public.trip_templates for delete to authenticated
using (public.is_driver() or public.is_admin());

drop policy if exists "Drivers can create trips" on public.trips;
create policy "Drivers and admins create trips"
on public.trips for insert to authenticated
with check (public.is_driver() or public.is_admin());
drop policy if exists "Drivers can update trips" on public.trips;
create policy "Drivers and admins update trips"
on public.trips for update to authenticated
using (public.is_driver() or public.is_admin())
with check (public.is_driver() or public.is_admin());

drop policy if exists "Passengers see their own bookings and drivers see all bookings" on public.bookings;
create policy "Passengers see their own bookings and staff see all bookings"
on public.bookings for select to authenticated
using (passenger_id = (select auth.uid()) or public.is_driver() or public.is_admin());

create or replace function public.mark_booking_boarding(
  p_booking_id uuid,
  p_boarding_status public.boarding_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_record public.bookings%rowtype;
begin
  if not public.is_driver() then
    raise exception using message = 'Solo el conductor puede actualizar la lista de abordaje.';
  end if;
  if p_boarding_status not in ('abordo', 'no_se_presento') then
    raise exception using message = 'El estado de abordaje no es válido.';
  end if;

  select * into booking_record
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or booking_record.estado <> 'confirmada' then
    raise exception using message = 'Esta reserva ya no está activa.';
  end if;

  if p_boarding_status = 'no_se_presento' then
    update public.bookings
    set boarding_status = p_boarding_status,
        estado = 'cancelada',
        cancelled_at = now()
    where id = p_booking_id;
    update public.seats
    set estado = 'libre', passenger_id = null, hold_expires_at = null
    where trip_id = booking_record.trip_id
      and seat_number = booking_record.seat_number
      and estado = 'ocupado';
  else
    update public.bookings
    set boarding_status = p_boarding_status
    where id = p_booking_id;
  end if;
end;
$$;

revoke all on function public.mark_booking_boarding(uuid, public.boarding_status) from public, anon;
grant execute on function public.mark_booking_boarding(uuid, public.boarding_status) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;

-- ===== 202611250004_waitlist_notifications_ratings.sql =====
create type public.waitlist_status as enum ('esperando', 'notificada', 'reservada', 'vencida', 'retirada');

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  estado public.waitlist_status not null default 'esperando',
  seat_number smallint,
  notified_at timestamptz,
  claim_expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint waitlist_passenger_trip_unique unique (trip_id, passenger_id),
  constraint waitlist_claim_consistency check (
    (estado = 'notificada' and seat_number is not null and notified_at is not null and claim_expires_at is not null)
    or (estado <> 'notificada')
  )
);
create index waitlist_trip_queue_idx on public.waitlist (trip_id, created_at) where estado = 'esperando';
create index waitlist_expired_claims_idx on public.waitlist (claim_expires_at) where estado = 'notificada';

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  mensaje text not null,
  leida boolean not null default false,
  related_trip_id uuid references public.trips(id) on delete set null,
  kind text not null default 'general',
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, created_at desc) where not leida;
create unique index notifications_trip_reminder_once_idx
on public.notifications (user_id, related_trip_id, kind)
where kind = 'recordatorio_una_hora';

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  estrellas smallint not null check (estrellas between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) <= 500),
  created_at timestamptz not null default now(),
  constraint ratings_trip_passenger_unique unique (trip_id, passenger_id)
);
create index ratings_trip_idx on public.ratings (trip_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.waitlist enable row level security;
alter table public.notifications enable row level security;
alter table public.ratings enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "Passengers see their own waitlist entries"
on public.waitlist for select to authenticated
using (passenger_id = (select auth.uid()));

create policy "Users see their own notifications"
on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy "Users mark their own notifications read"
on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Passengers and staff can read trip ratings"
on public.ratings for select to authenticated
using (passenger_id = (select auth.uid()) or public.is_driver() or public.is_admin());

create policy "Users manage their own push subscriptions"
on public.push_subscriptions for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant select on public.waitlist, public.notifications, public.ratings to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant update (leida) on public.notifications to authenticated;

create or replace function public.promote_trip_waitlist(p_trip_id uuid, p_seat_number smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_waiting public.waitlist%rowtype;
  trip_record public.trips%rowtype;
  hold_minutes integer;
begin
  select * into trip_record
  from public.trips
  where id = p_trip_id;
  if not found or trip_record.estado not in ('programado', 'abierto') or trip_record.fecha_salida <= now() then
    return;
  end if;

  perform 1 from public.seats
  where trip_id = p_trip_id and seat_number = p_seat_number and estado = 'libre'
  for update;
  if not found then return; end if;

  select * into next_waiting
  from public.waitlist
  where trip_id = p_trip_id and estado = 'esperando'
  order by created_at, id
  limit 1
  for update skip locked;
  if not found then return; end if;

  select minutos_bloqueo_puesto into hold_minutes
  from public.app_settings where id = 1;

  update public.seats
  set estado = 'reservado_temporal',
      passenger_id = next_waiting.passenger_id,
      hold_expires_at = now() + make_interval(mins => hold_minutes)
  where trip_id = p_trip_id and seat_number = p_seat_number and estado = 'libre';
  if not found then return; end if;

  update public.waitlist
  set estado = 'notificada',
      seat_number = p_seat_number,
      notified_at = now(),
      claim_expires_at = now() + make_interval(mins => hold_minutes)
  where id = next_waiting.id;

  insert into public.notifications (user_id, titulo, mensaje, related_trip_id, kind)
  values (
    next_waiting.passenger_id,
    '¡Hay un puesto disponible!',
    'Guardamos un puesto para ti durante ' || hold_minutes || ' minutos. Abre el viaje y confirma tu reserva.',
    p_trip_id,
    'lista_espera'
  );
end;
$$;

create or replace function public.on_occupied_seat_released()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.estado = 'ocupado' and new.estado = 'libre' then
    perform public.promote_trip_waitlist(new.trip_id, new.seat_number);
  end if;
  return new;
end;
$$;

create trigger seats_promote_waitlist_after_release
after update of estado on public.seats
for each row execute function public.on_occupied_seat_released();

create or replace function public.join_trip_waitlist(p_trip_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  trip_record public.trips%rowtype;
  entry_id uuid;
begin
  if current_user_id is null then
    raise exception using message = 'Inicia sesión para unirte a la lista de espera.';
  end if;

  select * into trip_record
  from public.trips
  where id = p_trip_id
  for share;
  if not found or trip_record.estado not in ('programado', 'abierto') or trip_record.fecha_salida <= now() then
    raise exception using message = 'Este viaje ya no acepta lista de espera.';
  end if;
  if trip_record.reservas_abren_at > now() then
    raise exception using message = 'La lista de espera todavía no está disponible.';
  end if;
  if exists (
    select 1 from public.bookings
    where trip_id = p_trip_id and passenger_id = current_user_id and estado = 'confirmada'
  ) then
    raise exception using message = 'Ya tienes una reserva para este viaje.';
  end if;
  if exists (
    select 1 from public.seats
    where trip_id = p_trip_id
      and (estado = 'libre' or (estado = 'reservado_temporal' and hold_expires_at <= now()))
  ) then
    raise exception using message = 'Todavía hay puestos disponibles. Elige uno para reservar.';
  end if;

  insert into public.waitlist (trip_id, passenger_id)
  values (p_trip_id, current_user_id)
  on conflict (trip_id, passenger_id) do update
    set estado = case
      when public.waitlist.estado in ('esperando', 'notificada', 'reservada') then public.waitlist.estado
      else 'esperando'::public.waitlist_status
    end
  returning id into entry_id;

  return entry_id;
end;
$$;

create or replace function public.hold_trip_seat(p_trip_id uuid, p_seat_number smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  trip_record public.trips%rowtype;
  seat_record public.seats%rowtype;
  hold_minutes integer;
begin
  if current_user_id is null then
    raise exception using message = 'Inicia sesión para elegir tu puesto.';
  end if;

  select * into trip_record from public.trips where id = p_trip_id for share;
  if not found or trip_record.estado = 'cancelado' or trip_record.fecha_salida <= now() then
    raise exception using message = 'Este viaje ya no está disponible.';
  end if;
  if trip_record.estado not in ('programado', 'abierto') then
    raise exception using message = 'Este viaje ya salió y no acepta reservas.';
  end if;
  if trip_record.reservas_abren_at > now() then
    raise exception using message = 'Los puestos de este viaje todavía no están disponibles.';
  end if;

  select minutos_bloqueo_puesto into hold_minutes from public.app_settings where id = 1;
  select * into seat_record
  from public.seats
  where trip_id = p_trip_id and seat_number = p_seat_number
  for update;
  if not found then
    raise exception using message = 'Ese puesto no existe en este viaje.';
  end if;

  if seat_record.estado = 'reservado_temporal' and seat_record.hold_expires_at <= now() then
    update public.waitlist
    set estado = 'vencida'
    where trip_id = p_trip_id and seat_number = p_seat_number
      and passenger_id = seat_record.passenger_id and estado = 'notificada';
    update public.seats
    set estado = 'libre', passenger_id = null, hold_expires_at = null
    where trip_id = p_trip_id and seat_number = p_seat_number;
    perform public.promote_trip_waitlist(p_trip_id, p_seat_number);
    select * into seat_record
    from public.seats
    where trip_id = p_trip_id and seat_number = p_seat_number
    for update;
  end if;

  if seat_record.estado = 'reservado_temporal'
    and seat_record.passenger_id = current_user_id
    and seat_record.hold_expires_at > now() then
    return jsonb_build_object('trip_id', p_trip_id, 'seat_number', p_seat_number, 'hold_expires_at', seat_record.hold_expires_at);
  end if;
  if seat_record.estado <> 'libre' then
    raise exception using message = 'Este puesto ya fue tomado. Elige otro.';
  end if;

  update public.seats
  set estado = 'reservado_temporal',
      passenger_id = current_user_id,
      hold_expires_at = now() + make_interval(mins => hold_minutes)
  where trip_id = p_trip_id and seat_number = p_seat_number
  returning * into seat_record;

  return jsonb_build_object('trip_id', p_trip_id, 'seat_number', p_seat_number, 'hold_expires_at', seat_record.hold_expires_at);
end;
$$;

create or replace function public.confirm_trip_booking(
  p_trip_id uuid,
  p_seat_number smallint,
  p_punto_de_abordaje text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  seat_record public.seats%rowtype;
  trip_record public.trips%rowtype;
  new_booking_id uuid;
begin
  if current_user_id is null then
    raise exception using message = 'Inicia sesión para confirmar tu reserva.';
  end if;
  if nullif(trim(p_punto_de_abordaje), '') is null then
    raise exception using message = 'Escribe dónde te vas a subir.';
  end if;

  select * into trip_record from public.trips where id = p_trip_id for share;
  if not found or trip_record.estado not in ('programado', 'abierto') or trip_record.fecha_salida <= now() then
    raise exception using message = 'Este viaje ya no acepta reservas.';
  end if;
  if trip_record.reservas_abren_at > now() then
    raise exception using message = 'Los puestos de este viaje todavía no están disponibles.';
  end if;

  select * into seat_record
  from public.seats
  where trip_id = p_trip_id and seat_number = p_seat_number
  for update;
  if not found or seat_record.estado <> 'reservado_temporal'
    or seat_record.passenger_id <> current_user_id or seat_record.hold_expires_at <= now() then
    raise exception using message = 'Se venció el tiempo para guardar el puesto. Elige uno disponible nuevamente.';
  end if;

  insert into public.bookings (trip_id, passenger_id, seat_number, punto_de_abordaje)
  values (p_trip_id, current_user_id, p_seat_number, trim(p_punto_de_abordaje))
  returning id into new_booking_id;
  update public.seats
  set estado = 'ocupado', hold_expires_at = null
  where trip_id = p_trip_id and seat_number = p_seat_number;
  update public.waitlist
  set estado = 'reservada'
  where trip_id = p_trip_id and passenger_id = current_user_id and estado = 'notificada';

  return new_booking_id;
end;
$$;

create or replace function public.release_my_trip_seat_hold(p_trip_id uuid, p_seat_number smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using message = 'Inicia sesión para liberar el puesto.';
  end if;

  update public.seats
  set estado = 'libre', passenger_id = null, hold_expires_at = null
  where trip_id = p_trip_id and seat_number = p_seat_number
    and estado = 'reservado_temporal' and passenger_id = (select auth.uid());
  if found then
    update public.waitlist
    set estado = 'vencida'
    where trip_id = p_trip_id and passenger_id = (select auth.uid())
      and estado = 'notificada' and seat_number = p_seat_number;
    perform public.promote_trip_waitlist(p_trip_id, p_seat_number);
  end if;
end;
$$;

create or replace function public.release_expired_seat_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_seat record;
  released_count integer := 0;
begin
  for expired_seat in
    select trip_id, seat_number, passenger_id
    from public.seats
    where estado = 'reservado_temporal' and hold_expires_at <= now()
    for update skip locked
  loop
    update public.seats
    set estado = 'libre', passenger_id = null, hold_expires_at = null
    where trip_id = expired_seat.trip_id and seat_number = expired_seat.seat_number
      and estado = 'reservado_temporal' and hold_expires_at <= now();
    if found then
      update public.waitlist
      set estado = 'vencida'
      where trip_id = expired_seat.trip_id and seat_number = expired_seat.seat_number
        and passenger_id = expired_seat.passenger_id and estado = 'notificada';
      perform public.promote_trip_waitlist(expired_seat.trip_id, expired_seat.seat_number);
      released_count := released_count + 1;
    end if;
  end loop;
  return released_count;
end;
$$;

create or replace function public.submit_trip_rating(p_trip_id uuid, p_stars smallint, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_rating_id uuid;
  trip_record public.trips%rowtype;
begin
  if current_user_id is null then
    raise exception using message = 'Inicia sesión para calificar tu viaje.';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception using message = 'Elige una calificación de 1 a 5 estrellas.';
  end if;

  select * into trip_record from public.trips where id = p_trip_id;
  if not found or (trip_record.estado <> 'llego' and trip_record.fecha_salida > now()) then
    raise exception using message = 'Podrás calificar este viaje cuando haya terminado.';
  end if;
  if not exists (
    select 1 from public.bookings b
    where b.trip_id = p_trip_id and b.passenger_id = current_user_id
      and b.estado = 'confirmada' and b.boarding_status = 'abordo'
  ) then
    raise exception using message = 'Solo puedes calificar un viaje al que abordaste.';
  end if;

  insert into public.ratings (trip_id, passenger_id, estrellas, comentario)
  values (p_trip_id, current_user_id, p_stars, nullif(trim(p_comment), ''))
  returning id into new_rating_id;
  return new_rating_id;
end;
$$;

create or replace function public.notify_trip_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  notice_title text;
  notice_message text;
begin
  if new.estado = 'cancelado' and old.estado is distinct from new.estado then
    notice_title := 'Tu viaje fue cancelado';
    notice_message := 'El viaje de ' || new.origen || ' a ' || new.destino || ' fue cancelado. Revisa tus viajes para más información.';
  elsif old.fecha_salida is distinct from new.fecha_salida then
    notice_title := 'Cambió la hora de tu viaje';
    notice_message := 'Tu viaje de ' || new.origen || ' a ' || new.destino || ' ahora sale ' ||
      to_char(new.fecha_salida at time zone 'America/Bogota', 'DD/MM/YYYY HH12:MI AM') || '.';
  else
    return new;
  end if;

  insert into public.notifications (user_id, titulo, mensaje, related_trip_id, kind)
  select b.passenger_id, notice_title, notice_message, new.id, 'cambio_viaje'
  from public.bookings b
  where b.trip_id = new.id and b.estado = 'confirmada';
  return new;
end;
$$;

create trigger trips_notify_booked_passengers
after update of estado, fecha_salida on public.trips
for each row execute function public.notify_trip_changes();

create or replace function public.create_trip_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  insert into public.notifications (user_id, titulo, mensaje, related_trip_id, kind)
  select b.passenger_id,
    'Tu viaje es en una hora',
    'Recuerda tu viaje de ' || t.origen || ' a ' || t.destino || '. Salimos a las ' ||
      to_char(t.fecha_salida at time zone 'America/Bogota', 'HH12:MI AM') || '.',
    t.id,
    'recordatorio_una_hora'
  from public.trips t
  join public.bookings b on b.trip_id = t.id and b.estado = 'confirmada'
  where t.estado in ('programado', 'abierto')
    and t.fecha_salida between now() + interval '55 minutes' and now() + interval '65 minutes'
  on conflict (user_id, related_trip_id, kind) where kind = 'recordatorio_una_hora' do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.promote_trip_waitlist(uuid, smallint) from public, anon, authenticated;
revoke all on function public.on_occupied_seat_released() from public, anon, authenticated;
revoke all on function public.join_trip_waitlist(uuid) from public, anon;
revoke all on function public.submit_trip_rating(uuid, smallint, text) from public, anon;
revoke all on function public.create_trip_reminders() from public, anon, authenticated;
grant execute on function public.join_trip_waitlist(uuid) to authenticated;
grant execute on function public.submit_trip_rating(uuid, smallint, text) to authenticated;
grant execute on function public.release_my_trip_seat_hold(uuid, smallint) to authenticated;
grant execute on function public.confirm_trip_booking(uuid, smallint, text) to authenticated;
grant execute on function public.release_expired_seat_holds() to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'waitlist') then
    alter publication supabase_realtime add table public.waitlist;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if not exists (select 1 from cron.job where jobname = 'transporteban-trip-reminders') then
      perform cron.schedule('transporteban-trip-reminders', '*/5 * * * *', 'select public.create_trip_reminders();');
    end if;
  end if;
end;
$$;

-- ===== 202611250005_updated_departure_schedule.sql =====
update public.trip_templates
set hora = case
  when origen = 'Isabel López' and destino = 'Sabanalarga'
    then (time '05:00' + ((extract(hour from hora)::integer - 5) * interval '1 hour'))::time
  when origen = 'Sabanalarga' and destino = 'Isabel López'
    then (time '05:30' + ((extract(hour from hora)::integer - 5) * interval '1 hour'))::time
  else hora
end
where dias_semana = array[1,2,3,4,5,6]::smallint[]
  and (
    (origen = 'Isabel López' and destino = 'Sabanalarga' and hora between time '05:15' and time '17:15' and extract(minute from hora) = 15)
    or (origen = 'Sabanalarga' and destino = 'Isabel López' and hora between time '05:45' and time '17:45' and extract(minute from hora) = 45)
  );

with new_departures as (
  select
    t.id,
    ((t.fecha_salida at time zone 'America/Bogota')::date + template.hora)
      at time zone 'America/Bogota' as fecha_salida
  from public.trips t
  join public.trip_templates template on template.id = t.template_id
  where t.tipo = 'regular'
    and t.fecha_salida > now()
    and template.dias_semana = array[1,2,3,4,5,6]::smallint[]
    and (
      (template.origen = 'Isabel López' and template.destino = 'Sabanalarga')
      or (template.origen = 'Sabanalarga' and template.destino = 'Isabel López')
    )
)
update public.trips t
set fecha_salida = departure.fecha_salida,
    reservas_abren_at = departure.fecha_salida
      - make_interval(hours => (select horas_apertura_reservas from public.app_settings where id = 1))
from new_departures departure
where t.id = departure.id
  and departure.fecha_salida > now()
  and t.fecha_salida is distinct from departure.fecha_salida;

-- ===== 202611250006_saturday_half_day_schedule.sql =====
update public.trips old_trip
set template_id = weekday_template.id
from public.trip_templates old_template
join public.trip_templates weekday_template
  on weekday_template.origen = old_template.origen
  and weekday_template.destino = old_template.destino
  and weekday_template.hora = old_template.hora
  and weekday_template.dias_semana = array[1,2,3,4,5]::smallint[]
where old_trip.template_id = old_template.id
  and old_template.dias_semana = array[1,2,3,4,5,6]::smallint[]
  and old_trip.tipo = 'regular'
  and old_trip.fecha_salida > now()
  and (old_trip.fecha_salida at time zone 'America/Bogota')::time = weekday_template.hora;

delete from public.trip_templates old_template
where old_template.dias_semana = array[1,2,3,4,5,6]::smallint[]
  and exists (
    select 1
    from public.trip_templates weekday_template
    where weekday_template.origen = old_template.origen
      and weekday_template.destino = old_template.destino
      and weekday_template.hora = old_template.hora
      and weekday_template.dias_semana = array[1,2,3,4,5]::smallint[]
  );

update public.trip_templates
set dias_semana = array[1,2,3,4,5]::smallint[]
where dias_semana = array[1,2,3,4,5,6]::smallint[]
  and (
    (origen = 'Isabel López' and destino = 'Sabanalarga' and hora between time '05:00' and time '17:00')
    or (origen = 'Sabanalarga' and destino = 'Isabel López' and hora between time '05:30' and time '17:30')
  );

insert into public.trip_templates (origen, destino, hora, dias_semana, precio, activo)
select origen, destino, hora, array[6]::smallint[], precio, activo
from public.trip_templates
where dias_semana = array[1,2,3,4,5]::smallint[]
  and (
    (origen = 'Isabel López' and destino = 'Sabanalarga' and hora between time '05:00' and time '12:00')
    or (origen = 'Sabanalarga' and destino = 'Isabel López' and hora between time '05:30' and time '11:30')
  )
on conflict (origen, destino, hora, dias_semana) do nothing;

update public.trips old_trip
set template_id = saturday_template.id,
    fecha_salida = ((old_trip.fecha_salida at time zone 'America/Bogota')::date + saturday_template.hora)
      at time zone 'America/Bogota',
    reservas_abren_at = (((old_trip.fecha_salida at time zone 'America/Bogota')::date + saturday_template.hora)
      at time zone 'America/Bogota')
      - make_interval(hours => (select horas_apertura_reservas from public.app_settings where id = 1))
from public.trip_templates weekday_template
join public.trip_templates saturday_template
  on saturday_template.origen = weekday_template.origen
  and saturday_template.destino = weekday_template.destino
  and saturday_template.hora = weekday_template.hora
  and saturday_template.dias_semana = array[6]::smallint[]
where old_trip.template_id = weekday_template.id
  and weekday_template.dias_semana = array[1,2,3,4,5]::smallint[]
  and old_trip.tipo = 'regular'
  and old_trip.estado in ('programado', 'abierto')
  and old_trip.fecha_salida > now()
  and extract(isodow from old_trip.fecha_salida at time zone 'America/Bogota') = 6
  and (old_trip.fecha_salida at time zone 'America/Bogota')::time = saturday_template.hora
  and (
    (saturday_template.origen = 'Isabel López' and saturday_template.destino = 'Sabanalarga' and saturday_template.hora <= time '12:00')
    or (saturday_template.origen = 'Sabanalarga' and saturday_template.destino = 'Isabel López' and saturday_template.hora <= time '11:30')
  );

update public.trips
set estado = 'cancelado'
where tipo = 'regular'
  and estado in ('programado', 'abierto')
  and fecha_salida > now()
  and extract(isodow from fecha_salida at time zone 'America/Bogota') = 6
  and (
    (origen = 'Isabel López' and destino = 'Sabanalarga' and (fecha_salida at time zone 'America/Bogota')::time > time '12:00')
    or (origen = 'Sabanalarga' and destino = 'Isabel López' and (fecha_salida at time zone 'America/Bogota')::time > time '11:30')
  );
