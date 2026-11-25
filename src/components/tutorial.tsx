"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BusFront, MapPin, TicketCheck, X } from "lucide-react";

const slides = [
  { title: "Busca tu horario", description: "Elige de dónde sales, hacia dónde vas y qué día quieres viajar.", Icon: MapPin },
  { title: "Elige tu puesto", description: "Mira los puestos disponibles y guarda el que más te convenga.", Icon: BusFront },
  { title: "¡Listo, viaja!", description: "Confirma tus datos y consulta tu reserva cuando la necesites.", Icon: TicketCheck },
];

export function Tutorial({ autoStart = false }: { autoStart?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (autoStart && window.localStorage.getItem("transporteban-tutorial-complete") !== "true") {
      // The welcome tour is shown once after the first client render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [autoStart]);

  function close() {
    window.localStorage.setItem("transporteban-tutorial-complete", "true");
    setOpen(false);
    setStep(0);
  }

  const current = slides[step];
  const Icon = current.Icon;

  return (
    <>
      {!autoStart && <button className="button button-secondary" onClick={() => setOpen(true)} type="button">Ver cómo reservar</button>}
      <AnimatePresence>
        {open && (
          <motion.div className="tutorial-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.section aria-labelledby="tutorial-title" aria-modal="true" className="tutorial-card" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} role="dialog">
              <button aria-label="Cerrar tutorial" className="tutorial-close" onClick={close} type="button"><X size={20} /></button>
              <div className="tutorial-illustration"><Icon size={46} strokeWidth={1.7} /></div>
              <p className="eyebrow">PASO {step + 1} DE 3</p>
              <h2 id="tutorial-title">{current.title}</h2>
              <p>{current.description}</p>
              <div className="tutorial-dots" aria-label={`Pantalla ${step + 1} de 3`}>
                {slides.map((slide, index) => <span className={index === step ? "active" : ""} key={slide.title} />)}
              </div>
              <div className="tutorial-actions">
                <button className="text-button" onClick={close} type="button">Saltar</button>
                {step > 0 && <button aria-label="Pantalla anterior" className="button button-secondary" onClick={() => setStep(step - 1)} type="button"><ArrowLeft size={18} /> Atrás</button>}
                <button className="button button-primary" onClick={() => step === slides.length - 1 ? close() : setStep(step + 1)} type="button">
                  {step === slides.length - 1 ? "¡Entendido!" : <>Siguiente <ArrowRight size={18} /></>}
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
