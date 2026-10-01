import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart3, ChefHat, Gift, Boxes, QrCode, Receipt, Star, Store, Tags, UtensilsCrossed, Sparkles, CreditCard, MapPin, ShieldCheck } from "lucide-react";
import { publicEnv } from "@/config/env";

export const Logo = ({ className = "" }: { className?: string }) => (
  <span className={`inline-flex items-center gap-2 font-display text-lg font-semibold tracking-tight ${className}`}>
    <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg"><UtensilsCrossed className="size-4" /></span>
    {publicEnv.appName}
  </span>
);

export function Nav() {
  const links = [["Features", "/features"], ["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["FAQ", "/faq"], ["Contact", "/contact"]];
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" aria-label={`${publicEnv.appName} home`}><Logo /></Link>
        <nav className="hidden items-center gap-7 text-sm text-muted md:flex" aria-label="Main">
          {links.map(([l, h]) => <Link key={h} href={h} className="transition hover:text-white">{l}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden h-9 items-center rounded-lg px-3 text-sm text-muted hover:text-white sm:inline-flex">Log in</Link>
          <Link href="/signup" className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:brightness-110">Start free</Link>
        </div>
      </div>
      <nav className="no-scrollbar flex gap-5 overflow-x-auto border-t border-line/60 px-5 py-2 text-xs text-muted md:hidden" aria-label="Mobile">
        {links.map(([l, h]) => <Link key={h} href={h} className="shrink-0">{l}</Link>)}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line/60 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 md:flex-row">
        <div className="max-w-xs"><Logo /><p className="mt-3 text-sm text-muted">The operating system for modern cafes and restaurants.</p></div>
        <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
          <div className="space-y-2"><p className="font-medium">Product</p><Link className="block text-muted hover:text-white" href="/features">Features</Link><Link className="block text-muted hover:text-white" href="/pricing">Pricing</Link><Link className="block text-muted hover:text-white" href="/how-it-works">How it works</Link></div>
          <div className="space-y-2"><p className="font-medium">Company</p><Link className="block text-muted hover:text-white" href="/faq">FAQ</Link><Link className="block text-muted hover:text-white" href="/contact">Contact</Link></div>
          <div className="space-y-2"><p className="font-medium">Account</p><Link className="block text-muted hover:text-white" href="/login">Log in</Link><Link className="block text-muted hover:text-white" href="/signup">Sign up</Link></div>
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-6xl px-5 text-xs text-muted">© {new Date().getFullYear()} {publicEnv.appName}. All rights reserved.</p>
    </footer>
  );
}

export const FEATURES = [
  { id: "qr", icon: QrCode, title: "QR Ordering", text: "Every table gets a unique, secure QR. Guests browse, customise and order from their phone — no app, no waiting for a waiter.", points: ["Per-table secure QR tokens", "Print-ready QR sheets", "Geofenced to your premises"] },
  { id: "pos", icon: Store, title: "Staff POS", text: "A fast counter experience with variants, add-ons, custom items, coupons and split-second checkout for dine-in and takeaway.", points: ["Custom items on the fly", "Cash & dynamic UPI QR", "Role-based access"] },
  { id: "menu", icon: Tags, title: "Digital Menu", text: "Categories, products, size variants and reusable add-ons. Mark items unavailable in one tap and the menu updates everywhere.", points: ["Required/optional variant groups", "Reusable add-ons", "Popular & recommended shelves"] },
  { id: "kds", icon: ChefHat, title: "Kitchen Display", text: "A touch-first live board: New → Preparing → Ready → Done. Recipes and notes are one tap away; no paper tickets.", points: ["Live auto-refresh", "Allergy & prep notes", "Recipe quick view"] },
  { id: "inv", icon: Boxes, title: "Inventory & Recipes", text: "Map ingredients to recipes and stock deducts automatically — exactly once per order. Low-stock alerts before you run out.", points: ["Immutable stock ledger", "Idempotent deduction", "Low-stock alerts"] },
  { id: "bill", icon: Receipt, title: "Billing", text: "Professional invoices with your branding, tax settings and payment status. Print, download or email them.", points: ["Configurable tax", "Print-friendly invoices", "Email receipts"] },
  { id: "loy", icon: Gift, title: "Loyalty & Scratch Cards", text: "Reward regulars with visit-based loyalty and server-side scratch-card campaigns that can't be gamed.", points: ["5 visits → free coffee", "Server-side randomness", "One claim per reward"] },
  { id: "promo", icon: Sparkles, title: "Promotions", text: "Percentage and fixed coupons with limits, windows and product/category rules — always re-validated on the server.", points: ["Per-customer limits", "Product/category rules", "Usage tracking"] },
  { id: "an", icon: BarChart3, title: "Analytics", text: "Revenue, order trends, top products, payment mix and peak hours for any date range, computed from your real orders.", points: ["Today to custom ranges", "Source breakdown", "Discount & fee insights"] },
  { id: "rev", icon: Star, title: "Google Review Assistant", text: "After a completed order guests rate their visit, get an AI-drafted review, copy it and post it on Google themselves.", points: ["Never auto-submitted", "Rating-aware drafts", "Your Google link"] },
];
export const EXTRA = [
  { icon: CreditCard, title: "Flexible payments", text: "Pay first or pay at the end — it genuinely changes order flow." },
  { icon: MapPin, title: "Geofencing", text: "Only guests physically at your venue can place QR orders." },
  { icon: ShieldCheck, title: "Tenant-isolated", text: "Every query is scoped to your restaurant at the server layer." },
];

export function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`mx-auto max-w-6xl px-5 ${className}`}>{children}</section>;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">{children}</p>;
}

/* -------- CSS product visuals -------- */
export function DashboardMock() {
  const bars = [38, 52, 44, 68, 60, 82, 74, 96, 70, 88];
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-[0_30px_80px_-20px_rgba(245,158,11,0.25)]" aria-hidden>
      <div className="flex gap-1.5 pb-3"><i className="size-2.5 rounded-full bg-[#ff5f57]" /><i className="size-2.5 rounded-full bg-[#febc2e]" /><i className="size-2.5 rounded-full bg-[#28c840]" /></div>
      <div className="grid grid-cols-4 gap-2">
        {[["Today's sales", "₹18,420"], ["Orders", "64"], ["Preparing", "7"], ["Low stock", "2"]].map(([a, b]) => (
          <div key={a} className="rounded-xl bg-surface2 p-3"><p className="text-[10px] text-muted">{a}</p><p className="mt-1 text-lg font-semibold">{b}</p></div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="col-span-2 rounded-xl bg-surface2 p-3">
          <p className="text-[10px] text-muted">Revenue · last 10 days</p>
          <div className="mt-3 flex h-28 items-end gap-1.5">{bars.map((h, i) => <div key={i} className="flex-1 rounded-t bg-accent/80" style={{ height: `${h}%` }} />)}</div>
        </div>
        <div className="rounded-xl bg-surface2 p-3">
          <p className="text-[10px] text-muted">Live orders</p>
          {[["T3", "Preparing"], ["T1", "Ready"], ["T5", "New"]].map(([t, s]) => <div key={t} className="mt-2 flex items-center justify-between rounded-lg bg-bg/60 px-2 py-1.5 text-[11px]"><span>{t}</span><span className="text-accent">{s}</span></div>)}
        </div>
      </div>
    </div>
  );
}
export function PhoneMock() {
  return (
    <div className="mx-auto w-56 rounded-[2rem] border-4 border-[#26262b] bg-bg p-3 shadow-2xl" aria-hidden>
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#26262b]" />
      <p className="text-xs font-semibold">Demo Cafe · Table T3</p>
      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-hidden text-[10px]">{["Coffee", "Snacks", "Dessert"].map((c, i) => <span key={c} className={`rounded-full px-2.5 py-1 ${i ? "bg-surface2 text-muted" : "bg-accent text-accent-fg"}`}>{c}</span>)}</div>
      {[["Cappuccino", "₹150"], ["Cold Coffee", "₹180"], ["Brownie", "₹130"]].map(([n, p]) => (
        <div key={n} className="mt-2 flex items-center gap-2 rounded-xl bg-surface p-2"><div className="size-10 rounded-lg bg-surface2" /><div className="flex-1 text-[11px]"><p className="font-medium">{n}</p><p className="text-muted">{p}</p></div><span className="grid size-6 place-items-center rounded-full bg-accent text-accent-fg text-xs">+</span></div>
      ))}
      <div className="mt-3 rounded-xl bg-accent py-2 text-center text-[11px] font-semibold text-accent-fg">View cart · ₹330</div>
    </div>
  );
}
export function KdsMock() {
  const cols: [string, string[]][] = [["New", ["#CP-102 · T2", "#CP-103 · T5"]], ["Preparing", ["#CP-101 · T3"]], ["Ready", ["#CP-100 · T1"]]];
  return (
    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-surface p-3" aria-hidden>
      {cols.map(([c, t]) => (
        <div key={c}><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{c}</p>
          {t.map((x) => <div key={x} className="mb-2 rounded-lg border border-line bg-surface2 p-2 text-[11px]"><p className="font-semibold">{x}</p><p className="mt-1 text-muted">2× Cappuccino<br />1× Veg Sandwich</p></div>)}
        </div>
      ))}
    </div>
  );
}
