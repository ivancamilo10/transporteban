import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get(name: string) { return request.cookies.get(name)?.value; },
      set(name: string, value: string, options: Parameters<typeof response.cookies.set>[2]) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: Parameters<typeof response.cookies.set>[2]) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const passengerArea = pathname.startsWith("/inicio")
    || pathname.startsWith("/mis-viajes")
    || pathname.startsWith("/avisos")
    || pathname.startsWith("/perfil");
  const driverArea = pathname.startsWith("/conductor");
  const adminArea = pathname.startsWith("/admin");
  if ((passengerArea || driverArea || adminArea) && !user) {
    return NextResponse.redirect(new URL("/iniciar-sesion", request.url));
  }
  if ((passengerArea || driverArea || adminArea) && user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (driverArea && profile?.role !== "driver") {
      return NextResponse.redirect(new URL(profile?.role === "admin" ? "/admin" : "/inicio", request.url));
    }
    if (passengerArea && profile?.role === "driver") {
      return NextResponse.redirect(new URL("/conductor", request.url));
    }
    if (passengerArea && profile?.role === "admin") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    if (adminArea && profile?.role !== "admin") {
      return NextResponse.redirect(new URL(profile?.role === "driver" ? "/conductor" : "/inicio", request.url));
    }
  }
  return response;
}

export const config = {
  matcher: ["/inicio/:path*", "/mis-viajes/:path*", "/avisos/:path*", "/perfil/:path*", "/conductor/:path*", "/admin/:path*"],
};
