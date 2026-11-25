"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, CheckCheck, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/configured";
import { PassengerNavigation } from "@/components/passenger-navigation";

type AppNotification = {
  id: number;
  titulo: string;
  mensaje: string;
  leida: boolean;
  created_at: string;
  related_trip_id: string | null;
  kind: string;
};

export function Notifications({ userId }: { userId: string }) {
  const supabase = useMemo(() => isSupabaseConfigured() ? createClient() : null, []);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [errorMessage, setErrorMessage] = useState(supabase ? "" : "No hay conexión con Supabase.");

  const loadNotifications = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("id,titulo,mensaje,leida,created_at,related_trip_id,kind")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      setErrorMessage("No pudimos cargar tus avisos. Intenta actualizar la página.");
    } else {
      setNotifications((data ?? []) as AppNotification[]);
      setErrorMessage("");
    }
    setLoading(false);
  }, [supabase, userId]);

  // Supabase's response updates the list after the request completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => { void loadNotifications(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadNotifications, supabase, userId]);

  async function markAsRead(notification: AppNotification) {
    if (!supabase || notification.leida) return;
    const { error } = await supabase.from("notifications").update({ leida: true }).eq("id", notification.id);
    if (error) {
      setErrorMessage("No pudimos marcar el aviso como leído. Inténtalo otra vez.");
    } else {
      setNotifications((previous) => previous.map((item) => item.id === notification.id ? { ...item, leida: true } : item));
    }
  }

  return (
    <main className="app-shell">
      <section className="my-trips-card">
        <div className="booking-welcome">
          <p className="eyebrow">AVISOS</p>
          <h1>Tus avisos importantes</h1>
          <p>Te contamos si algo cambia en tus viajes o hay un puesto disponible.</p>
        </div>
        {errorMessage && <p className="form-message error" role="alert">{errorMessage}</p>}
        {loading ? (
          <div className="loading-card"><LoaderCircle className="spin" size={22} /> Cargando avisos...</div>
        ) : notifications.length ? (
          <div className="notification-list">
            {notifications.map((notification) => (
              <article className={`notification-card ${notification.leida ? "read" : "unread"}`} key={notification.id}>
                <div className="notification-icon"><Bell size={20} /></div>
                <div className="notification-copy">
                  <strong>{notification.titulo}</strong>
                  <p>{notification.mensaje}</p>
                  <small><CalendarDays size={14} /> {formatDate(notification.created_at)}</small>
                  {notification.related_trip_id && <Link href="/inicio" onClick={() => void markAsRead(notification)}>Ver viaje</Link>}
                </div>
                {!notification.leida && <button className="notification-read" onClick={() => void markAsRead(notification)} type="button"><CheckCheck size={18} /> Leído</button>}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state"><div className="empty-icon"><Bell size={25} /></div><h2>Todo al día</h2><p>Cuando haya una novedad, la encontrarás aquí.</p></div>
        )}
      </section>
      <PassengerNavigation />
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
