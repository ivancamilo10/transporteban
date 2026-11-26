"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpDown, BusFront, CalendarDays, Check, Clock3, LoaderCircle, MapPin, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/configured";
import { PassengerNavigation } from "@/components/passenger-navigation";
import { Tutorial } from "@/components/tutorial";

type Passenger = { id: string; fullName: string; phone: string };
type RouteTemplate = { origen: string; destino: string; activo: boolean; dias_semana: number[] };
type Trip = {
  id: string;
  origen: string;
  destino: string;
  fecha_salida: string;
  precio: number | null;
  estado: string;
  reservas_abren_at: string;
};
type Seat = {
  trip_id: string;
  seat_number: number;
  estado: "libre" | "reservado_temporal" | "ocupado" | "bloqueado";
  hold_expires_at: string | null;
};
type Settings = { whatsapp_conductor: string };
type WaitlistEntry = { estado: "esperando" | "notificada" | "reservada" | "vencida" | "retirada"; claim_expires_at: string | null };
type BookingResult = { id: string; trip: Trip; seatNumber: number };
type FavoriteJourney = { origen: string; destino: string; hora: string; punto_de_abordaje: string };

const passengerSchema = z.object({
  fullName: z.string().trim().min(3, "Escribe tu nombre completo."),
  phone: z.string().trim().min(7, "Escribe un teléfono válido."),
  boardingPoint: z.string().trim().min(3, "Indica dónde te vas a subir."),
});

const boardingPointsByOrigin: Record<string, string[]> = {
  "Isabel López": ["Colegio Bachillerato", "Cañaña", "CDI", "Tienda Boulevard", "El Guachi", "Otros"],
  Sabanalarga: ["Olímpica", "Hospital", "Centro", "Mercado", "D1 Cordialidad", "Otros"],
};

const weekendTourDestinations = ["Santa Marta", "Cartagena", "Santa Verónica"];

