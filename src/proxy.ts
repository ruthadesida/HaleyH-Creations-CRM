import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/signup", "/reset-password", "/auth"];
const PENDING_INVITE = "pending_invite";

/**
 * Refreshes the Supabase session cookie on every page request and sends
 * signed-out visitors to /login. This is a convenience only: every Server
 * Action and data read checks the session again, and RLS guards the data.
 */
export async function proxy(request: NextRequest) {
  // An email link whose return address isn't on Supabase's allowed list lands on the site root with ?code=.
  // Hand it to the confirmation handler instead of dropping it.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const confirm = request.nextUrl.clone();
    confirm.pathname = "/auth/confirm";
    return NextResponse.redirect(confirm);
  }
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

  const invite = path.match(/^\/invite\/([A-Za-z0-9_-]{16,200})$/)?.[1];

  if (!signedIn && !isPublic) {
    const login = request.nextUrl.clone();
    // Someone opening an invite usually has no account yet: start them on "create your account".
    login.pathname = invite ? "/signup" : "/login";
    login.search = "";
    login.searchParams.set("next", path + request.nextUrl.search);
    const redirect = NextResponse.redirect(login);
    // Remember the invite in this browser, so they come back to it even if a confirmation email loses the
    // return address. Only this browser has it, exactly like the link itself.
    if (invite) redirect.cookies.set(PENDING_INVITE, invite, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: 60 * 60 * 24, path: "/" });
    return redirect;
  }

  // Signed in with an invite still pending in this browser: finish it before anything else.
  const pending = request.cookies.get(PENDING_INVITE)?.value;
  if (signedIn && pending && path === "/workspaces") {
    const target = request.nextUrl.clone();
    target.pathname = `/invite/${pending}`;
    target.search = "";
    const redirect = NextResponse.redirect(target);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    redirect.cookies.delete(PENDING_INVITE);
    return redirect;
  }
  if (signedIn && pending && invite) response.cookies.delete(PENDING_INVITE);

  return response;
}

export const config = {
  matcher: [
    // Everything except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
