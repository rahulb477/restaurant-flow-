import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCtx, getSessionUser } from "@/lib/server/auth";
import { Shell } from "@/components/shell";
import { publicEnv } from "@/config/env";
import { resolveSettings } from "@/lib/server/services/orders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getCtx();
  if (!ctx || !ctx.restaurant.onboardingDone) redirect("/onboarding");
  const r = ctx.restaurant;
  const s = resolveSettings(r.settings);
  return (
    <Shell
      appName={publicEnv.appName}
      whatsapp={s.whatsapp || publicEnv.supportWhatsapp}
      role={ctx.role}
      user={{ name: user.name, email: user.email, emailVerified: user.emailVerified }}
      restaurant={{ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logoUrl, accent: r.accent, currency: r.currency, timezone: r.timezone }}
    >
      {children}
    </Shell>
  );
}
