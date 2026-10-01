import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "How it works", description: "From signup to your first QR order in four steps." };

const steps = [
  ["Create your workspace", "Sign up, name your business and set payment timing and fee mode in a short onboarding."],
  ["Build your menu", "Add categories, products, variants and add-ons — or digitise a menu photo with AI when configured."],
  ["Set up tables & QR", "Create tables, print the QR sheet and place one on each table. Optionally enable geofencing."],
  ["Take orders", "Guests scan and order, staff use the POS, and the kitchen works from a live board. Bills, inventory, loyalty and usage update automatically."],
];
export default function How() {
  return (
    <Section className="py-20">
      <Eyebrow>How it works</Eyebrow>
      <h1 className="font-display max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">From signup to first order in minutes</h1>
      <ol className="mt-12 grid gap-4 md:grid-cols-2">
        {steps.map(([t, d], i) => (
          <li key={t} className="rounded-2xl border border-line bg-surface p-6"><span className="font-display text-4xl text-accent">{i + 1}</span><h2 className="mt-3 font-semibold">{t}</h2><p className="mt-2 text-sm text-muted">{d}</p></li>
        ))}
      </ol>
      <div className="mt-10"><Link href="/signup" className="inline-flex h-12 items-center rounded-xl bg-accent px-7 font-semibold text-accent-fg hover:brightness-110">Start Free</Link></div>
    </Section>
  );
}
