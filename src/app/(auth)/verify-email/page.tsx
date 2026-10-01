import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCtx, getSessionUser } from "@/lib/server/auth";
import { homeFor } from "@/lib/permissions";
import { publicEnv } from "@/config/env";

const MODE: string = "verify";
export const metadata: Metadata = { title: MODE === "login" ? "Log in" : "Account" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string; expired?: string }> }) {
  const sp = await searchParams;
  if (MODE === "login" || MODE === "signup") {
    const ctx = await getCtx();
    if (ctx) redirect(ctx.restaurant.onboardingDone ? homeFor(ctx.role) : "/onboarding");
    if (MODE === "signup" && (await getSessionUser())) redirect("/onboarding");
  }
  return <AuthForm mode="verify" token={sp.token} demo={publicEnv.demoMode} expired={!!sp.expired} />;
}
