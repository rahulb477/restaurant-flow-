import { redirect } from "next/navigation";
import { getCtx } from "@/lib/server/auth";
import { can, homeFor } from "@/lib/permissions";
import { DashboardHome } from "@/components/pages/dashboard-home";

export default async function Page() {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (!can(ctx.role, "dashboard")) redirect(homeFor(ctx.role));
  return <DashboardHome />;
}
