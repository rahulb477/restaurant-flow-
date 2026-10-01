import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

type SP = { token?: string; oobCode?: string; mode?: string; expired?: string };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return <AuthForm mode="verify" token={sp.token} code={sp.oobCode} expired={!!sp.expired} />;
}
