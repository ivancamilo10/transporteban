"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, BusFront, CalendarDays, Check, Clock3, LoaderCircle, LogOut, MapPin, MessageCircle, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/configured";
import { useRouter } from "next/navigation";

type Trip = {
  id: string;
  origen: string;
  destino: string;
  fecha_salida: string;
  estado: string;
};

type Booking = {
  id: string;
  trip_id: string;
  passenger_id: string;
  seat_number: number;
  boarding_status: "pendiente" | "abordo" | "no_se_presento";
  punto_de_abordaje: string;
};

type Passenger = { id: string; full_name: string; phone: string };
type DriverTrip = Trip & { bookings: Array<Booking & { passenger: Passenger | null }> };
const tripsPerPage = 25;

export function DriverDashboard({ driverName }: { driverName: string }) {
  const supabase = useMemo(() => isSupabaseConfigured() ? createClient() : null, []);
  const router = useRouter();
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [totalTrips, setTotalTrips] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState(
    supabase ? "" : "No hay conexión con Supabase. Revisa la configuración de la aplicación.",
  );
  const [busyBookingId, setBusyBookingId] = useState("");
  const [notice, setNotice] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const requestId = useRef(0);

  const loadTrips = useCallback(async () => {
    if (!supabase) return;
    const currentRequestId = ++requestId.current;
    const { data: tripData, error: tripError, count } = await supabase
      .from("trips")
      .select("id,origen,destino,fecha_salida,estado", { count: "exact" })
      .gte("fecha_salida", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
      .order("fecha_salida", { ascending: true })
      .range(page * tripsPerPage, (page + 1) * tripsPerPage - 1);

    if (currentRequestId !== requestId.current) return;
    if (tripError) {
      setErrorMessage("No pudimos cargar los viajes. Intenta actualizar la página.");
      setLoading(false);
      return;
    }

    const tripRows = (tripData ?? []) as Trip[];
    const tripCount = count ?? 0;
    const lastPage = Math.max(0, Math.ceil(tripCount / tripsPerPage) - 1);
    setTotalTrips(tripCount);
    if (page > lastPage) {
      setPage(lastPage);
      return;
    }
    if (!tripRows.length) {
      setTrips([]);
      setErrorMessage("");
      setLoading(false);
      return;
    }

    const tripIds = tripRows.map((trip) => trip.id);
    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .select("id,trip_id,passenger_id,seat_number,boarding_status,punto_de_abordaje")
      .in("trip_id", tripIds)
      .or("estado.eq.confirmada,boarding_status.eq.no_se_presento");

    if (currentRequestId !== requestId.current) return;
    if (bookingError) {
      setErrorMessage("No pudimos cargar la lista de pasajeros. Intenta actualizar la página.");
      setLoading(false);
      return;
    }

    const bookingRows = (bookingData ?? []) as Booking[];
    const passengerIds = Array.from(new Set(bookingRows.map((booking) => booking.passenger_id)));
    const passengerRows: Passenger[] = [];
    for (let offset = 0; offset < passengerIds.length; offset += 100) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,phone")
        .in("id", passengerIds.slice(offset, offset + 100));
      if (currentRequestId !== requestId.current) return;
      if (error) {
        setErrorMessage("No pudimos cargar los datos de contacto de los pasajeros.");
        setLoading(false);
        return;
      }
      passengerRows.push(...(data ?? []) as Passenger[]);
    }

    const passengersById = new Map(passengerRows.map((passenger) => [passenger.id, passenger]));
    const bookingsByTrip = new Map<string, DriverTrip["bookings"]>();
    for (const booking of bookingRows) {
      const rows = bookingsByTrip.get(booking.trip_id) ?? [];
      rows.push({ ...booking, passenger: passengersById.get(booking.passenger_id) ?? null });
      bookingsByTrip.set(booking.trip_id, rows);
    }

    setTrips(tripRows.map((trip) => ({
      ...trip,
      bookings: (bookingsByTrip.get(trip.id) ?? []).sort((a, b) => a.seat_number - b.seat_number),
    })));
    setErrorMessage("");
    setLoading(false);
  }, [page, supabase]);

  // Supabase's asynchronous response updates the trip list after the request completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadTrips(); }, [loadTrips]);

  useEffect(() => {
    if (!supabase) return;
    let refreshTimeout: number | undefined;
    const channel = supabase
      .channel("driver-live-trip-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "seats" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleRefresh)
      .subscribe((status) => {
        const connected = status === "SUBSCRIBED";
        setRealtimeConnected(connected);
        if (connected) scheduleRefresh();
      });
    const fallbackRefresh = window.setInterval(() => { void loadTrips(); }, 30_000);
    function scheduleRefresh() {
      window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => { void loadTrips(); }, 200);
    }
    return () => {
      window.clearTimeout(refreshTimeout);
      window.clearInterval(fallbackRefresh);
      void supabase.removeChannel(channel);
      setRealtimeConnected(false);
    };
  }, [loadTrips, supabase]);

  async function updateBoarding(booking: Booking, status: "abordo" | "no_se_presento") {
    if (!supabase) return;
    if (status === "no_se_presento" && !window.confirm("¿Confirmas que esta persona no se presentó? Su puesto quedará disponible.")) return;
    setBusyBookingId(booking.id);
    setErrorMessage("");
    setNotice("");
    const { error } = await supabase.rpc("mark_booking_boarding", {
      p_booking_id: booking.id,
      p_boarding_status: status,
    });
    if (error) {
      setErrorMessage(error.message.includes("activa")
        ? "Esta reserva ya no está activa. Actualizamos la lista."
        : "No pudimos actualizar el abordaje. Intenta otra vez.");
      await loadTrips();
    } else {
      setNotice(status === "abordo" ? "Marcaste que el pasajero abordó." : "Puesto liberado; el pasajero quedó como no presentado.");
      await loadTrips();
    }
    setBusyBookingId("");
  }

  async function signOut() {
    if (!supabase) {
      setErrorMessage("No pudimos cerrar sesión porque falta la conexión con Supabase.");
      return;
    }
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage("No pudimos cerrar sesión. Inténtalo de nuevo.");
      setSigningOut(false);
      return;
    }
    router.replace("/iniciar-sesion");
    router.refresh();
  }

  const passengerCount = trips.reduce((count, trip) => count + trip.bookings.length, 0);
  const totalPages = Math.max(1, Math.ceil(totalTrips / tripsPerPage));
  const firstTripNumber = totalTrips ? page * tripsPerPage + 1 : 0;
  const lastTripNumber = Math.min((page + 1) * tripsPerPage, totalTrips);
  const goToPage = (nextPage: number) => {
    setLoading(true);
    setPage(Math.max(0, Math.min(totalPages - 1, nextPage)));
  };

  return (
    <main className="app-shell">
      <section className="my-trips-card">
        <header className="booking-header">
          <Link className="brand" href="/"><span className="brand-mark"><BusFront size={24} strokeWidth={2.2} /></span><span>Transporte Isabel López</span></Link>
          <div className="driver-header-actions">
            <Link className="booking-profile" href="/"><ArrowLeft size={17} /> Inicio</Link>
            <button className="booking-profile" disabled={signingOut} onClick={() => void signOut()} type="button">
              {signingOut ? <LoaderCircle className="spin" size={17} /> : <LogOut size={17} />}
              {signingOut ? "Cerrando..." : "Cerrar sesión"}
            </button>
          </div>
        </header>
        <div className="booking-welcome">
          <p className="eyebrow">PANEL DEL CONDUCTOR</p>
          <h1>Hola, {driverName.split(" ")[0] || "conductor"}</h1>
          <p>Pasajeros con reserva en tus próximos viajes. La lista se actualiza al instante.</p>
        </div>
        <div className="driver-summary">
          <span><CalendarDays size={20} /> {totalTrips} viajes próximos</span>
          <span><Users size={20} /> {passengerCount} pasajeros en esta página</span>
          <span className={`driver-live-status ${realtimeConnected ? "connected" : ""}`} role="status">
            <i /> {realtimeConnected ? "En tiempo real" : "Actualiza cada 30 s"}
          </span>
        </div>
        {notice && <p className="form-message success" role="status">{notice}</p>}
        {errorMessage && <p className="form-message error" role="alert"><AlertCircle size={18} /> {errorMessage}</p>}
        {loading ? (
          <div className="loading-card"><LoaderCircle className="spin" size={22} /> Cargando pasajeros...</div>
        ) : trips.length === 0 ? (
          <div className="empty-state"><div className="empty-icon"><CalendarDays size={25} /></div><h2>No hay viajes próximos</h2><p>Cuando se generen nuevos horarios, verás aquí las reservas y los datos de cada pasajero.</p></div>
        ) : (
          <>
            <div className="driver-pagination" aria-label="Paginación de viajes">
              <span>Viajes {firstTripNumber}–{lastTripNumber} de {totalTrips} · página {page + 1} de {totalPages}</span>
              <div>
                <button className="button-secondary" disabled={page === 0 || loading} onClick={() => goToPage(page - 1)} type="button">Anterior</button>
                <button className="button-secondary" disabled={page >= totalPages - 1 || loading} onClick={() => goToPage(page + 1)} type="button">Siguiente</button>
              </div>
            </div>
            <div className="driver-trip-list">
              {trips.map((trip) => {
                const tripCancelled = trip.estado === "cancelado";
                return (
                  <article className="driver-trip-card" key={trip.id}>
                    <div className="driver-trip-heading">
                      <div className="reservation-route"><span>{trip.origen}</span><b>→</b><span>{trip.destino}</span></div>
                      <span className={`status-tag ${tripCancelled ? "cancelled" : "confirmed"}`}><i /> {trip.estado.replaceAll("_", " ")}</span>
                    </div>
                    <div className="reservation-details">
                      <span><CalendarDays size={17} /> {formatTripDate(trip.fecha_salida)}</span>
                      <span><Clock3 size={17} /> {formatTripTime(trip.fecha_salida)}</span>
                      <span><Users size={17} /> {trip.bookings.length} pasajeros</span>
                    </div>
                    {trip.bookings.length === 0 ? (
                      <p className="driver-empty-passengers">Todavía no hay pasajeros reservados para este viaje.</p>
                    ) : (
                      <div className="driver-passenger-list">
                        {trip.bookings.map((booking) => (
                          <div className="driver-passenger" key={booking.id}>
                            <div className="driver-passenger-info">
                              <span className="seat-pill">Puesto {booking.seat_number}</span>
                              <strong>{booking.passenger?.full_name ?? "Pasajero"}</strong>
                              <span>{booking.passenger?.phone ?? "Teléfono no disponible"}</span>
                              <small><MapPin size={14} /> {booking.punto_de_abordaje.toLocaleUpperCase("es-CO")}</small>
                            </div>
                            <div className="driver-passenger-actions">
                              {booking.passenger && booking.passenger.phone && <a className="button button-whatsapp" href={whatsappUrl(booking.passenger.phone, booking.passenger.full_name, booking, trip)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> WhatsApp</a>}
                              {!tripCancelled && booking.boarding_status === "pendiente" ? (
                                <>
                                  <button className="button button-primary" type="button" disabled={busyBookingId === booking.id} onClick={() => void updateBoarding(booking, "abordo")}>
                                    {busyBookingId === booking.id ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Abordó
                                  </button>
                                  <button className="button button-secondary" type="button" disabled={busyBookingId === booking.id} onClick={() => void updateBoarding(booking, "no_se_presento")}>No se presentó</button>
                                </>
                              ) : tripCancelled ? (
                                <span className="status-tag cancelled"><i /> Viaje cancelado</span>
                              ) : (
                                <span className={`status-tag ${booking.boarding_status === "abordo" ? "confirmed" : "cancelled"}`}><i /> {booking.boarding_status === "abordo" ? "Abordó" : "No se presentó"}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="driver-pagination" aria-label="Paginación de viajes al final">
                <span>Viajes {firstTripNumber}–{lastTripNumber} de {totalTrips}</span>
                <div>
                  <button className="button-secondary" disabled={page === 0 || loading} onClick={() => goToPage(page - 1)} type="button">Anterior</button>
                  <button className="button-secondary" disabled={page >= totalPages - 1 || loading} onClick={() => goToPage(page + 1)} type="button">Siguiente</button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function whatsappUrl(phone: string, passengerName: string, booking: Booking, trip: Trip) {
  const digits = phone.replace(/\D/g, "");
  const internationalPhone = digits.length === 10 ? `57${digits}` : digits;
  const message = `Hola ${passengerName}, soy el conductor de Transporte Isabel López. Te escribo por tu reserva de ${trip.origen} a ${trip.destino}, a las ${formatTripTime(trip.fecha_salida)}. Tu puesto es el ${booking.seat_number}.`;
  return `https://wa.me/${internationalPhone}?text=${encodeURIComponent(message)}`;
}

function formatTripDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" }).format(new Date(value));
}

function formatTripTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
