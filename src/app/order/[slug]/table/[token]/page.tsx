import type { Metadata } from "next";
import { repos } from "@/lib/repositories";
import { CustomerMenu } from "@/components/customer-menu";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; token: string }> }): Promise<Metadata> {
  const { slug, token } = await params;
  const R = repos();
  const id = await R.lookup.resolveSlug(slug).catch(() => null);
  const r = id ? await R.restaurants.get(id).catch(() => null) : null;
  if (!r) return { title: "Menu" };
  const t = await R.tenant(r.id).tables.getByQrToken(token).catch(() => null);
  return { title: `${r.name}${t ? ` · Table ${t.name}` : ""}`, description: `Scan, order and pay at ${r.name}.`, robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  return <CustomerMenu slug={slug} tableToken={token} />;
}
