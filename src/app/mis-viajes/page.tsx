import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MyTrips } from "@/components/my-trips";

export default async function MyTripsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/iniciar-sesion");
  const { data: profile } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();
  if (profile?.role === "driver") redirect("/conductor");
  return <MyTrips passenger={{ id: user.id, fullName: profile?.full_name ?? "" }} currentTime={new Date().toISOString()} />;
}
