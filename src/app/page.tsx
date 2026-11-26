import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BusFront, Clock3, MapPin, ShieldCheck, Signpost, Sparkles } from "lucide-react";

export default function HomePage() {
  return (
    <main className="landing">
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-mark"><BusFront size={24} strokeWidth={2.2} /></span><span>Transporte Isabel López</span></Link>
        <nav className="top-links" aria-label="Acceso a tu cuenta">
          <Link className="button button-quiet" href="/iniciar-sesion">Iniciar sesión</Link>
          <Link className="button button-primary" href="/registro">Crear cuenta</Link>
        </nav>
      </header>
      <section className="hero md:grid-cols-2">
        <div>
          <p className="eyebrow">ISABEL LÓPEZ ⇄ SABANALARGA</p>
          <h1>Tu camino, <span>más sencillo.</span></h1>
          <p className="hero-copy">Viaja con confianza. Consulta horarios, elige tu puesto y reserva tu próximo viaje.</p>
          <div className="hero-actions">
            <Link href="/registro" className="button button-primary">Empezar ahora <ArrowRight size={18} /></Link>
            <Link href="/iniciar-sesion" className="button button-secondary">Ya tengo una cuenta</Link>
          </div>
          <div className="route-pill"><MapPin size={17} /> ¡Tu mejor opción de transporte!</div>
        </div>
        <div className="visual-card" aria-label="Van Chevrolet N400 de Transporte Isabel López">
          <span className="sun" /><span className="road" />
          <Image className="van-photo" src="/chevrolet-n400.png" alt="Van Chevrolet N400 blanca" width={923} height={1024} priority sizes="(max-width: 760px) 90vw, 42vw" />
        </div>
      </section>
      <section className="pillars" aria-label="Nuestros compromisos">
        <div className="pillar"><span className="pillar-icon"><ShieldCheck size={24} /></span><div><strong>Viajes seguros</strong><span>Tu tranquilidad va primero.</span></div></div>
        <div className="pillar"><span className="pillar-icon"><Clock3 size={24} /></span><div><strong>Puntualidad</strong><span>Salimos a la hora indicada.</span></div></div>
        <div className="pillar"><span className="pillar-icon"><Signpost size={24} /></span><div><strong>Mayor conectividad</strong><span>Más cerca de tu destino.</span></div></div>
      </section>
      <footer className="footer"><Sparkles size={14} /> Viaja con confianza · Ruta local de lunes a sábado · Paseos los fines de semana</footer>
    </main>
  );
}
