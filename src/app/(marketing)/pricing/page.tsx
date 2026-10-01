import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { Eyebrow, Section } from "@/components/marketing";
import { serverEnv } from "@/config/env";
import { formatMoney } from "@/lib/calculations";

export const metadata: Metadata = { title: "Pricing", description: "Start free. Pay a tiny per-order platform fee only on customer QR orders." };
export const dynamic = "force-dynamic";

export default function Pricing() {
  const fee = formatMoney(serverEnv.PLATFORM_FEE_MINOR);
  const items = ["Unlimited products, tables and staff", "QR ordering, POS and KDS", "Inventory, recipes and low-stock alerts", "Loyalty, scratch cards and coupons", "Analytics and activity log", "Invoices with email delivery (when configured)"];
  return (
    <Section className="py-20">
      <div className="text-center"><Eyebrow>Pricing</Eyebrow><h1 className="font-display text-4xl font-semibold tracking-tight md:text-6xl">Simple, usage-based</h1><p className="mx-auto mt-4 max-w-xl text-muted">No monthly subscription. You are charged {fee} per eligible customer QR order — either passed to the customer or absorbed by your store.</p></div>
      <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-accent/40 bg-surface p-8">
        <p className="text-sm text-muted">Everything included</p>
        <p className="mt-2 font-display text-5xl font-semibold">{fee}<span className="text-lg font-normal text-muted"> / QR order</span></p>
        <ul className="mt-6 space-y-3">{items.map((i) => <li key={i} className="flex gap-3 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-accent" />{i}</li>)}</ul>
        <Link href="/signup" className="mt-8 flex h-12 items-center justify-center rounded-xl bg-accent font-semibold text-accent-fg hover:brightness-110">Start Free</Link>
        <p className="mt-3 text-center text-xs text-muted">Staff-entered POS orders carry no platform fee. Settle your balance when it reaches the threshold.</p>
      </div>
    </Section>
  );
}
