update public.trip_templates
set destino = case
  when dias_semana = array[6]::smallint[] then 'Santa Marta'
  when dias_semana = array[7]::smallint[] then 'Santa Marta'
  else destino
end
where origen = 'Isabel López'
  and destino = 'Paseo Santa Marta, Cartagena y Santa Verónica';

update public.trips
set destino = 'Santa Marta'
where origen = 'Isabel López'
  and destino = 'Paseo Santa Marta, Cartagena y Santa Verónica'
  and fecha_salida > now();

insert into public.trip_templates (origen, destino, hora, dias_semana, precio, activo)
values
  ('Isabel López', 'Santa Marta', time '13:00', array[6]::smallint[], null, true),
  ('Isabel López', 'Cartagena', time '13:00', array[6]::smallint[], null, true),
  ('Isabel López', 'Santa Verónica', time '13:00', array[6]::smallint[], null, true),
  ('Isabel López', 'Santa Marta', time '06:00', array[7]::smallint[], null, true),
  ('Isabel López', 'Cartagena', time '06:00', array[7]::smallint[], null, true),
  ('Isabel López', 'Santa Verónica', time '06:00', array[7]::smallint[], null, true)
on conflict (origen, destino, hora, dias_semana) do nothing;

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
  from generate_series(0, 29) as offsets(day_offset)
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

update public.app_settings
set horas_apertura_reservas = 720
where id = 1;

update public.trips
set reservas_abren_at = fecha_salida - interval '30 days'
where fecha_salida > now()
  and estado in ('programado', 'abierto');

select public.generate_regular_trips();
