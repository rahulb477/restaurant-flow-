import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { CustomerMenu } from "@/components/customer-menu";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = (await db.select({ name: restaurants.name, city: restaurants.city }).from(restaurants).where(eq(restaurants.slug, slug)).limit(1))[0];
  if (!r) return { title: "Menu" };
  return { title: `${r.name} — Order online`, description: `Browse the menu and order at ${r.name}${r.city ? `, ${r.city}` : ""}.`, robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CustomerMenu slug={slug} />;
}
