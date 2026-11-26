import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const pathname = request.nextUrl.pathname;
  const passengerArea = pathname.startsWith("/inicio")
    || pathname.startsWith("/mis-viajes")
    || pathname.startsWith("/avisos")
    || pathname.startsWith("/perfil");
  const driverArea = pathname.startsWith("/conductor");
  const adminArea = pathname.startsWith("/admin");
  const accountEntry = pathname === "/" || pathname === "/iniciar-sesion";
  const protectedArea = passengerArea || driverArea || adminArea;

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
  if (protectedArea && !user) {
    return redirectWithCookies(request, response, "/iniciar-sesion");
  }
  if ((protectedArea || accountEntry) && user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (accountEntry) {
      const destination = profile?.role === "admin"
        ? "/admin"
        : profile?.role === "driver"
          ? "/conductor"
          : "/inicio";
      return redirectWithCookies(request, response, destination);
    }
    if (driverArea && profile?.role !== "driver") {
      return redirectWithCookies(request, response, profile?.role === "admin" ? "/admin" : "/inicio");
    }
    if (passengerArea && profile?.role === "driver") {
      return redirectWithCookies(request, response, "/conductor");
    }
    if (passengerArea && profile?.role === "admin") {
      return redirectWithCookies(request, response, "/admin");
    }
    if (adminArea && profile?.role !== "admin") {
      return redirectWithCookies(request, response, profile?.role === "driver" ? "/conductor" : "/inicio");
    }
  }
  return response;
}

function redirectWithCookies(request: NextRequest, response: NextResponse, pathname: string) {
  const redirectResponse = NextResponse.redirect(new URL(pathname, request.url));
  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

export const config = {
  matcher: ["/", "/iniciar-sesion", "/inicio/:path*", "/mis-viajes/:path*", "/avisos/:path*", "/perfil/:path*", "/conductor/:path*", "/admin/:path*"],
};
