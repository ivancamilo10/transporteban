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
