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
