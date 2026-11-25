import { redirect } from "next/navigation";
import { ProfilePage } from "@/components/profile-page";
import { createClient } from "@/lib/supabase/server";

export default async function PassengerProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/iniciar-sesion");
  const { data: profile } = await supabase.from("profiles").select("full_name,phone,role").eq("id", user.id).maybeSingle();
  if (profile?.role === "driver") redirect("/conductor");
  if (profile?.role === "admin") redirect("/admin");
  return <ProfilePage profile={{ fullName: profile?.full_name ?? "", phone: profile?.phone ?? "", email: user.email ?? "" }} />;
}
