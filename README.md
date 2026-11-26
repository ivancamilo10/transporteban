# Transporte Isabel López

Aplicación mobile-first para administrar los viajes de una van en la ruta Isabel López ⇄ Sabanalarga, construida con Next.js 16 (cumple el requisito Next.js 14+), TypeScript, Tailwind y Supabase. Incluye registro con teléfono obligatorio, reservas en tiempo real, panel del conductor y administración de cuentas.

## Requisitos

- Node.js 20.9 o superior y npm
- Proyecto Supabase
- Cuenta de Vercel para despliegue (opcional durante desarrollo)

## Preparar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com/).
2. Si es una instalación nueva, copia y ejecuta una sola vez `supabase/setup.sql` en **SQL Editor**. También puedes ejecutar en orden los archivos de `supabase/migrations/`:
   - `202611250001_initial_schema_and_seed.sql`
   - `202611250002_trips_and_live_bookings.sql`
   - `202611250003_admin_and_driver_operations.sql`
   - `202611250004_waitlist_notifications_ratings.sql`
   - `202611250005_updated_departure_schedule.sql`
   - `202611250006_saturday_half_day_schedule.sql`
   - `202611250007_weekend_sightseeing_routes.sql`
   - `202611250008_weekend_advance_booking.sql`
3. En **Project Settings → API**, copia la URL del proyecto y la clave `anon` pública.
4. En **Authentication → URL Configuration**, configura la URL local `http://localhost:3000` y, al desplegar, agrega también el dominio de Vercel a Site URL y Redirect URLs.
5. Si no quieres verificar correo para el registro, abre **Authentication → Providers → Email** y desactiva **Confirm email**. La aplicación conserva la sesión en almacenamiento del navegador y cookies seguras del servidor.

La primera migración crea perfiles, configuración, vehículo y plantillas; activa RLS y asigna automáticamente a cada registro el rol `passenger`. Semilla 26 salidas entre semana: Isabel López sale cada hora en punto de 5:00 a. m. a 5:00 p. m.; Sabanalarga sale cada hora y media de 5:30 a. m. a 5:30 p. m. El sábado el servicio termina al mediodía: última salida a las 12:00 p. m. desde Isabel López y a las 11:30 a. m. desde Sabanalarga. La aplicación genera viajes hasta 30 días adelante y permite reservar dentro de ese periodo. Los precios se dejan sin definir para que el conductor los configure; no se inventan tarifas.

La segunda migración crea viajes, puestos y reservas; instala funciones transaccionales para tomar, confirmar y cancelar un puesto; publica cambios de puestos y viajes en Supabase Realtime; y genera los viajes de los próximos siete días. También configura `pg_cron` para renovar los viajes cada día y liberar puestos temporales vencidos cada minuto.

La tercera migración agrega el rol administrador, permisos para que el conductor vea únicamente a pasajeros con reserva activa, y la acción segura para marcar el abordaje y liberar puestos si alguien no se presenta. Publica también los perfiles para actualizar el panel administrativo en tiempo real.

La cuarta migración agrega lista de espera con reserva temporal automática del puesto liberado, avisos dentro de la app y recordatorios programados una hora antes, calificaciones de viajes finalizados, y almacenamiento seguro de las suscripciones Web Push. El service worker recibe y muestra notificaciones push cuando un emisor del servidor está configurado.

La quinta migración actualiza las plantillas existentes y mueve los viajes futuros generados a los horarios corregidos, sin cambiar viajes pasados ni los horarios personalizados que no coinciden con la semilla anterior. La sexta separa los horarios entre semana y sábado, reprograma los viajes futuros del sábado hasta el mediodía y cancela las salidas posteriores que ya se hubieran generado. La séptima agrega paseos independientes desde Isabel López a Santa Marta, Cartagena o Santa Verónica, los sábados a la 1:00 p. m. (después del servicio local) y los domingos a las 6:00 a. m.; el precio queda sin definir. La octava abre reservas con hasta 30 días de anticipación y genera los viajes futuros; ejecútala para habilitar los paseos en una instalación existente. Si ya ejecutaste `setup.sql` o las migraciones hasta la 007, ejecuta solamente `202611250008_weekend_advance_booking.sql`; no vuelvas a ejecutar `setup.sql`.

