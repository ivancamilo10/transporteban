import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPhoneLoginEmail } from "@/lib/phone-login";

export const runtime = "nodejs";

const driverSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre completo.").max(100),
  phone: z.string().trim().min(7, "Escribe un teléfono válido.").max(20),
  password: z.string().min(8, "Usa al menos 8 caracteres.").max(72, "La contraseña es demasiado larga."),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: "No pudimos verificar tu cuenta." }, { status: 500 });
  }
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo el administrador puede crear cuentas de conductor." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Los datos del formulario no son válidos." }, { status: 400 });
  }
  const parsed = driverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos del conductor." }, { status: 400 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ error: "Falta configurar la llave privada de Supabase para crear cuentas." }, { status: 503 });
  }

  const adminClient = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const phoneLoginEmail = getPhoneLoginEmail(parsed.data.phone);
  if (!phoneLoginEmail) {
    return NextResponse.json({ error: "Escribe un teléfono válido para usarlo como usuario de acceso." }, { status: 400 });
  }
  const phoneUsername = phoneLoginEmail.slice(0, -"@transporteban.test".length);
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: phoneLoginEmail,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      username: phoneUsername,
    },
  });
  if (createError) {
    if (/already registered|already been registered/i.test(createError.message)) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese número de teléfono." }, { status: 409 });
    }
    return NextResponse.json({ error: "No pudimos crear la cuenta. Revisa los datos e inténtalo otra vez." }, { status: 400 });
  }
  if (!created.user) {
    return NextResponse.json({ error: "Supabase no devolvió la cuenta creada. Revisa las cuentas antes de volver a intentarlo." }, { status: 502 });
  }

  const { error: roleError } = await adminClient
    .from("profiles")
    .update({ role: "driver" })
    .eq("id", created.user.id);
  if (roleError) {
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({
      error: cleanupError
        ? "La cuenta se creó, pero no se pudo asignar el rol. Revisa Supabase antes de volver a intentarlo."
        : "No pudimos asignar el rol de conductor; se retiró la cuenta. Inténtalo otra vez.",
    }, { status: 500 });
  }

  return NextResponse.json({
    message: `Cuenta creada. Usuario para iniciar sesión: ${parsed.data.phone}. Entrégale la contraseña inicial al conductor.`,
  }, { status: 201 });
}
