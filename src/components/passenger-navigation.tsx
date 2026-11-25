"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, House, TicketCheck, UserRound } from "lucide-react";

const links = [
  { href: "/inicio", label: "Inicio", Icon: House },
  { href: "/mis-viajes", label: "Mis viajes", Icon: TicketCheck },
  { href: "/avisos", label: "Avisos", Icon: Bell },
  { href: "/perfil", label: "Perfil", Icon: UserRound },
];

export function PassengerNavigation() {
  const pathname = usePathname();
  return (
    <nav className="passenger-nav" aria-label="Navegación principal">
      {links.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={href} key={href}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
