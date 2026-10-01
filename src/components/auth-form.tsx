"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MailCheck, Sparkles } from "lucide-react";
import { apiFetch, post, useApi } from "@/lib/client/api";
import { Button, Card, Field, Input, Notice } from "./ui";

type Mode = "login" | "signup" | "forgot" | "reset" | "verify" | "invite";

export function AuthForm({ mode, token, demo, expired }: { mode: Mode; token?: string; demo: boolean; expired?: boolean }) {
  const [v, setV] = useState({ name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [verifyState, setVerifyState] = useState<"idle" | "working" | "ok" | "fail">("idle");
  const invite = useApi<{ email: string; role: string; restaurant: string; existingAccount: boolean }>(mode === "invite" && token ? `/api/invite/${token}` : null);

  useEffect(() => {
    if (mode !== "verify" || !token) return;
     
    setVerifyState("working");
    post("/api/auth/verify", { token }).then(() => setVerifyState("ok")).catch((e) => { setVerifyState("fail"); setErr((e as Error).message); });
  }, [mode, token]);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    if ((mode === "signup" || mode === "reset" || mode === "invite") && v.password.length < 8) return setErr("Password must be at least 8 characters.");
    if ((mode === "signup" || mode === "reset") && v.password !== v.confirm) return setErr("Passwords do not match.");
    setBusy(true);
    try {
      if (mode === "login") { await post("/api/auth/login", { email: v.email, password: v.password }); window.location.href = "/dashboard"; return; }
      if (mode === "signup") { await post("/api/auth/signup", { name: v.name, email: v.email, password: v.password }); window.location.href = "/onboarding"; return; }
      if (mode === "forgot") { const r = await post<{ message: string }>("/api/auth/forgot", { email: v.email }); setMsg(r.message); }
      if (mode === "reset") { await post("/api/auth/reset", { token, password: v.password }); setMsg("Password updated. You can now sign in."); }
      if (mode === "invite") { await post("/api/auth/accept-invite", { token, name: v.name, password: v.password }); window.location.href = "/dashboard"; return; }
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }
  async function resend() {
    setErr(""); setMsg(""); setBusy(true);
    try { const r = await post<{ message?: string }>("/api/auth/resend"); setMsg(r.message ?? "Verification email sent."); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function useDemo() {
    setBusy(true); setErr("");
    try { await apiFetch("/api/auth/demo", { method: "POST", json: {} }); window.location.href = "/dashboard"; } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const titles: Record<Mode, [string, string]> = {
    login: ["Welcome back", "Sign in to your workspace"],
    signup: ["Create your account", "Start running a smarter cafe"],
    forgot: ["Forgot password", "We’ll email you a reset link"],
    reset: ["Choose a new password", "Use at least 8 characters"],
    verify: ["Verify your email", "Confirm your address to secure your account"],
    invite: ["Join your team", invite.data ? `You’ve been invited to ${invite.data.restaurant} as ${invite.data.role.toLowerCase()}` : "Accept your invitation"],
  };

  return (
    <Card className="anim-fade p-7">
      <h1 className="font-display text-2xl font-semibold">{titles[mode][0]}</h1>
      <p className="mt-1 text-sm text-muted">{titles[mode][1]}</p>

      <div className="mt-5 space-y-4">
        {expired && mode === "login" && <Notice tone="warn">Your session expired. Please sign in again.</Notice>}
        {err && <Notice tone="bad">{err}</Notice>}
        {msg && <Notice tone="ok">{msg}</Notice>}

        {mode === "verify" ? (
          <div className="space-y-4 text-sm">
            {token ? (
              verifyState === "working" ? <p className="text-muted">Verifying…</p> : verifyState === "ok" ? <><Notice tone="ok">Your email is verified.</Notice><Link href="/dashboard" className="text-accent hover:underline">Continue to dashboard →</Link></> : null
            ) : (
              <>
                <div className="flex items-center gap-3 rounded-xl bg-surface2 p-4"><MailCheck className="size-6 text-accent" /><p className="text-muted">Open the verification link we emailed you. Didn’t get it?</p></div>
                <Button onClick={resend} loading={busy} variant="secondary" className="w-full">Resend verification email</Button>
                <Link href="/dashboard" className="block text-center text-muted hover:text-white">Skip for now</Link>
              </>
            )}
          </div>
        ) : mode === "invite" && !token ? <Notice tone="bad">This invitation link is missing its token.</Notice>
        : mode === "invite" && invite.error ? <Notice tone="bad">{invite.error}</Notice>
        : mode === "reset" && !token ? <Notice tone="bad">This reset link is missing its token.</Notice>
        : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {(mode === "signup" || (mode === "invite" && invite.data && !invite.data.existingAccount)) && <Field label="Your name"><Input autoComplete="name" value={v.name} onChange={set("name")} required /></Field>}
            {mode === "invite" ? invite.data && <Field label="Email"><Input value={invite.data.email} disabled /></Field> : (mode === "login" || mode === "signup" || mode === "forgot") && <Field label="Email"><Input type="email" autoComplete="email" value={v.email} onChange={set("email")} required /></Field>}
            {mode !== "forgot" && (
              <Field label={mode === "invite" && invite.data?.existingAccount ? "Your existing password" : mode === "reset" ? "New password" : "Password"}>
                <Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={v.password} onChange={set("password")} required />
              </Field>
            )}
            {(mode === "signup" || mode === "reset") && <Field label="Confirm password"><Input type="password" autoComplete="new-password" value={v.confirm} onChange={set("confirm")} required /></Field>}
            <Button type="submit" loading={busy} className="w-full" size="lg">
              {{ login: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Update password", invite: "Accept & continue", verify: "" }[mode]}
            </Button>
            {mode === "login" && <Link href="/forgot-password" className="block text-center text-sm text-muted hover:text-white">Forgot password?</Link>}
          </form>
        )}

        {mode === "login" && demo && (
          <Button variant="outline" className="w-full" onClick={useDemo} loading={busy}><Sparkles className="size-4" />Use Demo workspace</Button>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? <>New here? <Link href="/signup" className="text-accent hover:underline">Create an account</Link></> : mode === "signup" ? <>Already have an account? <Link href="/login" className="text-accent hover:underline">Sign in</Link></> : <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>}
      </p>
    </Card>
  );
}
