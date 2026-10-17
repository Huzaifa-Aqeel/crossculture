import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.redirect(new URL("/auth?error=configuration", request.url));
  const code = request.nextUrl.searchParams.get("code");
  const requested = request.nextUrl.searchParams.get("next");
  const next = requested === "/auth/reset" ? requested : "/account";
  if (!code) return NextResponse.redirect(new URL("/auth?error=missing-code", request.url));

  const response = NextResponse.redirect(new URL(next, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value, options } of items) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/auth?error=expired-link", request.url));
  return response;
}
