"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!promptEvent) return null;

  async function install() {
    const installPrompt = promptEvent;
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setPromptEvent(null);
  }

  return <button className="button button-primary button-full" onClick={() => void install()} type="button"><Download size={18} /> Instalar Transporte Isabel López</button>;
}
