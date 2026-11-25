import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const driverSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre completo.").max(100),
  phone: z.string().trim().min(7, "Escribe un teléfono válido.").max(20),
  email: z.string().trim().email("Escribe un correo válido.").max(254),
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
    return NextResponse.json({ error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor para administrar invitaciones." }, { status: 503 });
  }

  const adminClient = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    parsed.data.email,
    { data: { full_name: parsed.data.fullName, phone: parsed.data.phone } },
  );
  if (inviteError) {
    return NextResponse.json({ error: "No pudimos enviar la invitación. Verifica si el correo ya tiene una cuenta." }, { status: 400 });
  }
  if (!invited.user) {
    return NextResponse.json({ error: "Supabase no devolvió la cuenta creada. Revisa los usuarios antes de intentarlo otra vez." }, { status: 502 });
  }

  const { error: roleError } = await adminClient
    .from("profiles")
    .update({ role: "driver" })
    .eq("id", invited.user.id);
  if (roleError) {
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invited.user.id);
    return NextResponse.json({
      error: cleanupError
        ? "La invitación se creó, pero no se pudo asignar el rol. Revisa la cuenta en Supabase antes de volver a invitar."
        : "No pudimos asignar el rol de conductor; se retiró la invitación. Inténtalo otra vez.",
    }, { status: 500 });
  }

  return NextResponse.json({ message: "Invitación enviada. El conductor podrá crear su contraseña desde el correo." }, { status: 201 });
}
