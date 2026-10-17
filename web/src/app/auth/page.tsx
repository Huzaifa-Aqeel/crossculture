"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { browserSupabase } from "@/lib/supabase/client";
import "./auth.css";

type Mode = "sign_in" | "sign_up" | "reset";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const supabase = browserSupabase();
      const origin = window.location.origin;
      if (mode === "reset") {
        const { error: failure } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${origin}/auth/callback?next=/auth/reset`,
        });
        if (failure) throw failure;
        setMessage("If this address has an account, a reset link is on its way.");
      } else if (mode === "sign_up") {
        const { data, error: failure } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: `${origin}/auth/callback?next=/account` },
        });
        if (failure) throw failure;
        if (data.session) window.location.assign("/account");
        else setMessage("Check your email to confirm your account, then sign in.");
      } else {
        const { error: failure } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (failure) throw failure;
        window.location.assign("/account");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Account access is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <><Header /><main className="auth-shell shell">
    <div className="auth-intro"><span className="eyebrow"><span className="eyebrow-dot" /> YOUR WORKSPACE</span><h1>{mode === "sign_up" ? "Create an account." : mode === "reset" ? "Reset your password." : "Welcome back."}</h1><p>Keep your research together as you explore future partnerships.</p><Link href="/discover" className="text-link">Continue with the live demo</Link></div>
    <section className="auth-card" aria-label="Account access"><div className="auth-tabs"><button type="button" aria-current={mode === "sign_in" ? "page" : undefined} onClick={() => { setMode("sign_in"); setError(""); setMessage(""); }}>Sign in</button><button type="button" aria-current={mode === "sign_up" ? "page" : undefined} onClick={() => { setMode("sign_up"); setError(""); setMessage(""); }}>Create account</button></div>
      <form onSubmit={submit}><label htmlFor="account-email">Email address</label><input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />{mode !== "reset" && <><label htmlFor="account-password">Password</label><input id="account-password" type="password" autoComplete={mode === "sign_up" ? "new-password" : "current-password"} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></>}
        {error && <p role="alert" className="auth-error">{error}</p>}{message && <p role="status" className="auth-message">{message}</p>}
        <button type="submit" className="button button-dark auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "sign_up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
      </form><button type="button" className="auth-text-button" onClick={() => { setMode(mode === "reset" ? "sign_in" : "reset"); setError(""); setMessage(""); }}>{mode === "reset" ? "Back to sign in" : "Forgot your password?"}</button>
    </section>
  </main></>;
}