export function TripBooking({ passenger }: { passenger: Passenger }) {
  const supabase = useMemo(() => isSupabaseConfigured() ? createClient() : null, []);
  const [templates, setTemplates] = useState<RouteTemplate[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [travelDate, setTravelDate] = useState(() => getBogotaDate());
  const [trips, setTrips] = useState<Trip[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [capacity, setCapacity] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [waitlistEntry, setWaitlistEntry] = useState<WaitlistEntry | null>(null);
  const [favoriteJourney, setFavoriteJourney] = useState<FavoriteJourney | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fullName, setFullName] = useState(passenger.fullName);
  const [phone, setPhone] = useState(passenger.phone);
  const [boardingPoint, setBoardingPoint] = useState("");
  const [otherBoardingPoint, setOtherBoardingPoint] = useState("");
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured());
  const [saving, setSaving] = useState(false);
  const [quickReserving, setQuickReserving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(
    isSupabaseConfigured() ? "" : "Falta conectar Supabase. Revisa las variables de entorno para cargar los viajes.",
  );

  useEffect(() => {
    const saved = window.localStorage.getItem("transporteban-favorite-journey");
    if (!saved) return;
    try {
      const favorite = JSON.parse(saved) as FavoriteJourney;
      if (favorite.origen && favorite.destino && favorite.hora && favorite.punto_de_abordaje) {
        // The saved route is read once after the first client render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFavoriteJourney(favorite);
      }
    } catch {
      window.localStorage.removeItem("transporteban-favorite-journey");
    }
  }, []);

  const weekday = new Date(`${travelDate}T12:00:00Z`).getUTCDay() || 7;
  const availableRoutes = useMemo(
    () => templates.filter((route) => route.activo && route.dias_semana.includes(weekday)),
    [templates, weekday],
  );
  const routeOrigins = useMemo(
    () => Array.from(new Set(availableRoutes.map((route) => route.origen))),
    [availableRoutes],
  );
  const selectedOrigin = routeOrigins.includes(origin) ? origin : routeOrigins[0] ?? "";
  const routeDestinations = useMemo(
    () => {
      const destinations = availableRoutes
        .filter((route) => route.origen === selectedOrigin)
        .map((route) => route.destino);
      if (selectedOrigin === "Isabel López" && (weekday === 6 || weekday === 7)) {
        destinations.push(...weekendTourDestinations);
      }
      return Array.from(new Set(destinations));
    },
    [availableRoutes, selectedOrigin, weekday],
  );
  const selectedDestination = routeDestinations.includes(destination) ? destination : routeDestinations[0] ?? "";
  const canSwapRoute = availableRoutes.some((route) => route.origen === selectedDestination && route.destino === selectedOrigin);
  const boardingPointOptions = boardingPointsByOrigin[selectedOrigin] ?? [];
  const isOtherBoardingPoint = boardingPoint === "Otros";
  const isKnownBoardingPoint = boardingPointOptions.includes(boardingPoint);
  let selectedBoardingPoint = "";
  if (isOtherBoardingPoint) selectedBoardingPoint = otherBoardingPoint.trim();
  else if (isKnownBoardingPoint) selectedBoardingPoint = boardingPoint;
  const selectedBoardingPointOption = isOtherBoardingPoint || isKnownBoardingPoint ? boardingPoint : "";
  const holdSecondsLeft = holdExpiresAt ? Math.max(0, Math.ceil((Date.parse(holdExpiresAt) - now) / 1000)) : 0;
  const reservationsOpen = selectedTrip ? Date.parse(selectedTrip.reservas_abren_at) <= now : false;

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    async function loadSetup() {
      const [templateResult, settingsResult, vehicleResult] = await Promise.all([
        client.from("trip_templates").select("origen,destino,activo,dias_semana").eq("activo", true).order("origen"),
        client.from("app_settings").select("whatsapp_conductor").eq("id", 1).maybeSingle(),
        client.from("vehicle").select("capacidad_pasajeros").eq("id", 1).maybeSingle(),
      ]);
      if (!active) return;
      if (templateResult.error || settingsResult.error || vehicleResult.error) {
        setLoadError("No pudimos cargar los horarios. Intenta actualizar la página.");
        setLoading(false);
        return;
      }
      const routeList = (templateResult.data ?? []) as RouteTemplate[];
      const vehicle = vehicleResult.data as { capacidad_pasajeros: number } | null;
      if (!settingsResult.data || !vehicle || vehicle.capacidad_pasajeros < 1) {
        setLoadError("Falta completar la configuración del vehículo o del servicio.");
        setLoading(false);
        return;
      }
      setTemplates(routeList);
      setSettings(settingsResult.data as Settings);
      setCapacity(vehicle.capacidad_pasajeros);
      const firstRoute = routeList[0];
      if (firstRoute) {
        setOrigin(firstRoute.origen);
        setDestination(firstRoute.destino);
      } else {
        setLoadError("Todavía no hay horarios activos. Comunícate con el conductor para consultar.");
        setLoading(false);
      }
    }
    void loadSetup();
    return () => { active = false; };
  }, [supabase]);

  const loadTrips = useCallback(async () => {
    if (!selectedOrigin || !selectedDestination || !supabase) return;
    setLoadError("");
    const start = new Date(`${travelDate}T00:00:00-05:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from("trips")
      .select("id,origen,destino,fecha_salida,precio,estado,reservas_abren_at")
      .eq("origen", selectedOrigin)
      .eq("destino", selectedDestination)
      .gt("fecha_salida", new Date().toISOString())
      .gte("fecha_salida", start.toISOString())
      .lt("fecha_salida", end.toISOString())
      .in("estado", ["programado", "abierto"])
      .order("fecha_salida");
    if (error) {
      setTrips([]);
      setLoadError("No pudimos buscar viajes. Revisa tu conexión e inténtalo de nuevo.");
      setLoading(false);
      return;
    }
    const foundTrips = (data ?? []) as Trip[];
    setTrips(foundTrips);
    if (foundTrips.length) {
      const { data: seatData, error: seatError } = await supabase
        .from("seats")
        .select("trip_id,seat_number,estado,hold_expires_at")
        .in("trip_id", foundTrips.map((trip) => trip.id));
      if (seatError) {
        setLoadError("Encontramos los viajes, pero no pudimos cargar los puestos.");
      } else {
        setSeats((seatData ?? []) as Seat[]);
      }
    } else {
      setSeats([]);
    }
    setLoading(false);
  }, [selectedDestination, selectedOrigin, supabase, travelDate]);

  // Supabase's asynchronous response updates the trip list after the request completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadTrips(); }, [loadTrips]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("live-seat-availability")
      .on("postgres_changes", { event: "*", schema: "public", table: "seats" }, () => { void loadTrips(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, (payload) => {
        void loadTrips();
        const updatedTrip = payload.new as { id?: string; estado?: string };
        if (selectedTrip?.id === updatedTrip.id && updatedTrip.estado && !["programado", "abierto"].includes(updatedTrip.estado)) {
          setSelectedTrip(null);
          setSelectedSeat(null);
          setHoldExpiresAt(null);
          setMessage(updatedTrip.estado === "cancelado"
            ? "El conductor canceló este viaje. Elige otro horario."
            : "Este viaje ya salió y no acepta más reservas.");
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadTrips, selectedTrip, supabase]);

  useEffect(() => {
    if (!selectedTrip || !supabase) return;
    let active = true;
    const refreshSelectedTrip = async () => {
      const [{ data: seatData }, { data: ownHolds }, { data: waitlistData }] = await Promise.all([
        supabase.from("seats").select("trip_id,seat_number,estado,hold_expires_at").eq("trip_id", selectedTrip.id),
        supabase.rpc("get_my_trip_seat_holds", { p_trip_id: selectedTrip.id }),
        supabase.from("waitlist").select("estado,claim_expires_at").eq("trip_id", selectedTrip.id).eq("passenger_id", passenger.id).maybeSingle(),
      ]);
      if (!active) return;
      if (seatData) {
        setSeats((previous) => [
          ...previous.filter((seat) => seat.trip_id !== selectedTrip.id),
          ...(seatData as Seat[]),
        ]);
      }
      const myHold = ((ownHolds ?? []) as { seat_number: number; hold_expires_at: string }[])
        .find((hold) => Date.parse(hold.hold_expires_at) > Date.now());
      if (myHold) {
        setSelectedSeat(myHold.seat_number);
        setHoldExpiresAt(myHold.hold_expires_at);
      } else if (holdExpiresAt && selectedTrip.id === booking?.trip.id) {
        setSelectedSeat(null);
        setHoldExpiresAt(null);
      }
      setWaitlistEntry((waitlistData ?? null) as WaitlistEntry | null);
    };
    void refreshSelectedTrip();
    const channel = supabase
      .channel(`trip-live-${selectedTrip.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "seats", filter: `trip_id=eq.${selectedTrip.id}` }, () => { void refreshSelectedTrip(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "waitlist", filter: `passenger_id=eq.${passenger.id}` }, () => { void refreshSelectedTrip(); })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [booking?.trip.id, holdExpiresAt, loadTrips, passenger.id, selectedTrip, supabase]);

  useEffect(() => {
    if (!holdExpiresAt || !supabase) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.parse(holdExpiresAt) <= Date.now()) {
        setSelectedSeat(null);
        setHoldExpiresAt(null);
        if (selectedTrip) {
          void supabase.from("seats").select("trip_id,seat_number,estado,hold_expires_at").eq("trip_id", selectedTrip.id)
            .then(({ data }) => { if (data) setSeats((previous) => [...previous.filter((seat) => seat.trip_id !== selectedTrip.id), ...(data as Seat[])]); });
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [holdExpiresAt, selectedTrip, supabase]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(clock);
  }, []);

  const seatsForSelectedTrip = selectedTrip ? seats.filter((seat) => seat.trip_id === selectedTrip.id) : [];
  const freeSeats = (tripId: string) => seats.filter((seat) => {
    if (seat.trip_id !== tripId) return false;
    return seat.estado === "libre" || isExpiredHold(seat, now);
  }).length;

  async function releaseCurrentHold() {
    if (supabase && selectedTrip && selectedSeat !== null) {
      await supabase.rpc("release_my_trip_seat_hold", {
        p_trip_id: selectedTrip.id,
        p_seat_number: selectedSeat,
      });
    }
    setSelectedSeat(null);
    setHoldExpiresAt(null);
  }

  async function changeSearch(change: () => void) {
    await releaseCurrentHold();
    setSelectedTrip(null);
    setStep(1);
    setLoading(true);
    setMessage("");
    change();
  }

  async function chooseTrip(trip: Trip) {
    if (selectedTrip && selectedSeat !== null && selectedTrip.id !== trip.id) {
      await releaseCurrentHold();
    }
    if (selectedTrip?.id !== trip.id) {
      setSelectedSeat(null);
      setHoldExpiresAt(null);
    }
    setSelectedTrip(trip);
    setWaitlistEntry(null);
    setStep(1);
    setMessage("");
    setBooking(null);
  }

  async function joinWaitlist() {
    if (!selectedTrip || !supabase) return;
    setSaving(true);
    setMessage("");
    const { error } = await supabase.rpc("join_trip_waitlist", { p_trip_id: selectedTrip.id });
    if (error) {
      setMessage(friendlyWaitlistError(error.message));
    } else {
      setWaitlistEntry({ estado: "esperando", claim_expires_at: null });
      setMessage("Listo, te avisaremos si se libera un puesto.");
    }
    setSaving(false);
  }

  function saveFavoriteJourney() {
    if (!booking) return;
    const favorite = {
      origen: booking.trip.origen,
      destino: booking.trip.destino,
      hora: getBogotaTime(booking.trip.fecha_salida),
      punto_de_abordaje: selectedBoardingPoint,
    };
    window.localStorage.setItem("transporteban-favorite-journey", JSON.stringify(favorite));
    setFavoriteJourney(favorite);
    setMessage("Guardamos tu viaje de siempre en este dispositivo.");
  }

  async function quickReserveFavorite() {
    if (!favoriteJourney || !supabase) return;
    setQuickReserving(true);
    setMessage("");
    const today = getBogotaDate();
    const start = new Date(`${today}T00:00:00-05:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const { data: tripData, error: tripError } = await supabase
      .from("trips")
      .select("id,origen,destino,fecha_salida,precio,estado,reservas_abren_at")
      .eq("origen", favoriteJourney.origen)
      .eq("destino", favoriteJourney.destino)
      .gte("fecha_salida", start.toISOString())
      .lt("fecha_salida", end.toISOString())
      .gt("fecha_salida", new Date().toISOString())
      .in("estado", ["programado", "abierto"])
      .order("fecha_salida");
    if (tripError) {
      setMessage("No pudimos buscar tu horario habitual. Inténtalo otra vez.");
      setQuickReserving(false);
      return;
    }
    const trip = ((tripData ?? []) as Trip[]).find((candidate) => getBogotaTime(candidate.fecha_salida) === favoriteJourney.hora);
    if (!trip) {
      setMessage("Hoy no hay un viaje futuro en tu horario de siempre. Busca otro horario.");
      setQuickReserving(false);
      return;
    }
    if (Date.parse(trip.reservas_abren_at) > Date.now()) {
      setMessage("Las reservas de tu horario de siempre todavía no están abiertas.");
      setQuickReserving(false);
      return;
    }

    const { data: seatData, error: seatError } = await supabase
      .from("seats")
      .select("seat_number,estado,hold_expires_at")
      .eq("trip_id", trip.id)
      .order("seat_number");
    if (seatError) {
      setMessage("No pudimos revisar los puestos. Inténtalo otra vez.");
      setQuickReserving(false);
      return;
    }
    const availableSeat = ((seatData ?? []) as Pick<Seat, "seat_number" | "estado" | "hold_expires_at">[])
      .find((seat) => seat.estado === "libre" || (seat.estado === "reservado_temporal" && seat.hold_expires_at && Date.parse(seat.hold_expires_at) <= Date.now()));
    if (!availableSeat) {
      setMessage("Tu horario de siempre está lleno. Puedes unirte a la lista de espera desde la búsqueda.");
      setQuickReserving(false);
      return;
    }

    const { error: holdError } = await supabase.rpc("hold_trip_seat", {
      p_trip_id: trip.id,
      p_seat_number: availableSeat.seat_number,
    });
    if (holdError) {
      setMessage(friendlyBookingError(holdError.message));
      setQuickReserving(false);
      void loadTrips();
      return;
    }

    const { data: bookingId, error: bookingError } = await supabase.rpc("confirm_trip_booking", {
      p_trip_id: trip.id,
      p_seat_number: availableSeat.seat_number,
      p_punto_de_abordaje: favoriteJourney.punto_de_abordaje,
    });
    if (bookingError) {
      await supabase.rpc("release_my_trip_seat_hold", { p_trip_id: trip.id, p_seat_number: availableSeat.seat_number });
      setMessage(friendlyBookingError(bookingError.message));
      setQuickReserving(false);
      void loadTrips();
      return;
    }

    setOrigin(trip.origen);
    setDestination(trip.destino);
    setTravelDate(today);
    setSelectedTrip(trip);
    setSelectedSeat(availableSeat.seat_number);
    setBoardingPoint(boardingPointOptions.includes(favoriteJourney.punto_de_abordaje)
      ? favoriteJourney.punto_de_abordaje
      : "Otros");
    setOtherBoardingPoint(boardingPointOptions.includes(favoriteJourney.punto_de_abordaje)
      ? ""
      : favoriteJourney.punto_de_abordaje);
    setHoldExpiresAt(null);
    setBooking({ id: String(bookingId), trip, seatNumber: availableSeat.seat_number });
    setMessage("");
    setQuickReserving(false);
  }

  async function chooseSeat(seat: Seat) {
    if (!selectedTrip || !supabase) return;
    if (!reservationsOpen) {
      setMessage(`Los puestos se habilitan ${formatDateTime(selectedTrip.reservas_abren_at)}.`);
      return;
    }
    if (seat.estado !== "libre" && !isExpiredHold(seat, Date.now()) && seat.seat_number !== selectedSeat) {
      setMessage("Este puesto ya fue tomado. Elige otro.");
      return;
    }

    setSaving(true);
    setFieldErrors({});
    setMessage("");
    if (selectedSeat !== null && selectedSeat !== seat.seat_number) {
      await supabase.rpc("release_my_trip_seat_hold", {
        p_trip_id: selectedTrip.id,
        p_seat_number: selectedSeat,
      });
    }
    const { data, error } = await supabase.rpc("hold_trip_seat", {
      p_trip_id: selectedTrip.id,
      p_seat_number: seat.seat_number,
    });
    if (error) {
      setMessage(friendlyBookingError(error.message));
      await refreshCurrentSeats();
    } else {
      const hold = data as { hold_expires_at: string };
      setSelectedSeat(seat.seat_number);
      setHoldExpiresAt(hold.hold_expires_at);
      setNow(Date.now());
    }
    setSaving(false);
  }

  async function refreshCurrentSeats() {
    if (!selectedTrip || !supabase) return;
    const { data } = await supabase.from("seats").select("trip_id,seat_number,estado,hold_expires_at").eq("trip_id", selectedTrip.id);
    if (data) setSeats((previous) => [...previous.filter((seat) => seat.trip_id !== selectedTrip.id), ...(data as Seat[])]);
  }

  function continueToDetails() {
    const validation = passengerSchema.safeParse({ fullName, phone, boardingPoint: selectedBoardingPoint });
    if (!validation.success) {
      setFieldErrors(Object.fromEntries(validation.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    if (!selectedTrip || selectedSeat === null || holdSecondsLeft <= 0) {
      setMessage("El tiempo para guardar tu puesto terminó. Elige un puesto disponible.");
      setStep(1);
      return;
    }
    setFieldErrors({});
    setMessage("");
    setStep(3);
  }

  async function confirmBooking() {
    if (!selectedTrip || selectedSeat === null || !supabase) return;
    setSaving(true);
    setMessage("");
    const { error: profileError } = await supabase.from("profiles").update({
      full_name: fullName.trim(),
      phone: phone.trim(),
    }).eq("id", passenger.id);
    if (profileError) {
      setMessage("No pudimos guardar tus datos de contacto. Revisa tu perfil e inténtalo otra vez.");
      setSaving(false);
      return;
    }
    const { data, error } = await supabase.rpc("confirm_trip_booking", {
      p_trip_id: selectedTrip.id,
      p_seat_number: selectedSeat,
      p_punto_de_abordaje: selectedBoardingPoint,
    });
    if (error) {
      setMessage(friendlyBookingError(error.message));
      await refreshCurrentSeats();
      setStep(1);
      setSelectedSeat(null);
      setHoldExpiresAt(null);
    } else {
      setBooking({ id: String(data), trip: selectedTrip, seatNumber: selectedSeat });
      setHoldExpiresAt(null);
      void loadTrips();
    }
    setSaving(false);
  }

  function swapRoute() {
    if (!selectedDestination) return;
    void changeSearch(() => {
      setOrigin(selectedDestination);
      setDestination(selectedOrigin);
      setBoardingPoint("");
      setOtherBoardingPoint("");
    });
  }

  function chooseWeekendTour(day: 6 | 7) {
    const date = getNextWeekdayDate(day);
    void changeSearch(() => {
      setTravelDate(date);
      setOrigin("Isabel López");
      setDestination("Santa Marta");
      setBoardingPoint("");
      setOtherBoardingPoint("");
    });
  }

  const whatsappText = booking
    ? `Hola, tengo reserva en el viaje de las ${formatTime(booking.trip.fecha_salida)} de ${booking.trip.origen} a ${booking.trip.destino}. Mi puesto es el ${booking.seatNumber}.`
    : "";
  const whatsappNumber = settings?.whatsapp_conductor
    ? normalizeColombianPhone(settings.whatsapp_conductor)
    : "";
  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappText)}`
    : `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  return (
    <main className="app-shell booking-shell">
      <section className="booking-card">
        <Tutorial autoStart />
        <header className="booking-header">
          <Link className="brand" href="/"><span className="brand-mark"><BusFront size={24} strokeWidth={2.2} /></span><span>Transporte Isabel López</span></Link>
          <Link className="booking-profile" href="/mis-viajes">Mis viajes</Link>
        </header>
        <div className="booking-welcome">
          <p className="eyebrow">VIAJA CON CONFIANZA</p>
          <h1>Hola, {passenger.fullName.split(" ")[0] || "viajero"} 👋</h1>
          <p>Busca tu horario y elige tu puesto.</p>
        </div>

        {booking ? (
          <motion.section className="booking-success" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="success-icon"><Check size={30} /></div>
            <p className="eyebrow">¡RESERVA CONFIRMADA!</p>
            <h2>Tu puesto está guardado</h2>
            <div className="success-route">{booking.trip.origen}<span>→</span>{booking.trip.destino}</div>
            <div className="success-summary">
              <span><Clock3 size={18} /> {formatDateTime(booking.trip.fecha_salida)}</span>
              <span><Users size={18} /> Puesto {booking.seatNumber}</span>
              <span><MapPin size={18} /> {selectedBoardingPoint}</span>
            </div>
            <p className="success-help">El pago se realiza al abordar. ¡Te esperamos!</p>
            <button className="button button-secondary button-full" onClick={saveFavoriteJourney} type="button">
              {favoriteJourney?.origen === booking.trip.origen && favoriteJourney.destino === booking.trip.destino && favoriteJourney.hora === getBogotaTime(booking.trip.fecha_salida)
                ? "Actualizar mi viaje de siempre"
                : "Guardar como mi viaje de siempre"}
            </button>
            {message && <p className="form-message success" role="status">{message}</p>}
            <a className="button button-primary button-full" href={whatsappHref} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
            <Link className="button button-secondary button-full" href="/mis-viajes">Ver mis viajes</Link>
            <button className="text-button" onClick={() => { setBooking(null); setSelectedTrip(null); setSelectedSeat(null); setHoldExpiresAt(null); setStep(1); setTravelDate(getBogotaDate()); }}>Buscar otro viaje</button>
          </motion.section>
        ) : (
          <>
            <div className="stepper" aria-label={`Paso ${step} de 3`}>
              {[1, 2, 3].map((stepNumber) => (
                <div className={`stepper-item ${step >= stepNumber ? "active" : ""}`} key={stepNumber}>
                  <span>{stepNumber < step ? <Check size={16} /> : stepNumber}</span>
                  <small>{stepNumber === 1 ? "Horario y puesto" : stepNumber === 2 ? "Tus datos" : "Confirmar"}</small>
                </div>
              ))}
            </div>
            {message && <p className="booking-message" role="status">{message}</p>}
            {loadError && <p className="form-message error" role="alert">{loadError}</p>}

            {step === 1 && (
              <section className="booking-step">
                <div className="section-title"><span>1 de 3</span><h2>¿A dónde vas?</h2></div>
                <div className="route-fields">
                  <label className="field"><span>Salgo desde</span>
                    <select value={selectedOrigin} onChange={(event) => {
                      const nextOrigin = event.target.value;
                      void changeSearch(() => {
                        setOrigin(nextOrigin);
                        setDestination(availableRoutes.find((route) => route.origen === nextOrigin)?.destino ?? "");
                        setBoardingPoint("");
                        setOtherBoardingPoint("");
                      });
                    }}>
                      {routeOrigins.map((place) => <option key={place} value={place}>{place}</option>)}
                    </select>
                  </label>
                  <button className="swap-button" aria-label="Intercambiar origen y destino" disabled={!canSwapRoute} onClick={swapRoute} type="button"><ArrowUpDown size={20} /></button>
                  <label className="field"><span>Voy hacia</span>
                    <select value={selectedDestination} onChange={(event) => void changeSearch(() => setDestination(event.target.value))}>
                      {routeDestinations.map((place) => <option key={place} value={place}>{place}</option>)}
                    </select>
                  </label>
                  <label className="field date-field"><span>Fecha del viaje</span>
                    <input type="date" min={getBogotaDate()} value={travelDate} onChange={(event) => void changeSearch(() => {
                      setTravelDate(event.target.value);
                      setBoardingPoint("");
                      setOtherBoardingPoint("");
                    })} />
                  </label>
                </div>
                <section className="weekend-tour-card" aria-labelledby="weekend-tour-title">
                  <div className="weekend-tour-icon"><CalendarDays size={21} /></div>
                  <div className="weekend-tour-copy">
                    <strong id="weekend-tour-title">Paseos de fin de semana</strong>
                    <span>Santa Marta · Cartagena · Santa Verónica</span>
                    <small>Sábado 1:00 p. m. · Domingo 6:00 a. m.</small>
                  </div>
                  <div className="weekend-tour-actions">
                    <button className="button button-secondary" onClick={() => chooseWeekendTour(6)} type="button">Ver sábado</button>
                    <button className="button button-primary" onClick={() => chooseWeekendTour(7)} type="button">Ver domingo</button>
                  </div>
                </section>
                <label className="field boarding-point-search"><span>Punto de encuentro · {selectedOrigin}</span>
                  <select value={selectedBoardingPointOption} onChange={(event) => {
                    setBoardingPoint(event.target.value);
                    setOtherBoardingPoint("");
                    setFieldErrors((previous) => ({ ...previous, boardingPoint: "" }));
                  }}>
                    <option value="">Elige dónde te recogemos</option>
                    {boardingPointOptions.map((point) => <option key={point} value={point}>{point}</option>)}
                  </select>
                  {boardingPoint === "Otros" && (
                    <input placeholder="Escribe el punto de encuentro" value={otherBoardingPoint} onChange={(event) => setOtherBoardingPoint(event.target.value)} />
                  )}
                  {fieldErrors.boardingPoint && <small className="field-error">{fieldErrors.boardingPoint}</small>}
                </label>
                <div className="schedule-heading">
                  <div><h3>Horarios disponibles</h3><span>{formatLongDate(travelDate)}</span></div>
                  <button className="icon-text-button" onClick={() => void loadTrips()} type="button" aria-label="Actualizar horarios"><RefreshCw size={17} /> Actualizar</button>
                </div>
                {favoriteJourney && (
                  <button className="favorite-journey-button" disabled={quickReserving} onClick={() => void quickReserveFavorite()} type="button">
                    {quickReserving ? <LoaderCircle className="spin" size={19} /> : <Check size={19} />}
                    {quickReserving ? "Reservando..." : `Reservar mi viaje de siempre · ${favoriteJourney.hora}`}
                  </button>
                )}
                {loading ? (
                  <div className="loading-card"><LoaderCircle className="spin" size={22} /> Buscando viajes...</div>
                ) : trips.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon"><MapPin size={24} /></div>
                    <h3>No hay viajes para este día</h3>
                    <p>{weekendTourDestinations.includes(selectedDestination)
                      ? "El paseo todavía no está cargado en los horarios del servicio. Actualiza la base de datos con la migración 202611250008_weekend_advance_booking.sql y vuelve a actualizar."
                      : "Prueba con otra fecha o cambia el sentido del viaje."}</p>
                  </div>
                ) : (
                  <div className="trip-list">
                    {trips.map((trip) => {
                      const available = freeSeats(trip.id);
                      const isSelected = selectedTrip?.id === trip.id;
                      const openingTime = Date.parse(trip.reservas_abren_at);
                      return (
                        <button className={`trip-option ${isSelected ? "selected" : ""}`} key={trip.id} onClick={() => void chooseTrip(trip)} type="button">
                          <span className="trip-time">{formatTime(trip.fecha_salida)}</span>
                          <span className="trip-route"><b>{trip.origen}</b><span>→</span><b>{trip.destino}</b></span>
                          <span className="trip-availability">
                            {available > 0 ? `${available} ${available === 1 ? "puesto libre" : "puestos libres"}` : "Lleno"}
                            {openingTime > now && <small>Reservas desde {formatTime(trip.reservas_abren_at)}</small>}
                          </span>
                          {trip.precio !== null && <span className="trip-price">{formatMoney(Number(trip.precio))}</span>}
                          <ArrowRight className="trip-arrow" size={18} />
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedTrip && (
                  <section className="seat-picker">
                    <div className="schedule-heading">
                      <div><h3>Elige tu puesto</h3><span>{selectedTrip.origen} a {selectedTrip.destino} · {formatTime(selectedTrip.fecha_salida)}</span></div>
                    </div>
                    {!reservationsOpen && (
                      <p className="booking-notice">
                        <Clock3 size={17} /> Los puestos se habilitan en {formatCountdown(Math.max(0, Math.ceil((Date.parse(selectedTrip.reservas_abren_at) - now) / 1000)))}.
                        <span>({formatDateTime(selectedTrip.reservas_abren_at)})</span>
                      </p>
                    )}
                    <SeatMap
                      seats={seatsForSelectedTrip}
                      capacity={capacity}
                      selectedSeat={selectedSeat}
                      now={now}
                      disabled={!reservationsOpen || saving}
                      onChoose={(seat) => void chooseSeat(seat)}
                    />
                    {reservationsOpen && freeSeats(selectedTrip.id) === 0 && waitlistEntry?.estado !== "notificada" && waitlistEntry?.estado !== "reservada" && (
                      <div className="waitlist-action">
                        {waitlistEntry?.estado === "esperando" ? (
                          <p className="waitlist-joined" role="status">Ya estás en la lista de espera. Te avisaremos si se libera un puesto.</p>
                        ) : (
                          <Button className="button-full" disabled={saving} onClick={() => void joinWaitlist()}>
                            {saving ? <LoaderCircle className="spin" size={18} /> : <Users size={18} />}
                            {saving ? "Uniéndote..." : "Avisarme si se libera un puesto"}
                          </Button>
                        )}
                      </div>
                    )}
                    {waitlistEntry?.estado === "notificada" && waitlistEntry.claim_expires_at && (
                      <p className="waitlist-joined" role="status">
                        Te guardamos un puesto hasta {formatTime(waitlistEntry.claim_expires_at)}. Selecciona tu puesto para confirmar antes de que venza.
                      </p>
                    )}
                    <div className="seat-legend" aria-label="Estado de los puestos">
                      <span><i className="seat-dot free" /> Libre</span>
                      <span><i className="seat-dot occupied" /> Ocupado</span>
                      <span><i className="seat-dot chosen" /> Tu elección</span>
                    </div>
                    {selectedSeat !== null && holdExpiresAt && (
                      <p className={`hold-countdown ${holdSecondsLeft < 60 ? "urgent" : ""}`} role="timer">
                        <Clock3 size={18} /> Tienes <strong>{formatCountdown(holdSecondsLeft)}</strong> minutos para completar tu reserva.
                      </p>
                    )}
                    <Button className="button-full booking-primary-action" disabled={selectedSeat === null || holdSecondsLeft <= 0 || saving} onClick={() => setStep(2)}>
                      Continuar con el puesto {selectedSeat ?? ""}
                    </Button>
                  </section>
                )}
              </section>
            )}

            {step === 2 && (
              <section className="booking-step">
                <div className="section-title"><span>2 de 3</span><h2>Tus datos</h2></div>
                <button className="back-step" onClick={() => setStep(1)} type="button"><ArrowLeft size={17} /> Atrás</button>
                <div className="selected-summary"><span>{selectedTrip?.origen} → {selectedTrip?.destino}</span><b>{formatTime(selectedTrip?.fecha_salida ?? "")} · Puesto {selectedSeat}</b></div>
                <div className="details-fields">
                  <label className="field"><span>Nombre de quien viaja</span>
                    <input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
                    {fieldErrors.fullName && <small className="field-error">{fieldErrors.fullName}</small>}
                  </label>
                  <label className="field"><span>Teléfono de contacto</span>
                    <input autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
                    {fieldErrors.phone && <small className="field-error">{fieldErrors.phone}</small>}
                  </label>
                  <div className="selected-summary"><span>Punto de encuentro</span><b>{selectedBoardingPoint}</b></div>
                </div>
                <div className="booking-action-row">
                  <Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft size={17} /> Atrás</Button>
                  <Button onClick={continueToDetails}>Revisar reserva <ArrowRight size={17} /></Button>
                </div>
              </section>
            )}

            {step === 3 && selectedTrip && (
              <section className="booking-step">
                <div className="section-title"><span>3 de 3</span><h2>Confirma tu viaje</h2></div>
                <button className="back-step" onClick={() => setStep(2)} type="button"><ArrowLeft size={17} /> Atrás</button>
                <div className="confirmation-card">
                  <p className="eyebrow">RESUMEN DE TU VIAJE</p>
                  <h3>{selectedTrip.origen}<span>→</span>{selectedTrip.destino}</h3>
                  <div><Clock3 size={18} /><span>{formatDateTime(selectedTrip.fecha_salida)}</span></div>
                  <div><Users size={18} /><span>Puesto {selectedSeat} para {fullName}</span></div>
                  <div><MapPin size={18} /><span>Te subes en: {selectedBoardingPoint}</span></div>
                  {selectedTrip.precio !== null && <div><span className="confirm-price-label">Valor del viaje</span><strong>{formatMoney(Number(selectedTrip.precio))}</strong></div>}
                </div>
                <p className="payment-note"><ShieldCheck size={19} /> Pagas al abordar, directamente al conductor.</p>
                <p className="hold-countdown"><Clock3 size={18} /> Tiempo para confirmar: <strong>{formatCountdown(holdSecondsLeft)}</strong></p>
                <div className="booking-action-row">
                  <Button variant="secondary" onClick={() => setStep(2)}><ArrowLeft size={17} /> Atrás</Button>
                  <Button disabled={saving || holdSecondsLeft <= 0} onClick={() => void confirmBooking()}>
                    {saving ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}
                    {saving ? "Guardando..." : "Confirmar mi viaje"}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
        <footer className="booking-footer"><ShieldCheck size={16} /> Tus datos están protegidos. Viaja con confianza.</footer>
      </section>
      <PassengerNavigation />
    </main>
  );
}

function SeatMap({
  seats,
  capacity,
  selectedSeat,
  now,
  disabled,
  onChoose,
}: {
  seats: Seat[];
  capacity: number;
  selectedSeat: number | null;
  now: number;
  disabled: boolean;
  onChoose: (seat: Seat) => void;
}) {
  const byNumber = new Map(seats.map((seat) => [seat.seat_number, seat]));
  return (
    <div className="van-cabin" aria-label={`Mapa de los ${capacity} puestos de pasajeros`}>
      <div className="driver-zone"><span className="steering-wheel" aria-hidden="true">◉</span><span>Conductor</span></div>
      <div className="seat-rows">
        {Array.from({ length: capacity }, (_, index) => index + 1).map((number) => {
          const seat = byNumber.get(number);
          const status = seat && isExpiredHold(seat, now) ? "libre" : seat?.estado ?? "libre";
          const isChosen = number === selectedSeat;
          const isOwnHold = isChosen && status === "reservado_temporal";
          const occupied = status !== "libre" && !isOwnHold;
          const row = number === 1 ? 1 : number <= 4 ? 2 : Math.ceil((number - 1) / 3) + 1;
          const column = number === 1 ? 3 : number <= 4 ? number - 1 : ((number - 5) % 3) + 1;
          return (
            <button
              aria-label={`Puesto ${number}, ${isChosen ? "seleccionado" : occupied ? "ocupado" : "libre"}`}
              aria-pressed={isChosen}
              className={`seat ${isChosen ? "chosen" : occupied ? "unavailable" : "available"}`}
              disabled={!seat || disabled || (occupied && !isChosen)}
              key={number}
              onClick={() => seat && onChoose(seat)}
              style={{ gridRow: row, gridColumn: column }}
              type="button"
            >
              <span>{number}</span>
              {isOwnHold && <Check size={15} />}
            </button>
          );
        })}
      </div>
      <div className="cabin-front" aria-hidden="true">FRENTE DE LA VAN</div>
    </div>
  );
}

function getBogotaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function getNextWeekdayDate(targetDay: 6 | 7) {
  const today = new Date(`${getBogotaDate()}T12:00:00Z`);
  const currentDay = today.getUTCDay() || 7;
  const daysUntil = (targetDay - currentDay + 7) % 7 || 7;
  today.setUTCDate(today.getUTCDate() + daysUntil);
  return today.toISOString().slice(0, 10);
}

function getBogotaTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

function formatTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00-05:00`));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function normalizeColombianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("57") ? digits : `57${digits}`;
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function isExpiredHold(seat: Seat, timestamp: number) {
  return seat.estado === "reservado_temporal"
    && seat.hold_expires_at !== null
    && Date.parse(seat.hold_expires_at) <= timestamp;
}

function friendlyBookingError(error: string) {
  if (/ya fue tomado|no está disponible/i.test(error)) return "Ese puesto ya fue tomado. Actualizamos los lugares; elige otro disponible.";
  if (/venció|tiempo/i.test(error)) return "Se venció el tiempo para guardar el puesto. Elige uno disponible nuevamente.";
  if (/todavía no están disponibles/i.test(error)) return "Todavía no se pueden elegir puestos para este viaje.";
  if (/inicia sesión/i.test(error)) return "Tu sesión terminó. Inicia sesión nuevamente para seguir.";
  if (/network|fetch/i.test(error)) return "No logramos conectarnos. Revisa tu internet e inténtalo otra vez.";
  return "No pudimos guardar la reserva. Revisa los datos e inténtalo de nuevo.";
}

function friendlyWaitlistError(error: string) {
  if (/todavía hay puestos disponibles/i.test(error)) return "Todavía hay puestos disponibles. Elige uno para reservar.";
  if (/ya no acepta lista de espera/i.test(error)) return "Este viaje ya no acepta lista de espera.";
  if (/todavía no está disponible/i.test(error)) return "La lista de espera se habilitará cuando abran las reservas.";
  return "No pudimos agregarte a la lista de espera. Inténtalo otra vez.";
}
