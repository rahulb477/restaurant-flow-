"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { firebaseReady } from "@/lib/firebase/client";
import {
  acceptInvite, applyVerificationCode, authMessage, checkResetCode, completePasswordReset, refreshVerification, requestPasswordReset,
  resendVerificationEmail, signInWithEmail, signUpWithEmail,
} from "@/lib/firebase/auth";
import { Button, Card, Field, Input, Notice } from "./ui";

type Mode = "login" | "signup" | "forgot" | "reset" | "verify" | "invite";

export function AuthForm({ mode, token, code, expired }: { mode: Mode; token?: string; code?: string; expired?: boolean }) {
  const [v, setV] = useState({ name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [codeState, setCodeState] = useState<"idle" | "working" | "ok" | "fail">("idle");
  const [resetEmail, setResetEmail] = useState("");
  const invite = useApi<{ email: string; role: string; restaurant: string; existingAccount: boolean }>(mode === "invite" && token ? `/api/invite/${token}` : null);
  const ready = firebaseReady();

  // Email links from Firebase carry a one-time `oobCode`.
  useEffect(() => {
    if (!ready || !code) return;
    if (mode === "verify") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time action-code redemption on mount
      setCodeState("working");
      applyVerificationCode(code).then(() => setCodeState("ok")).catch((e) => { setCodeState("fail"); setErr(authMessage(e)); });
    }
    if (mode === "reset") {
      setCodeState("working");
      checkResetCode(code).then((email) => { setResetEmail(email); setCodeState("idle"); }).catch((e) => { setCodeState("fail"); setErr(authMessage(e)); });
    }
  }, [mode, code, ready]);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    if ((mode === "signup" || mode === "reset" || (mode === "invite" && !invite.data?.existingAccount)) && v.password.length < 8) return setErr("Password must be at least 8 characters.");
    if ((mode === "signup" || mode === "reset") && v.password !== v.confirm) return setErr("Passwords do not match.");
    if (mode === "signup" && !v.name.trim()) return setErr("Enter your name.");
    setBusy(true);
    try {
      if (mode === "login") { await signInWithEmail(v.email, v.password); window.location.href = "/dashboard"; return; }
      if (mode === "signup") { await signUpWithEmail(v.name, v.email, v.password); window.location.href = "/onboarding"; return; }
      if (mode === "forgot") { await requestPasswordReset(v.email); setMsg("If an account exists for that email, a reset link is on its way."); }
      if (mode === "reset" && code) { await completePasswordReset(code, v.password); setMsg("Password updated. You can now sign in."); setCodeState("ok"); }
      if (mode === "invite" && token && invite.data) {
        await acceptInvite({ token, email: invite.data.email, existingAccount: invite.data.existingAccount, name: v.name, password: v.password });
        window.location.href = "/dashboard"; return;
      }
    } catch (e2) { setErr(authMessage(e2)); } finally { setBusy(false); }
  }
  async function resend() {
    setErr(""); setMsg(""); setBusy(true);
    try { await resendVerificationEmail(); setMsg("Verification email sent. Check your inbox."); } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  }
  async function checkVerified() {
    setErr(""); setMsg(""); setBusy(true);
    try {
      if (await refreshVerification()) window.location.href = "/dashboard";
      else setMsg("Not verified yet. Open the link in the email, then try again.");
    } catch (e) { setErr(authMessage(e)); } finally { setBusy(false); }
  }

  const titles: Record<Mode, [string, string]> = {
    login: ["Welcome back", "Sign in to your workspace"],
    signup: ["Create your account", "Start running a smarter cafe"],
    forgot: ["Forgot password", "We’ll email you a reset link"],
    reset: ["Choose a new password", resetEmail ? `For ${resetEmail}` : "Use at least 8 characters"],
    verify: ["Verify your email", "Confirm your address to secure your account"],
    invite: ["Join your team", invite.data ? `You’ve been invited to ${invite.data.restaurant} as ${invite.data.role.toLowerCase()}` : "Accept your invitation"],
  };

  return (
    <Card className="anim-fade p-7">
      <h1 className="font-display text-2xl font-semibold">{titles[mode][0]}</h1>
      <p className="mt-1 text-sm text-muted">{titles[mode][1]}</p>

      <div className="mt-5 space-y-4">
        {!ready && <Notice tone="warn">Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* variables in .env and restart.</Notice>}
        {expired && mode === "login" && <Notice tone="warn">Your session expired. Please sign in again.</Notice>}
        {err && <Notice tone="bad">{err}</Notice>}
        {msg && <Notice tone="ok">{msg}</Notice>}

        {mode === "verify" ? (
          <div className="space-y-4 text-sm">
            {code ? (
              codeState === "working" ? <p className="text-muted">Verifying…</p> : codeState === "ok" ? <><Notice tone="ok">Your email is verified.</Notice><Link href="/dashboard" className="text-accent hover:underline">Continue to dashboard →</Link></> : null
            ) : (
              <>
                <div className="flex items-center gap-3 rounded-xl bg-surface2 p-4"><MailCheck className="size-6 text-accent" /><p className="text-muted">Open the verification link we emailed you, then press the button below.</p></div>
                <Button onClick={checkVerified} loading={busy} className="w-full">I’ve verified my email</Button>
                <Button onClick={resend} loading={busy} variant="secondary" className="w-full">Resend verification email</Button>
                <Link href="/dashboard" className="block text-center text-muted hover:text-white">Skip for now</Link>
              </>
            )}
          </div>
        ) : mode === "invite" && !token ? <Notice tone="bad">This invitation link is missing its token.</Notice>
        : mode === "invite" && invite.error ? <Notice tone="bad">{invite.error}</Notice>
        : mode === "reset" && !code ? <Notice tone="bad">This reset link is missing its code. Request a new one from the forgot-password page.</Notice>
        : mode === "reset" && codeState === "fail" ? null
        : mode === "reset" && codeState === "ok" ? <Link href="/login" className="block text-center text-accent hover:underline">Sign in with your new password →</Link>
        : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {(mode === "signup" || (mode === "invite" && invite.data && !invite.data.existingAccount)) && <Field label="Your name"><Input autoComplete="name" value={v.name} onChange={set("name")} required /></Field>}
            {mode === "invite" ? invite.data && <Field label="Email"><Input value={invite.data.email} disabled /></Field> : (mode === "login" || mode === "signup" || mode === "forgot") && <Field label="Email"><Input type="email" autoComplete="email" value={v.email} onChange={set("email")} required /></Field>}
            {mode !== "forgot" && (
              <Field label={mode === "invite" && invite.data?.existingAccount ? "Your existing password" : mode === "reset" ? "New password" : "Password"}>
                <Input type="password" autoComplete={mode === "login" || (mode === "invite" && invite.data?.existingAccount) ? "current-password" : "new-password"} value={v.password} onChange={set("password")} required />
              </Field>
            )}
            {(mode === "signup" || mode === "reset") && <Field label="Confirm password"><Input type="password" autoComplete="new-password" value={v.confirm} onChange={set("confirm")} required /></Field>}
            <Button type="submit" loading={busy} disabled={!ready} className="w-full" size="lg">
              {{ login: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Update password", invite: "Accept & continue", verify: "" }[mode]}
            </Button>
            {mode === "login" && <Link href="/forgot-password" className="block text-center text-sm text-muted hover:text-white">Forgot password?</Link>}
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? <>New here? <Link href="/signup" className="text-accent hover:underline">Create an account</Link></> : mode === "signup" ? <>Already have an account? <Link href="/login" className="text-accent hover:underline">Sign in</Link></> : <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>}
      </p>
    </Card>
  );
}
