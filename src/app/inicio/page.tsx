import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TripBooking } from "@/components/trip-booking";

export default async function PassengerHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/iniciar-sesion");
  const { data: profile } = await supabase.from("profiles").select("full_name, phone, role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "driver") redirect("/conductor");

  return <TripBooking passenger={{ id: user.id, fullName: profile?.full_name ?? "", phone: profile?.phone ?? "" }} />;
}
