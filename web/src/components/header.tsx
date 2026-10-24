"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { browserSupabase } from "@/lib/supabase/client";

export function Header() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let client: ReturnType<typeof browserSupabase>;
    try { client = browserSupabase(); } catch { void Promise.resolve().then(() => setSignedIn(false)); return; }
    let active = true;
    client.auth.getSession().then(({ data }) => { if (active) setSignedIn(Boolean(data.session)); })
      .catch(() => { if (active) setSignedIn(false); });
    const { data } = client.auth.onAuthStateChange((_event, session) => { if (active) setSignedIn(Boolean(session)); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    await browserSupabase().auth.signOut();
    router.push("/");
  }

  return (
    <header className="site-header shell">
      <Link href="/" className="brand" aria-label="CrossCulture home"><span className="brand-mark"><i /><i /></span><span>CrossCulture<span className="brand-period">.</span></span></Link>
      {signedIn === null ? <span className="header-cta" aria-hidden style={{ visibility: "hidden" }}>Sign in</span>
        : signedIn ? <button type="button" className="header-cta" onClick={signOut}>Sign out</button>
          : <Link href="/auth" className="header-cta">Sign in <ArrowUpRight size={16} /></Link>}
    </header>
  );
}
