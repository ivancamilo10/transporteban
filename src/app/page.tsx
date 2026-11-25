import Link from "next/link";
import { ArrowRight, BusFront, Clock3, MapPin, ShieldCheck, Signpost, Sparkles } from "lucide-react";

function VanIllustration() {
  return (
    <svg className="van-art" viewBox="0 0 480 260" role="img" aria-label="Ilustración de una van blanca viajando por carretera">
      <ellipse cx="240" cy="224" rx="194" ry="15" fill="#6c93c8" opacity=".22" />
      <path d="M66 158c0-11 9-20 20-20h186l39-52c7-9 17-14 28-14h44c12 0 22 7 27 18l29 62c7 3 12 11 12 19v27H66z" fill="#fff" stroke="#0b2e6f" strokeWidth="5" strokeLinejoin="round" />
      <path d="M280 138 316 91c5-7 12-10 21-10h41c7 0 13 4 16 11l22 46z" fill="#cfe5ff" stroke="#0b2e6f" strokeWidth="4" strokeLinejoin="round" />
      <path d="M91 150h171v48H91zM271 150h159v48H271z" fill="#f3f8ff" />
      <path d="M276 146h147" stroke="#d4e4f8" strokeWidth="4" />
      <path d="M83 171h22M126 171h22M169 171h22M212 171h22" stroke="#1558d6" strokeWidth="7" strokeLinecap="round" />
      <path d="M356 86v61" stroke="#0b2e6f" strokeWidth="4" />
      <rect x="428" y="156" width="17" height="13" rx="4" fill="#ffc21a" />
      <rect x="68" y="157" width="14" height="16" rx="4" fill="#ffb5a8" />
      <circle cx="150" cy="200" r="31" fill="#0b2e6f" />
      <circle cx="150" cy="200" r="17" fill="#d9e8fb" />
      <circle cx="150" cy="200" r="6" fill="#1558d6" />
      <circle cx="379" cy="200" r="31" fill="#0b2e6f" />
      <circle cx="379" cy="200" r="17" fill="#d9e8fb" />
      <circle cx="379" cy="200" r="6" fill="#1558d6" />
      <path d="M285 149h139" stroke="#ffc21a" strokeWidth="6" />
      <text x="192" y="126" fill="#1558d6" fontSize="18" fontWeight="800" textAnchor="middle">TRANSPORTEBAN</text>
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="landing">
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-mark"><BusFront size={24} strokeWidth={2.2} /></span><span>TransporteBan</span></Link>
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
        <div className="visual-card" aria-label="Van de TransporteBan en una carretera de paisaje azul">
          <span className="sun" /><span className="road" /><VanIllustration />
        </div>
      </section>
      <section className="pillars" aria-label="Nuestros compromisos">
        <div className="pillar"><span className="pillar-icon"><ShieldCheck size={24} /></span><div><strong>Viajes seguros</strong><span>Tu tranquilidad va primero.</span></div></div>
        <div className="pillar"><span className="pillar-icon"><Clock3 size={24} /></span><div><strong>Puntualidad</strong><span>Salimos a la hora indicada.</span></div></div>
        <div className="pillar"><span className="pillar-icon"><Signpost size={24} /></span><div><strong>Mayor conectividad</strong><span>Más cerca de tu destino.</span></div></div>
      </section>
      <footer className="footer"><Sparkles size={14} /> Viaja con confianza · Servicio de lunes a sábado</footer>
    </main>
  );
}
