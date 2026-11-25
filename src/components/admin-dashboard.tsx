"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowLeft, BusFront, LoaderCircle, MessageCircle, ShieldCheck, UserRoundPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/configured";

type RegisteredProfile = {
  id: string;
  full_name: string;
  phone: string;
  role: "passenger" | "driver" | "admin";
  created_at: string;
};

const driverSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre completo.").max(100),
  phone: z.string().trim().min(7, "Escribe un teléfono válido.").max(20),
  username: z.string().trim().min(3, "Usa al menos 3 caracteres.").max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "Usa solo letras, números, punto, guion o guion bajo.")
    .refine((value) => value.toLowerCase() !== "admin", "Ese usuario está reservado."),
  password: z.string().min(8, "Usa al menos 8 caracteres.").max(72, "La contraseña es demasiado larga."),
});
type DriverValues = z.infer<typeof driverSchema>;

export function AdminDashboard({ adminName }: { adminName: string }) {
  const supabase = useMemo(() => isSupabaseConfigured() ? createClient() : null, []);
  const [profiles, setProfiles] = useState<RegisteredProfile[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const { register, handleSubmit, reset, formState: { errors } } = useForm<DriverValues>({
    resolver: zodResolver(driverSchema),
    defaultValues: { fullName: "", phone: "", username: "", password: "" },
  });

  const loadProfiles = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("id,full_name,phone,role,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      setErrorMessage("No pudimos cargar las cuentas registradas. Intenta actualizar la página.");
    } else {
      setProfiles((data ?? []) as RegisteredProfile[]);
      setErrorMessage("");
    }
    setLoading(false);
  }, [supabase]);

  // Supabase's asynchronous response updates the profiles after the request completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("admin-registered-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => { void loadProfiles(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadProfiles, supabase]);

  async function createDriver(values: DriverValues) {
    setCreating(true);
    setErrorMessage("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) {
        setErrorMessage(result.error ?? "No pudimos crear la cuenta. Inténtalo de nuevo.");
      } else {
        setNotice(result.message ?? "La cuenta del conductor quedó creada.");
        reset();
        await loadProfiles();
      }
    } catch {
      setErrorMessage("No pudimos conectar con el servidor. Revisa tu conexión e inténtalo otra vez.");
    } finally {
      setCreating(false);
    }
  }

  const drivers = profiles.filter((profile) => profile.role === "driver");
  const passengers = profiles.filter((profile) => profile.role === "passenger");

  return (
    <main className="app-shell">
      <section className="my-trips-card">
        <header className="booking-header">
          <Link className="brand" href="/"><span className="brand-mark"><BusFront size={24} strokeWidth={2.2} /></span><span>TransporteBan</span></Link>
          <Link className="booking-profile" href="/"><ArrowLeft size={17} /> Inicio</Link>
        </header>
        <div className="booking-welcome">
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h1>Hola, {adminName.split(" ")[0] || "administrador"}</h1>
          <p>Revisa las cuentas registradas y administra quién puede conducir.</p>
        </div>
        {notice && <p className="form-message success" role="status">{notice}</p>}
        {errorMessage && <p className="form-message error" role="alert">{errorMessage}</p>}

        <section className="admin-driver-card" aria-labelledby="driver-heading">
          <h2 id="driver-heading"><ShieldCheck size={21} /> Crear cuenta de conductor</h2>
          <p>Elige el usuario y la contraseña para entregárselos al conductor. No enviaremos invitaciones por correo.</p>
          <form className="admin-driver-form" onSubmit={handleSubmit(createDriver)} noValidate>
            <label>Nombre completo<input autoComplete="name" placeholder="Ej. María Pérez" {...register("fullName")} />{errors.fullName && <small className="field-error">{errors.fullName.message}</small>}</label>
            <label>Teléfono<input autoComplete="tel" inputMode="tel" placeholder="Ej. 300 123 4567" {...register("phone")} />{errors.phone && <small className="field-error">{errors.phone.message}</small>}</label>
            <label>Usuario<input autoComplete="off" placeholder="Ej. conductor1" {...register("username")} />{errors.username && <small className="field-error">{errors.username.message}</small>}</label>
            <label>Contraseña inicial<input autoComplete="new-password" placeholder="Mínimo 8 caracteres" type="password" {...register("password")} />{errors.password && <small className="field-error">{errors.password.message}</small>}</label>
            <button className="button button-primary" disabled={creating} type="submit">{creating ? <><LoaderCircle className="spin" size={18} /> Creando cuenta...</> : <><UserRoundPlus size={18} /> Crear cuenta</>}</button>
          </form>
        </section>

        <div className="admin-counts">
          <span><Users size={20} /> {drivers.length} conductores</span>
          <span><Users size={20} /> {passengers.length} pasajeros</span>
        </div>
        <section className="admin-users-section">
          <h2>Cuentas registradas</h2>
          {loading ? (
            <div className="loading-card"><LoaderCircle className="spin" size={22} /> Cargando cuentas...</div>
          ) : profiles.length === 0 ? (
            <div className="empty-state"><div className="empty-icon"><Users size={25} /></div><h3>Aún no hay cuentas</h3><p>Cuando las personas se registren, aparecerán aquí.</p></div>
          ) : (
            <div className="admin-user-list">
              {profiles.map((profile) => (
                <article className="admin-user-card" key={profile.id}>
                  <div className="admin-user-avatar">{profile.full_name.trim().charAt(0).toUpperCase() || "U"}</div>
                  <div className="admin-user-info">
                    <strong>{profile.full_name}</strong>
                    <span><MessageCircle size={15} /> {profile.phone || "Sin teléfono"}</span>
                    <small>Registrado el {formatDate(profile.created_at)}</small>
                  </div>
                  <span className={`admin-role role-${profile.role}`}>{roleLabel(profile.role)}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function roleLabel(role: RegisteredProfile["role"]) {
  if (role === "admin") return "Administrador";
  if (role === "driver") return "Conductor";
  return "Pasajero";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}
