import type { Metadata } from "next";
import { repos } from "@/lib/repositories";
import { CustomerMenu } from "@/components/customer-menu";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const R = repos();
  const id = await R.lookup.resolveSlug(slug).catch(() => null);
  const r = id ? await R.restaurants.get(id).catch(() => null) : null;
  if (!r) return { title: "Menu" };
  return { title: `${r.name} — Order online`, description: `Browse the menu and order at ${r.name}${r.city ? `, ${r.city}` : ""}.`, robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CustomerMenu slug={slug} />;
}
