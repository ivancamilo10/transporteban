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
