import type { Metadata } from "next";
import { Eyebrow, Section } from "@/components/marketing";

export const metadata: Metadata = { title: "FAQ", description: "Answers to common questions about QR ordering, payments, inventory and fees." };

const faqs = [
  ["Do my customers need to install an app?", "No. Guests scan the table QR and order from their mobile browser."],
  ["How do UPI payments work?", "Each restaurant stores its own UPI ID. We generate a payment link and QR for the exact order amount. Because a UPI link cannot prove payment, staff confirm receipt before the order is marked paid."],
  ["What is the platform fee?", "A small configurable fee per eligible customer QR order. You choose whether the customer sees it (customer-based) or the store absorbs it (store-based)."],
  ["Is my data isolated from other restaurants?", "Yes. Every server query is scoped to your restaurant through your membership, and roles control what each team member can do."],
  ["Does inventory deduct automatically?", "Yes. Map ingredients to recipes and stock is deducted once per order at the stage you choose. Replays never double-deduct."],
  ["Can I stop out-of-area orders?", "Yes. Enable the geofence, set your location and radius, and QR orders from outside are blocked."],
];
export default function Faq() {
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return (
    <Section className="max-w-3xl py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <Eyebrow>FAQ</Eyebrow>
      <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Frequently asked questions</h1>
      <div className="mt-10 space-y-3">
        {faqs.map(([q, a]) => (
          <details key={q} className="group rounded-2xl border border-line bg-surface p-5 open:border-accent/40">
            <summary className="cursor-pointer list-none font-medium marker:hidden">{q}</summary>
            <p className="mt-3 text-sm text-muted">{a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
