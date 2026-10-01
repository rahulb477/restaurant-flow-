import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { restaurants, diningTables } from "@/db/schema";
import { CustomerMenu } from "@/components/customer-menu";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; token: string }> }): Promise<Metadata> {
  const { slug, token } = await params;
  const r = (await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants).where(eq(restaurants.slug, slug)).limit(1))[0];
  if (!r) return { title: "Menu" };
  const t = (await db.select({ name: diningTables.name }).from(diningTables).where(and(eq(diningTables.restaurantId, r.id), eq(diningTables.qrToken, token))).limit(1))[0];
  return { title: `${r.name}${t ? ` · Table ${t.name}` : ""}`, description: `Scan, order and pay at ${r.name}.`, robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  return <CustomerMenu slug={slug} tableToken={token} />;
}
