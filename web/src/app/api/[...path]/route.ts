import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (!path.every((part) => /^[a-zA-Z0-9-]+$/.test(part))) return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  const personal = path[0] === "me" || path[0] === "entities" || path[0] === "projects" || path[0] === "personal";
  const sessionId = request.cookies.get("cc_session")?.value ?? randomUUID();
  const base = process.env.CROSSCULTURE_API_URL ?? "http://127.0.0.1:8787";

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const updates: { name: string; value: string; options: CookieOptions }[] = [];
    if (personal) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) return NextResponse.json({ message: "Account access is not configured." }, { status: 503 });
      const supabase = createServerClient(url, key, {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (items) => {
            for (const item of items) {
              request.cookies.set(item.name, item.value);
              updates.push(item);
            }
          },
        },
      });
      const { data: claims, error: claimError } = await supabase.auth.getClaims();
      if (claimError || !claims?.claims?.sub) return NextResponse.json({ message: "Sign in to access personal research." }, { status: 401 });
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) return NextResponse.json({ message: "Your session expired. Sign in again." }, { status: 401 });
      headers.authorization = `Bearer ${session.session.access_token}`;
    } else {
      headers["x-session-id"] = sessionId;
    }
    const upstream = await fetch(`${base}/${path.join("/")}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "DELETE" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await upstream.json();
    const response = NextResponse.json(payload, { status: upstream.status });
    response.headers.set("Cache-Control", "private, no-store");
    for (const { name, value, options } of updates) response.cookies.set(name, value, options);
    if (!personal && !request.cookies.has("cc_session")) {
      response.cookies.set("cc_session", sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 });
    }
    return response;
  } catch {
    return NextResponse.json({ message: "Partnership research is unavailable right now. Please try again shortly." }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
