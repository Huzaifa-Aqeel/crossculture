"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { browserSupabase } from "@/lib/supabase/client";
import "../auth.css";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const supabase = browserSupabase();
      const { data: { user }, error: sessionError } = await supabase.auth.getUser();
      if (sessionError || !user) throw new Error("This reset link has expired. Request a new one.");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage("Password updated. You can now open your account."); setPassword("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update the password."); }
    finally { setBusy(false); }
  }
  return <><Header /><main className="auth-shell shell"><div className="auth-intro"><span className="eyebrow"><span className="eyebrow-dot" /> ACCOUNT SECURITY</span><h1>Choose a new password.</h1><p>Use a password you have not used for this account before.</p><Link href="/auth" className="text-link">Return to sign in</Link></div><section className="auth-card"><form onSubmit={submit}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />{error && <p role="alert" className="auth-error">{error}</p>}{message && <p role="status" className="auth-message">{message} <Link href="/account">Open account</Link></p>}<button type="submit" className="button button-dark auth-submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button></form></section></main></>;
}
