import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/signup", "/reset-password", "/auth"];

/**
 * Refreshes the Supabase session cookie on every page request and sends
 * signed-out visitors to /login. This is a convenience only: every Server
 * Action and data read checks the session again, and RLS guards the data.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [h, v] of Object.entries(headers ?? {})) response.headers.set(h, v);
      },
    },
  });

  // Validates the token with Supabase Auth (not just decoding the cookie).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    const login = request.nextUrl.clone();
    // Someone opening an invite usually has no account yet: start them on "create your account".
    login.pathname = path.startsWith("/invite/") ? "/signup" : "/login";
    login.search = "";
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
