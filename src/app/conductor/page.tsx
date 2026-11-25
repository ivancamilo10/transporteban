import { redirect } from "next/navigation";
import { DriverDashboard } from "@/components/driver-dashboard";
import { createClient } from "@/lib/supabase/server";

export default async function DriverHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/iniciar-sesion");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role !== "driver") redirect("/inicio");

  return <DriverDashboard driverName={profile.full_name} />;
}