### Crear las cuentas de administrador y conductor

El registro público nunca permite escoger un rol privilegiado. No hay contraseñas predeterminadas en el repositorio. Crea la cuenta de administrador en Supabase Auth con el usuario/correo `admin@transporteban.test` y define su contraseña directamente en el panel privado de Supabase. Luego ejecuta:

```sql
update public.profiles
set role = 'admin', phone = '<teléfono del administrador>'
where id = (
  select id from auth.users
  where email = 'admin@transporteban.test'
);
```

Desde `/admin`, el administrador crea la cuenta del conductor con nombre, teléfono, usuario `conductor` y una contraseña definida en el formulario. Ingresa los teléfonos y las contraseñas directamente en la base de datos o el formulario privado, nunca en archivos públicos del repositorio. El registro público siempre crea pasajeros y no permite elevar roles. Si una contraseña se compartió públicamente, cámbiala antes de usarla.

En el inicio de sesión puedes ingresar correo o usuario. Los usuarios creados desde `/admin` se resuelven internamente al dominio `.test`, que no recibe mensajes ni enlaces para recuperar contraseña; el administrador debe compartir la contraseña inicial directamente. Usa correos reales para las cuentas que necesiten recuperar contraseña.

Para asignar manualmente el rol de conductor a una cuenta registrada:

```sql
update public.profiles
set role = 'driver'
where id = (
  select id from auth.users
  where email = 'correo-del-conductor@ejemplo.com'
);
```

## Ejecutar en local

```bash
npm install
Copy-Item .env.example .env.local
```

Completa `.env.local` con las variables de Supabase:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-jwt
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-public-key
```

`SUPABASE_SERVICE_ROLE_KEY` es la clave JWT privada `service_role`, solo se utiliza en el servidor para crear cuentas de conductores. Cópiala desde las API Keys del proyecto Supabase, no le pongas el prefijo `NEXT_PUBLIC_`, no la compartas ni la incluyas en Git y configúrala como variable privada en Vercel. Una clave `sb_secret_...` no reemplaza esta JWT para las operaciones de administración de Auth. Si alguna clave secreta se compartió públicamente, rótala desde Supabase antes de desplegar.

Las notificaciones dentro de la app y los recordatorios programados funcionan con Supabase. El service worker y el registro de dispositivos preparan Web Push; para enviar notificaciones push fuera de la app también hace falta configurar un emisor de servidor y sus llaves VAPID.

Luego ejecuta:

```bash
npm run dev
```

Abre `http://localhost:3000`. Las rutas listas son `/`, `/registro`, `/iniciar-sesion`, `/recuperar-contrasena`, `/inicio`, `/mis-viajes`, `/avisos`, `/perfil`, `/conductor` y `/admin`.

## Desplegar en Vercel

1. Importa el repositorio en Vercel y usa la configuración predeterminada de Next.js.
2. Define `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y, si vas a habilitar suscripciones Web Push, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` en los entornos Preview y Production. Mantén las claves privadas únicamente en el servidor.
3. Despliega y agrega el dominio de producción en Supabase **Authentication → URL Configuration**.

## Fases de entrega

1. **Base + autenticación + base de datos y semilla:** completada.
2. **Viajes y reservas en tiempo real:** completada; viajes desde plantillas, mapa de puestos, reservas atómicas, expiración, cancelación y Realtime.
3. **Panel de conductor y administración:** completado; lista de pasajeros con actualización en vivo, contacto individual por WhatsApp, control de abordaje, listado de cuentas e invitaciones de conductor.
4. **Extras y PWA:** completada; lista de espera, avisos Realtime, recordatorios programados, calificaciones, tutorial, modo sin conexión, manifest, instalación y base para Web Push.
