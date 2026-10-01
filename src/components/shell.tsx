"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, BarChart3, Boxes, ChefHat, ClipboardList, Gift, LayoutDashboard, LogOut, Menu as MenuIcon, MessageCircle, QrCode, Receipt, Search, Settings, ShoppingCart, Star, Store, Tag, Ticket, Users, WifiOff, X, Wallet, Layers, PlusSquare, Carrot, Sparkles, MailWarning } from "lucide-react";
import { can, homeFor, type AppModule } from "@/lib/permissions";
import { apiFetch, post, useApi, useDebounced } from "@/lib/client/api";
import { useNotificationsLive } from "@/lib/client/realtime";
import { signOutEverywhere } from "@/lib/firebase/auth";
import { cx, EmptyState, Notice, UploadScope } from "./ui";
import { Logo } from "./marketing";

type Restaurant = { id: string; name: string; slug: string; logoUrl: string; accent: string; currency: string; timezone: string };
type ShellCtx = { role: string; restaurant: Restaurant; user: { name: string; email: string; emailVerified: boolean }; appName: string };
const Ctx = createContext<ShellCtx | null>(null);
export const useShell = () => useContext(Ctx)!;

export function RoleGate({ module, children }: { module: AppModule; children: ReactNode }) {
  const { role } = useShell();
  if (!can(role, module)) return <EmptyState title="You don’t have access to this page" text="Ask the workspace owner to update your role if you need it." action={<Link href={homeFor(role)} className="text-accent hover:underline">Go to your home</Link>} />;
  return <>{children}</>;
}

type Item = { label: string; href: string; icon: typeof Store; module: AppModule };
const NAV: { title: string; items: Item[] }[] = [
  { title: "Operations", items: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
    { label: "POS", href: "/dashboard/pos", icon: ShoppingCart, module: "pos" },
    { label: "Orders", href: "/dashboard/orders", icon: ClipboardList, module: "orders" },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt, module: "bills" },
  ] },
  { title: "Pinned", items: [
    { label: "KDS", href: "/dashboard/kds", icon: ChefHat, module: "kds" },
    { label: "Inventory", href: "/dashboard/inventory", icon: Boxes, module: "inventory" },
  ] },
  { title: "Menu", items: [
    { label: "Menu", href: "/dashboard/menu", icon: Store, module: "menu" },
    { label: "Categories", href: "/dashboard/menu?tab=categories", icon: Layers, module: "menu" },
    { label: "Products", href: "/dashboard/menu?tab=products", icon: Tag, module: "menu" },
    { label: "Variants", href: "/dashboard/menu?tab=variants", icon: Layers, module: "menu" },
    { label: "Add-ons", href: "/dashboard/menu?tab=addons", icon: PlusSquare, module: "menu" },
    { label: "Ingredients", href: "/dashboard/inventory?tab=stock", icon: Carrot, module: "menu" },
    { label: "AI Digitization", href: "/dashboard/menu/ai-digitization", icon: Sparkles, module: "menu" },
  ] },
  { title: "Customer experience", items: [
    { label: "Tables & QR", href: "/dashboard/tables", icon: QrCode, module: "tables" },
    { label: "Coupons & Offers", href: "/dashboard/promotions", icon: Ticket, module: "promotions" },
    { label: "Loyalty", href: "/dashboard/loyalty", icon: Gift, module: "loyalty" },
    { label: "Scratch Cards", href: "/dashboard/scratch-cards", icon: Sparkles, module: "scratch" },
    { label: "Google Reviews", href: "/dashboard/reviews", icon: Star, module: "reviews" },
  ] },
  { title: "Team", items: [{ label: "Staff", href: "/dashboard/staff", icon: Users, module: "staff" }] },
  { title: "Analytics", items: [
    { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3, module: "analytics" },
    { label: "Usage", href: "/dashboard/usage", icon: Wallet, module: "usage" },
  ] },
  { title: "Settings", items: [
    { label: "Business", href: "/dashboard/settings?tab=business", icon: Settings, module: "settings" },
    { label: "Payments", href: "/dashboard/settings?tab=payments", icon: Settings, module: "settings" },
    { label: "Ordering", href: "/dashboard/settings?tab=ordering", icon: Settings, module: "settings" },
    { label: "Security", href: "/dashboard/settings?tab=security", icon: Settings, module: "settings" },
    { label: "Account", href: "/dashboard/settings?tab=account", icon: Settings, module: "settings" },
  ] },
];

