"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BusFront, CalendarDays, Clock3, LoaderCircle, MapPin, Star, TicketCheck, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/configured";
import { PassengerNavigation } from "@/components/passenger-navigation";

type PassengerBooking = {
  id: string;
  trip_id: string;
  seat_number: number;
  estado: "confirmada" | "cancelada";
  boarding_status: "pendiente" | "abordo" | "no_se_presento";
  punto_de_abordaje: string;
  created_at: string;
  trips: {
    origen: string;
    destino: string;
    fecha_salida: string;
    precio: number | null;
    estado: string;
  } | null;
};

type BookingQueryRow = Omit<PassengerBooking, "trips"> & {
  trips: NonNullable<PassengerBooking["trips"]> | NonNullable<PassengerBooking["trips"]>[] | null;
};

export function MyTrips({ passenger, currentTime }: { passenger: { id: string; fullName: string }; currentTime: string }) {
  const supabase = useMemo(() => isSupabaseConfigured() ? createClient() : null, []);
  const [bookings, setBookings] = useState<PassengerBooking[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured());
  const [cancellingId, setCancellingId] = useState("");
  const [errorMessage, setErrorMessage] = useState(
    isSupabaseConfigured() ? "" : "No hay conexión con Supabase. Revisa la configuración de la aplicación.",
  );
  const [notice, setNotice] = useState("");

  const loadBookings = useCallback(async () => {
    await Promise.resolve();
    if (!supabase) return;
    const { data, error } = await supabase
      .from("bookings")
      .select("id,trip_id,seat_number,estado,boarding_status,punto_de_abordaje,created_at,trips(origen,destino,fecha_salida,precio,estado)")
      .eq("passenger_id", passenger.id)
      .order("created_at", { ascending: false });
    if (error) {
      setErrorMessage("No pudimos cargar tus reservas. Intenta actualizar la página.");
    } else {
      const rows = (data ?? []) as BookingQueryRow[];
      setBookings(rows.map((row) => ({
        ...row,
        trips: Array.isArray(row.trips) ? row.trips[0] ?? null : row.trips,
      })));
      setErrorMessage("");
    }
    setLoading(false);
  }, [passenger.id, supabase]);

  // Supabase's asynchronous response updates the reservations after the request completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadBookings(); }, [loadBookings]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`passenger-bookings-${passenger.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "bookings",
        filter: `passenger_id=eq.${passenger.id}`,
      }, () => { void loadBookings(); })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "trips",
      }, () => { void loadBookings(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadBookings, passenger.id, supabase]);

  async function cancelBooking(booking: PassengerBooking) {
    if (!supabase) return;
    if (!window.confirm("¿Quieres cancelar esta reserva? Si cancelas, el puesto quedará disponible para otra persona.")) return;
    setCancellingId(booking.id);
    setErrorMessage("");
    setNotice("");
    const { error } = await supabase.rpc("cancel_trip_booking", { p_booking_id: booking.id });
    if (error) {
      setErrorMessage(friendlyCancelError(error.message));
    } else {
      setNotice("Tu reserva quedó cancelada y el puesto está disponible.");
      await loadBookings();
    }
    setCancellingId("");
  }

  const upcoming = bookings.filter((booking) => booking.estado === "confirmada" && booking.trips && Date.parse(booking.trips.fecha_salida) > Date.parse(currentTime));
  const past = bookings.filter((booking) => !upcoming.includes(booking));

  return (
    <main className="app-shell">
      <section className="my-trips-card">
        <header className="booking-header">
          <Link className="brand" href="/"><span className="brand-mark"><BusFront size={24} strokeWidth={2.2} /></span><span>TransporteBan</span></Link>
          <Link className="booking-profile" href="/inicio"><ArrowLeft size={17} /> Buscar viaje</Link>
        </header>
        <div className="booking-welcome">
          <p className="eyebrow">MIS VIAJES</p>
          <h1>Tus reservas, {passenger.fullName.split(" ")[0] || "viajero"}</h1>
          <p>Ten a la mano los detalles de tus próximos viajes.</p>
        </div>
        {notice && <p className="form-message success" role="status">{notice}</p>}
        {errorMessage && <p className="form-message error" role="alert">{errorMessage}</p>}
        {loading ? (
          <div className="loading-card"><LoaderCircle className="spin" size={22} /> Cargando tus viajes...</div>
        ) : upcoming.length ? (
          <>
            <section className="reservations-section">
              <h2>Próximos viajes</h2>
              <div className="reservation-list">
                {upcoming.map((booking) => (
                  <BookingCard key={booking.id} booking={booking} cancelling={cancellingId === booking.id} onCancel={() => void cancelBooking(booking)} />
                ))}
              </div>
            </section>
            {past.length > 0 && <BookingHistory bookings={past} currentTime={currentTime} />}
          </>
        ) : bookings.length ? (
          <BookingHistory bookings={bookings} currentTime={currentTime} />
        ) : (
          <div className="empty-state"><div className="empty-icon"><TicketCheck size={25} /></div><h2>Aún no tienes reservas</h2><p>Busca un horario, elige tu puesto y aquí encontrarás los detalles del viaje.</p><Link className="button button-primary" href="/inicio">Buscar un viaje</Link></div>
        )}
      </section>
      <PassengerNavigation />
    </main>
  );
}

