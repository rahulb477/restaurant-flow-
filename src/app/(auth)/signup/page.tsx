import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCtx, getSessionUser } from "@/lib/server/auth";
import { homeFor } from "@/lib/permissions";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

type SP = { token?: string; oobCode?: string; mode?: string; expired?: string };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (ctx) redirect(ctx.restaurant.onboardingDone ? homeFor(ctx.role) : "/onboarding");
  if (await getSessionUser()) redirect("/onboarding");
  return <AuthForm mode="signup" token={sp.token} code={sp.oobCode} expired={!!sp.expired} />;
}
