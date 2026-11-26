"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BusFront, HelpCircle, LogOut, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PassengerNavigation } from "@/components/passenger-navigation";
import { Tutorial } from "@/components/tutorial";
import { InstallAppButton } from "@/components/install-app-button";

export function ProfilePage({ profile }: { profile: { fullName: string; phone: string; email: string } }) {
  const supabase = createClient();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <main className="app-shell">
      <section className="my-trips-card">
        <header className="booking-header">
          <Link className="brand" href="/inicio"><span className="brand-mark"><BusFront size={24} strokeWidth={2.2} /></span><span>Transporte Isabel López</span></Link>
          <span className="booking-profile"><UserRound size={17} /> Mi perfil</span>
        </header>
        <div className="booking-welcome">
          <p className="eyebrow">TU CUENTA</p>
          <h1>Tu perfil</h1>
          <p>Revisa tus datos y encuentra ayuda cuando la necesites.</p>
        </div>
        <section className="profile-details">
          <div><span>Nombre</span><strong>{profile.fullName || "Sin nombre"}</strong></div>
          <div><span>Teléfono</span><strong>{profile.phone || "Sin teléfono"}</strong></div>
          <div><span>Correo electrónico</span><strong>{profile.email || "No disponible"}</strong></div>
        </section>
        <section className="profile-help">
          <h2><HelpCircle size={21} /> ¿Necesitas ayuda?</h2>
          <p>Aprende a buscar tu horario, elegir un puesto y revisar tu reserva.</p>
          <Tutorial />
        </section>
        <InstallAppButton />
        <button className="button button-secondary button-full signout-button" onClick={() => void signOut()} type="button"><LogOut size={18} /> Cerrar sesión</button>
        <Link className="back-step profile-back" href="/inicio"><ArrowLeft size={17} /> Volver al inicio</Link>
      </section>
      <PassengerNavigation />
    </main>
  );
}
