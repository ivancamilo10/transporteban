import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPhoneLoginEmail } from "@/lib/phone-login";

export const runtime = "nodejs";

const registerSchema = z.object({
  fullName: z.string().trim().min(3, "Escribe tu nombre completo.").max(100),
  phone: z.string().trim().min(7, "Escribe un teléfono válido.").max(20),
  email: z.string().trim().email("Escribe un correo válido.").max(254),
  password: z.string().min(8, "Usa al menos 8 caracteres.").max(72, "La contraseña es demasiado larga."),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Los datos del formulario no son válidos." }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos del registro." }, { status: 400 });
  }

  const phoneLoginEmail = getPhoneLoginEmail(parsed.data.phone);
  if (!phoneLoginEmail) {
    return NextResponse.json({ error: "Escribe un teléfono válido para iniciar sesión." }, { status: 400 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ error: "El registro no está configurado en el servidor. Contacta al administrador." }, { status: 503 });
  }

  const adminClient = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: matchingUsers, error: phoneLookupError } = await adminClient.rpc("lookup_auth_user_ids_by_phone", {
    p_phone: parsed.data.phone,
  });

  if (phoneLookupError) {
    return NextResponse.json({ error: "No pudimos validar el número de teléfono. Inténtalo más tarde." }, { status: 503 });
  }
  if (matchingUsers?.length) {
    return NextResponse.json({ error: "Ya existe una cuenta con ese número de teléfono. Inicia sesión." }, { status: 409 });
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
    },
  });

  if (error) {
    if (/already registered|already been registered/i.test(error.message)) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese correo. Inicia sesión." }, { status: 409 });
    }
    return NextResponse.json({ error: "No pudimos crear la cuenta. Revisa los datos e inténtalo otra vez." }, { status: 400 });
  }
  if (!data.user) {
    return NextResponse.json({ error: "No pudimos confirmar la creación de la cuenta. Inténtalo de nuevo más tarde." }, { status: 502 });
  }

  return NextResponse.json({ message: "Cuenta creada." }, { status: 201 });
}
