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
