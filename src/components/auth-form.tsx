"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, BusFront, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/configured";
import { Button } from "@/components/ui/button";

const schemas = {
  login: z.object({
    email: z.string().email("Escribe un correo válido."),
    password: z.string().min(1, "Escribe tu contraseña."),
  }),
  register: z.object({
    fullName: z.string().min(3, "Escribe tu nombre completo."),
    phone: z.string().min(7, "Escribe un teléfono válido."),
    email: z.string().email("Escribe un correo válido."),
    password: z.string().min(8, "Usa al menos 8 caracteres."),
  }),
  reset: z.object({
    email: z.string().email("Escribe un correo válido."),
  }),
  update: z.object({
    password: z.string().min(8, "Usa al menos 8 caracteres."),
  }),
};

type AuthMode = keyof typeof schemas;
type FormValues = z.infer<(typeof schemas)[AuthMode]>;

const labels: Record<AuthMode, { title: string; subtitle: string; action: string }> = {
  login: {
    title: "Qué bueno verte",
    subtitle: "Inicia sesión para continuar con tus viajes.",
    action: "Iniciar sesión",
  },
  register: {
    title: "Crea tu cuenta",
    subtitle: "Regístrate como pasajero. El conductor asigna los accesos de administración.",
    action: "Crear mi cuenta",
  },
  reset: {
    title: "Recupera tu contraseña",
    subtitle: "Te enviaremos un enlace para crear una contraseña nueva.",
    action: "Enviar enlace",
  },
  update: {
    title: "Crea una contraseña nueva",
    subtitle: "Elige una contraseña segura para volver a entrar a tu cuenta.",
    action: "Guardar contraseña",
  },
};

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schemas[mode]),
  });

  async function submit(values: FormValues) {
    setBusy(true);
    setMessage(null);
    try {
      if (!isSupabaseConfigured()) {
        setMessage({ text: "La aplicación aún no está conectada a Supabase. Configura las variables de entorno para continuar.", error: true });
        return;
      }
      const supabase = createClient();
      if (mode === "register") {
        const input = schemas.register.parse(values);
        const result = await supabase.auth.signUp({
          email: input.email,
          password: input.password,
          options: {
            data: {
              full_name: input.fullName,
              phone: input.phone,
            },
          },
        });
        if (result.error) throw result.error;
        setMessage({
          text: result.data.session
            ? "Tu cuenta quedó lista. Ya puedes buscar tu próximo viaje."
            : "Supabase todavía exige confirmar el correo. Desactiva «Confirm email» en Authentication → Providers → Email; después inicia sesión con estos datos.",
          error: false,
        });
        if (result.data.session) router.push("/inicio");
      } else if (mode === "login") {
        const input = schemas.login.parse(values);
        const result = await supabase.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        });
        if (result.error) throw result.error;
        router.push("/inicio");
        router.refresh();
      } else if (mode === "reset") {
        const input = schemas.reset.parse(values);
        const result = await supabase.auth.resetPasswordForEmail(input.email, {
          redirectTo: `${window.location.origin}/actualizar-contrasena`,
        });
        if (result.error) throw result.error;
        setMessage({ text: "Si el correo está registrado, recibirás un enlace para cambiar la contraseña.", error: false });
      } else {
        const input = schemas.update.parse(values);
        const result = await supabase.auth.updateUser({ password: input.password });
        if (result.error) throw result.error;
        router.push("/inicio");
        router.refresh();
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : "No pudimos completar la solicitud.";
      setMessage({ text: friendlyError(description), error: true });
    } finally {
      setBusy(false);
    }
  }

  const copy = labels[mode];

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link href="/" className="back-link"><ArrowLeft size={18} /> Volver al inicio</Link>
        <div className="auth-brand-icon" aria-hidden="true"><BusFront size={27} strokeWidth={2.2} /></div>
        <p className="eyebrow">TRANSPORTEBAN</p>
        <h1 id="auth-title">{copy.title}</h1>
        <p className="auth-subtitle">{copy.subtitle}</p>
        <form className="auth-form" onSubmit={handleSubmit(submit)}>
          {mode === "register" && (
            <>
              <Field label="Nombre completo" error={"fullName" in errors ? errors.fullName?.message : undefined}>
                <input autoComplete="name" placeholder="Ej. María Pérez" {...register("fullName")} />
              </Field>
              <Field label="Teléfono" error={"phone" in errors ? errors.phone?.message : undefined}>
                <input type="tel" autoComplete="tel" placeholder="Ej. 300 123 4567" {...register("phone")} />
              </Field>
            </>
          )}
          <Field label="Correo electrónico" error={"email" in errors ? errors.email?.message : undefined}>
            <input type="email" autoComplete="email" placeholder="tunombre@correo.com" {...register("email")} />
          </Field>
          {mode !== "reset" && (
            <Field label="Contraseña" error={"password" in errors ? errors.password?.message : undefined}>
              <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Tu contraseña" : "Mínimo 8 caracteres"} {...register("password")} />
            </Field>
          )}
          {message && <p className={message.error ? "form-message error" : "form-message success"} role="status">{message.text}</p>}
          <Button className="button-full" disabled={busy} type="submit">
            {busy && <LoaderCircle className="spin" size={18} />}
            {busy ? "Un momento..." : copy.action}
          </Button>
        </form>
        {mode === "login" && <Link className="text-link" href="/recuperar-contrasena">Olvidé mi contraseña</Link>}
        {mode === "login" && <p className="auth-switch">¿Aún no tienes cuenta? <Link href="/registro">Regístrate aquí</Link></p>}
        {mode === "register" && <p className="auth-switch">¿Ya tienes cuenta? <Link href="/iniciar-sesion">Inicia sesión</Link></p>}
      </section>
    </main>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function friendlyError(error: string) {
  if (/invalid login credentials/i.test(error)) return "El correo o la contraseña no coinciden. Verifícalos e inténtalo de nuevo.";
  if (/user already registered/i.test(error)) return "Ya existe una cuenta con ese correo. Prueba iniciar sesión.";
  if (/email not confirmed/i.test(error)) return "Confirma tu correo desde el enlace que te enviamos antes de iniciar sesión.";
  if (/fetch|network/i.test(error)) return "No logramos conectarnos. Revisa tu internet e inténtalo de nuevo.";
  return "No pudimos completar la solicitud. Revisa los datos e inténtalo de nuevo.";
}
