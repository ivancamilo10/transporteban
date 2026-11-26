import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const loginSchema = z.object({
  phone: z.string().trim().min(7).max(20),
  password: z.string().min(1).max(72),
});

const invalidCredentialsMessage = "El teléfono o la contraseña no coinciden. Verifícalos e inténtalo de nuevo.";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Los datos del formulario no son válidos." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: invalidCredentialsMessage }, { status: 400 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ error: "El inicio de sesión con teléfono no está configurado. Contacta al administrador." }, { status: 503 });
  }

  const adminClient = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: matchingUsers, error: lookupError } = await adminClient.rpc("lookup_auth_user_ids_by_phone", {
    p_phone: parsed.data.phone,
  });

  if (lookupError) {
    return NextResponse.json({ error: "No pudimos validar el teléfono. Inténtalo más tarde." }, { status: 503 });
  }
  if (matchingUsers?.length !== 1) {
    return NextResponse.json({ error: invalidCredentialsMessage }, { status: 401 });
  }

  const { data: authUser, error: authUserError } = await adminClient.auth.admin.getUserById(matchingUsers[0]);
  if (authUserError || !authUser.user?.email) {
    return NextResponse.json({ error: invalidCredentialsMessage }, { status: 401 });
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: authUser.user.email,
    password: parsed.data.password,
  });
  if (signInError) {
    return NextResponse.json({ error: invalidCredentialsMessage }, { status: 401 });
  }

  return NextResponse.json({ message: "Sesión iniciada." });
}