function contrast(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#111111" : "#ffffff";
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useShell();
  const path = usePathname();
  const sp = useSearchParams();
  const active = (href: string) => {
    const [p, q] = href.split("?");
    if (path !== p) return false;
    const tab = q ? new URLSearchParams(q).get("tab") : null;
    const cur = sp.get("tab");
    if (tab) return cur === tab || (tab === "business" && !cur);
    return !cur;
  };
  return (
    <nav aria-label="Dashboard" className="space-y-5 px-3 pb-6">
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(role, i.module));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/70">{g.title}</p>
            {items.map((i) => (
              <Link key={i.href} href={i.href} onClick={onNavigate} aria-current={active(i.href) ? "page" : undefined} className={cx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition", active(i.href) ? "bg-accent/15 text-accent font-medium" : "text-muted hover:bg-surface2 hover:text-white")}>
                <i.icon className="size-4" />{i.label}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { restaurant } = useShell();
  type N = { type: string; title: string; body: string; isRead: boolean; createdAt: string };
  const live = useNotificationsLive<N>(restaurant.id);
  const data = live.data ? { items: live.data, unread: live.data.filter((n) => !n.isRead).length } : null;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)} className="relative grid size-10 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-white">
        <Bell className="size-5" />
        {!!data?.unread && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="anim-pop absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><p className="text-sm font-semibold">Notifications</p>{!!data?.unread && <button className="text-xs text-accent" onClick={async () => { await post("/api/dash/notifications-read"); }}>Mark all read</button>}</div>
          <ul className="max-h-96 overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-muted">You’re all caught up.</li>}
            {data?.items.map((n) => (
              <li key={n.id} className={cx("border-b border-line/60 px-4 py-3 text-sm", !n.isRead && "bg-accent/5")}><p className="font-medium">{n.title}</p>{n.body && <p className="text-xs text-muted">{n.body}</p>}<p className="mt-1 text-[10px] text-muted">{new Date(n.createdAt).toLocaleString()}</p></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const d = useDebounced(q, 250);
  const [res, setRes] = useState<{ type: string; id: string; title: string; subtitle: string; href: string }[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (d.trim().length < 2) { Promise.resolve().then(() => setRes([])); return; }
    let live = true;
    apiFetch<{ results: typeof res }>(`/api/dash/search?q=${encodeURIComponent(d)}`).then((r) => live && setRes(r.results)).catch(() => {});
    return () => { live = false; };
  }, [d]);
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input aria-label="Search products, orders, customers, tables, staff" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Search orders, products, customers…" className="h-10 w-full rounded-lg border border-line bg-surface2 pl-9 pr-3 text-sm placeholder:text-[#6b6b76] focus:border-accent focus:outline-none" />
      {open && q.trim().length >= 2 && (
        <ul className="anim-pop absolute left-0 right-0 z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface shadow-2xl">
          {!res.length && <li className="px-4 py-6 text-center text-sm text-muted">No results</li>}
          {res.map((r) => (
            <li key={r.type + r.id}><button onMouseDown={() => { router.push(r.href); setQ(""); }} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface2"><span className="truncate">{r.title}<span className="ml-2 text-xs text-muted">{r.subtitle}</span></span><span className="shrink-0 rounded bg-surface2 px-1.5 py-0.5 text-[10px] text-muted">{r.type}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Shell({ children, ...ctx }: ShellCtx & { children: ReactNode; whatsapp: string }) {
  const { restaurant, role, user, whatsapp } = ctx;
  const [drawer, setDrawer] = useState(false);
  const [offline, setOffline] = useState(false);
  const path = usePathname();
  const accent = /^#[0-9a-f]{6}$/i.test(restaurant.accent) ? restaurant.accent : "#f59e0b";
  const fullBleed = path.startsWith("/dashboard/kds");

  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    const net = (e: Event) => setOffline(!(e as CustomEvent).detail.ok);
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener("cp-network", net);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("cp-network", net); };
  }, []);
  useEffect(() => { Promise.resolve().then(() => setDrawer(false)); }, [path]);

  async function logout() {
    await signOutEverywhere();
    window.location.href = "/login";
  }
  const bottom = ([["/dashboard", "Home", LayoutDashboard, "dashboard"], ["/dashboard/pos", "POS", ShoppingCart, "pos"], ["/dashboard/orders", "Orders", ClipboardList, "orders"], ["/dashboard/kds", "KDS", ChefHat, "kds"]] as const).filter((b) => can(role, b[3] as AppModule));

  return (
    <Ctx.Provider value={ctx}>
      <UploadScope.Provider value={restaurant.id}>
      <div style={{ ["--accent" as string]: accent, ["--accent-fg" as string]: contrast(accent) }} className="min-h-screen">
        <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface md:flex">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
            {restaurant.logoUrl ?   <img src={restaurant.logoUrl} alt="" className="size-8 rounded-lg object-cover" /> : <Logo className="text-base" />}
            {restaurant.logoUrl && <span className="truncate font-display font-semibold">{restaurant.name}</span>}
          </div>
          <div className="flex-1 overflow-y-auto py-4"><Suspense fallback={null}><NavList /></Suspense></div>
          {whatsapp && <a href={`https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`} target="_blank" rel="noopener noreferrer" className="m-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-white"><MessageCircle className="size-4 text-[#25d366]" />Support on WhatsApp</a>}
        </aside>

        {drawer && (
          <div className="fixed inset-0 z-50 md:hidden no-print">
            <div className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} aria-hidden />
            <div className="anim-slide absolute inset-y-0 left-0 flex w-72 flex-col bg-surface" role="dialog" aria-modal="true" aria-label="Navigation">
              <div className="flex h-16 items-center justify-between border-b border-line px-5"><Logo className="text-base" /><button aria-label="Close menu" onClick={() => setDrawer(false)}><X className="size-5" /></button></div>
              <div className="flex-1 overflow-y-auto py-4"><Suspense fallback={null}><NavList onNavigate={() => setDrawer(false)} /></Suspense></div>
              {whatsapp && <a href={`https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`} target="_blank" rel="noopener noreferrer" className="m-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted"><MessageCircle className="size-4 text-[#25d366]" />Support on WhatsApp</a>}
            </div>
          </div>
        )}

        <div className="md:pl-64">
          <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-xl md:px-8">
            <button aria-label="Open menu" className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface2 md:hidden" onClick={() => setDrawer(true)}><MenuIcon className="size-5" /></button>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-1">
              <Notifications />
              <div className="hidden items-center gap-3 pl-2 sm:flex"><div className="text-right text-xs leading-tight"><p className="font-medium">{user.name || user.email}</p><p className="text-muted">{role.toLowerCase()}</p></div></div>
              <button aria-label="Log out" title="Log out" onClick={logout} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-white"><LogOut className="size-5" /></button>
            </div>
          </header>
          {offline && <div role="alert" className="no-print flex items-center justify-center gap-2 bg-warn/15 px-4 py-2 text-sm text-warn"><WifiOff className="size-4" />Connection lost. Reconnecting…</div>}
          {!user.emailVerified && role === "OWNER" && (
            <div className="no-print px-4 pt-4 md:px-8"><Notice tone="warn"><span className="inline-flex items-center gap-2"><MailWarning className="size-4" />Your email isn’t verified yet. <Link href="/verify-email" className="underline">Verify now</Link></span></Notice></div>
          )}
          <main className={cx(fullBleed ? "p-3 md:p-5" : "mx-auto max-w-7xl p-4 pb-28 md:p-8 md:pb-10")}>
            <div className="anim-fade">{children}</div>
          </main>
        </div>

        <nav aria-label="Quick navigation" className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur md:hidden">
          {bottom.map(([href, label, Icon]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={cx("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]", path === href ? "text-accent" : "text-muted")}><Icon className="size-5" />{label}</Link>
          ))}
          <button onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] text-muted"><MenuIcon className="size-5" />More</button>
        </nav>
      </div>
      </UploadScope.Provider>
    </Ctx.Provider>
  );
}
