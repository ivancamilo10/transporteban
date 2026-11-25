"use client";

import { useEffect, useState } from "react";

export function PwaRegistrar() {
  const [registrationError, setRegistrationError] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      if (active) setRegistrationError(true);
    });
    return () => { active = false; };
  }, []);

  if (!registrationError) return null;
  return <p className="pwa-error" role="status">No pudimos activar el modo sin conexión en este navegador.</p>;
}
