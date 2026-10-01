import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { DashboardMock, EXTRA, Eyebrow, FEATURES, KdsMock, PhoneMock, Section } from "@/components/marketing";
import { publicEnv } from "@/config/env";

export default function Home() {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: publicEnv.appName, url: publicEnv.appUrl || undefined },
      { "@type": "SoftwareApplication", name: publicEnv.appName, applicationCategory: "BusinessApplication", operatingSystem: "Web", offers: { "@type": "Offer", price: "0", priceCurrency: "INR" } },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <div className="relative overflow-hidden">
        <div className="grid-bg absolute inset-0" aria-hidden />
        <div className="absolute left-1/2 top-0 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]" aria-hidden />
        <Section className="relative pb-20 pt-20 text-center md:pt-28">
          <p className="mx-auto mb-6 inline-flex rounded-full border border-line bg-surface/70 px-4 py-1.5 text-xs text-muted">QR ordering · POS · KDS · Inventory · Billing · Loyalty · Analytics</p>
          <h1 className="font-display mx-auto max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">Run your cafe <span className="text-accent">smarter</span></h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">One platform for table QR ordering, a lightning-fast POS, a live kitchen board, automatic inventory, professional billing and loyalty that brings guests back.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-7 font-semibold text-accent-fg hover:brightness-110">Start Free <ArrowRight className="size-4" /></Link>
            <Link href="/how-it-works" className="inline-flex h-12 items-center rounded-xl border border-line px-7 font-medium hover:bg-surface">See How It Works</Link>
          </div>
          <div className="relative mx-auto mt-16 max-w-4xl text-left"><DashboardMock /></div>
        </Section>
      </div>

      {FEATURES.map((f, i) => (
        <Section key={f.id} className="py-16">
          <div className={`grid items-center gap-10 md:grid-cols-2 ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`}>
            <div>
              <Eyebrow>{String(i + 1).padStart(2, "0")} · {f.title}</Eyebrow>
              <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{f.title}</h2>
              <p className="mt-4 text-muted">{f.text}</p>
              <ul className="mt-6 space-y-2.5">{f.points.map((p) => <li key={p} className="flex items-center gap-2.5 text-sm"><span className="grid size-5 place-items-center rounded-full bg-accent/15 text-accent"><Check className="size-3" /></span>{p}</li>)}</ul>
            </div>
            <div className="rounded-3xl border border-line bg-surface/50 p-6">
              {f.id === "qr" ? <PhoneMock /> : f.id === "kds" ? <KdsMock /> : (
                <div className="grid place-items-center py-10"><div className="grid size-20 place-items-center rounded-2xl bg-accent/15 text-accent"><f.icon className="size-9" /></div><p className="mt-4 font-display text-xl">{f.title}</p></div>
              )}
            </div>
          </div>
        </Section>
      ))}

      <Section className="py-16">
        <div className="grid gap-4 md:grid-cols-3">{EXTRA.map((e) => <div key={e.title} className="rounded-2xl border border-line bg-surface p-6"><e.icon className="size-6 text-accent" /><p className="mt-4 font-semibold">{e.title}</p><p className="mt-1 text-sm text-muted">{e.text}</p></div>)}</div>
      </Section>

      <Section className="pb-24">
        <div className="rounded-3xl border border-line bg-gradient-to-br from-surface to-bg p-10 text-center md:p-16">
          <h2 className="font-display text-3xl font-semibold md:text-5xl">Ready to run a smarter cafe?</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">Set up in minutes. Create your menu, print your table QRs and take your first order today.</p>
          <Link href="/signup" className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-8 font-semibold text-accent-fg hover:brightness-110">Start Free <ArrowRight className="size-4" /></Link>
        </div>
      </Section>
    </>
  );
}
