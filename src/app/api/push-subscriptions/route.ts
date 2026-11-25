import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const subscriptionSchema = z.object({
  endpoint: z.string().url().refine((value) => value.startsWith("https://"), "El enlace de notificaciones no es válido."),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Inicia sesión para activar los avisos." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Los datos del dispositivo no son válidos." }, { status: 400 });
  }
  const parsed = subscriptionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos del dispositivo." }, { status: 400 });

  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: user.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: "No pudimos guardar este dispositivo. Inténtalo otra vez." }, { status: 500 });
  return NextResponse.json({ message: "Avisos activados en este dispositivo." });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Los datos del dispositivo no son válidos." }, { status: 400 });
  }
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "No reconocemos este dispositivo." }, { status: 400 });

  const { error } = await supabase.from("push_subscriptions").delete()
    .eq("user_id", user.id)
    .eq("endpoint", parsed.data.endpoint);
  if (error) return NextResponse.json({ error: "No pudimos desactivar los avisos de este dispositivo." }, { status: 500 });
  return NextResponse.json({ message: "Avisos desactivados en este dispositivo." });
}
