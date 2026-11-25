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
