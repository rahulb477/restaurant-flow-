import type { Metadata } from "next";
import { EXTRA, Eyebrow, FEATURES, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "Features", description: "Everything a cafe or restaurant needs: QR ordering, POS, KDS, inventory, billing, loyalty and analytics." };

export default function Features() {
  return (
    <Section className="py-20">
      <Eyebrow>Features</Eyebrow>
      <h1 className="font-display max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">Everything your floor, kitchen and counter need</h1>
      <p className="mt-5 max-w-2xl text-muted">Built around the real workflows of cafes and restaurants — from the first scan to the final receipt.</p>
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[...FEATURES, ...EXTRA].map((f) => (
          <article key={f.title} className="rounded-2xl border border-line bg-surface p-6 transition hover:border-accent/40">
            <f.icon className="size-6 text-accent" />
            <h2 className="mt-4 font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-muted">{f.text}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
