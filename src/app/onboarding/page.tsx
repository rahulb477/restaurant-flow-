import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCtx, getSessionUser } from "@/lib/server/auth";
import { publicRestaurant } from "@/lib/server/services/restaurant";
import { Onboarding } from "@/components/onboarding";

export const metadata: Metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getCtx();
  if (ctx?.restaurant.onboardingDone) redirect("/dashboard");
  return <Onboarding initial={ctx ? JSON.parse(JSON.stringify(publicRestaurant(ctx.restaurant))) : null} email={user.email} />;
}