function BookingCard({ booking, cancelling, onCancel }: { booking: PassengerBooking; cancelling: boolean; onCancel: () => void }) {
  const trip = booking.trips;
  if (!trip) return null;
  const tripCancelled = trip.estado === "cancelado";
  return (
    <article className="reservation-card">
      <div className="reservation-route"><span>{trip.origen}</span><b>→</b><span>{trip.destino}</span></div>
      <div className="reservation-details">
        <span><CalendarDays size={17} /> {formatTripDate(trip.fecha_salida)}</span>
        <span><Clock3 size={17} /> {formatTripTime(trip.fecha_salida)}</span>
        <span><Users size={17} /> Puesto {booking.seat_number}</span>
        <span><MapPin size={17} /> {booking.punto_de_abordaje}</span>
      </div>
      {trip.precio !== null && <p className="reservation-price">{formatMoney(Number(trip.precio))} <small>Pago al abordar</small></p>}
      <div className="reservation-footer">
        <span className={`status-tag ${tripCancelled ? "cancelled" : "confirmed"}`}><i /> {tripCancelled ? "Viaje cancelado" : "Confirmada"}</span>
        {!tripCancelled && <button className="text-button danger-text" disabled={cancelling} onClick={onCancel} type="button">
          {cancelling ? <><LoaderCircle className="spin" size={16} /> Cancelando...</> : "Cancelar reserva"}
        </button>}
      </div>
    </article>
  );
}

function BookingHistory({ bookings, currentTime }: { bookings: PassengerBooking[]; currentTime: string }) {
  return (
    <section className="reservations-section">
      <h2>Viajes anteriores</h2>
      <div className="reservation-list">
        {bookings.map((booking) => {
          const trip = booking.trips;
          if (!trip) return null;
          return (
            <article className="reservation-card past-booking" key={booking.id}>
              <div className="reservation-route"><span>{trip.origen}</span><b>→</b><span>{trip.destino}</span></div>
              <div className="reservation-details">
                <span><CalendarDays size={17} /> {formatTripDate(trip.fecha_salida)}</span>
                <span><Clock3 size={17} /> {formatTripTime(trip.fecha_salida)}</span>
                <span><Users size={17} /> Puesto {booking.seat_number}</span>
              </div>
              <span className={`status-tag ${booking.estado === "cancelada" ? "cancelled" : "past"}`}><i /> {booking.estado === "cancelada" ? "Cancelada" : "Finalizada"}</span>
              {booking.estado === "confirmada"
                && booking.boarding_status === "abordo"
                && (trip.estado === "llego" || Date.parse(trip.fecha_salida) <= Date.parse(currentTime))
                && <TripRating tripId={booking.trip_id} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TripRating({ tripId }: { tripId: string }) {
  const supabase = useMemo(() => isSupabaseConfigured() ? createClient() : null, []);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from("ratings").select("estrellas,comentario").eq("trip_id", tripId).maybeSingle().then(({ data }) => {
      if (data) {
        setStars(Number(data.estrellas));
        setComment(data.comentario ?? "");
        setSaved(true);
      }
    });
  }, [supabase, tripId]);

  async function submitRating() {
    if (!supabase || stars < 1) return;
    setSaving(true);
    setErrorMessage("");
    const { error } = await supabase.rpc("submit_trip_rating", {
      p_trip_id: tripId,
      p_stars: stars,
      p_comment: comment.trim() || null,
    });
    if (error) {
      setErrorMessage("No pudimos guardar tu calificación. Inténtalo otra vez.");
    } else {
      setSaved(true);
    }
    setSaving(false);
  }

  return (
    <div className="rating-panel">
      <strong>{saved ? "Gracias por calificar" : "¿Cómo te fue en este viaje?"}</strong>
      <div className="rating-stars" role="group" aria-label="Calificación de 1 a 5 estrellas">
        {[1, 2, 3, 4, 5].map((star) => (
          <button aria-label={`${star} ${star === 1 ? "estrella" : "estrellas"}`} aria-pressed={stars === star} disabled={saved} key={star} onClick={() => setStars(star)} type="button">
            <Star size={24} fill={star <= stars ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      {!saved && <>
        <label className="rating-comment">Comentario (opcional)<textarea maxLength={500} placeholder="Cuéntanos cómo te fue" value={comment} onChange={(event) => setComment(event.target.value)} /></label>
        {errorMessage && <small className="field-error" role="alert">{errorMessage}</small>}
        <button className="button button-primary" disabled={saving || stars < 1} onClick={() => void submitRating()} type="button">{saving ? "Guardando..." : "Enviar calificación"}</button>
      </>}
    </div>
  );
}

function formatTripDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" }).format(new Date(value));
}

function formatTripTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function friendlyCancelError(error: string) {
  if (/no tienes permiso/i.test(error)) return "No puedes cancelar esta reserva.";
  if (/ya fue cancelada/i.test(error)) return "Esta reserva ya estaba cancelada.";
  if (/inicia sesión/i.test(error)) return "Tu sesión terminó. Inicia sesión de nuevo para continuar.";
  return "No pudimos cancelar la reserva. Inténtalo otra vez.";
}
