import { createClient } from "@supabase/supabase-js";

let client;

function authClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Auth is not configured.");
  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  return client;
}

export async function verifiedUser(request) {
  const header = request.headers.authorization;
  const match = typeof header === "string" && /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  if (!match) return null;
  const { data, error } = await authClient().auth.getUser(match[1]);
  return error ? null : data.user ?? null;
}
