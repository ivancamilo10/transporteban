import type { Metadata, Viewport } from "next";
import { NetworkStatus } from "@/components/network-status";
import { PwaRegistrar } from "@/components/pwa-registrar";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "TransporteBan | Viaja con confianza",
  description: "Tu mejor opción de transporte entre Isabel López y Sabanalarga.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1558D6",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CO">
      <body>
        {children}
        <NetworkStatus />
        <PwaRegistrar />
      </body>
    </html>
  );
}
