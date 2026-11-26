insert into public.trip_templates (origen, destino, hora, dias_semana, precio, activo)
values
  ('Isabel López', 'Paseo Santa Marta, Cartagena y Santa Verónica', time '13:00', array[6]::smallint[], null, true),
  ('Isabel López', 'Paseo Santa Marta, Cartagena y Santa Verónica', time '06:00', array[7]::smallint[], null, true)
on conflict (origen, destino, hora, dias_semana) do nothing;

select public.generate_regular_trips();
