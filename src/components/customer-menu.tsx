"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPinOff, Minus, Plus, Search, ShoppingBag, Trash2, WifiOff, Leaf, Tag } from "lucide-react";
import { formatMoney } from "@/lib/calculations";
import { ApiClientError, apiFetch, post, useApi, useDebounced } from "@/lib/client/api";
import { Button, EmptyState, Field, Input, Modal, Notice, Skeleton, Textarea, cx } from "./ui";
import { ProductConfigurator, type CartLine, type CGroup, type CAddon, type CProduct } from "./configurator";

type Product = CProduct & { availability: string; isPopular: boolean; isRecommended: boolean; isVeg: boolean };
type Menu = {
  restaurant: { name: string; slug: string; logoUrl: string; accent: string; currency: string; address: string; settings: { paymentTiming: string; customerOrdering: boolean; tableOrdering: boolean; payments: { cash: boolean; upi: boolean }; fees: { mode: string; amountMinor: number }; tax: { enabled: boolean; name: string; ratePct: number }; geofence: { enabled: boolean; radiusMeters: number } } };
  table: { name: string } | null;
  categories: { id: string; name: string }[];
  products: Product[];
  variantGroups: CGroup[];
  addons: CAddon[];
};
type Quote = { subtotal: number; discount: number; tax: number; taxLabel: string; platformFee: number; total: number };

function contrast(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? "#111111" : "#ffffff";
}

export function CustomerMenu({ slug, tableToken }: { slug: string; tableToken?: string }) {
  const router = useRouter();
  const { data, error, loading } = useApi<Menu>(`/api/public/menu?slug=${encodeURIComponent(slug)}${tableToken ? `&table=${encodeURIComponent(tableToken)}` : ""}`, { poll: 60000 });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cfg, setCfg] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [offline, setOffline] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState("");
  const [couponErr, setCouponErr] = useState("");
  const [cust, setCust] = useState({ name: "", phone: "", email: "", notes: "" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const idem = useRef(crypto.randomUUID());
  const cur = data?.restaurant.currency ?? "INR";
  const m = (n: number) => formatMoney(n, cur);

  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    const net = (e: Event) => setOffline(!(e as CustomEvent).detail.ok);
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener("cp-network", net);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("cp-network", net); };
  }, []);

  const payload = useMemo(() => ({ slug, tableToken: tableToken ?? null, items: cart.map((l) => ({ productId: l.productId!, qty: l.qty, variants: l.variants, addonIds: l.addonIds, notes: l.notes })), couponCode: applied || undefined, customer: { name: cust.name, phone: cust.phone, email: cust.email }, notes: cust.notes }), [slug, tableToken, cart, applied, cust]);
  const debounced = useDebounced(payload, 350);

  // Server-calculated totals (never trust client math)
  useEffect(() => {
    if (!debounced.items.length) { Promise.resolve().then(() => { setQuote(null); setQuoteErr(""); }); return; }
    let live = true;
    post<Quote>("/api/public/quote", debounced).then((q) => { if (live) { setQuote(q); setQuoteErr(""); setCouponErr(""); } }).catch((e) => {
      if (!live) return;
      const code = (e as ApiClientError).code;
      if (code === "COUPON_INVALID" || code === "COUPON_NEEDS_CUSTOMER") { setCouponErr((e as Error).message); setApplied(""); } else setQuoteErr((e as Error).message);
    });
    return () => { live = false; };
  }, [debounced]);

  const touch = useCallback(() => { idem.current = crypto.randomUUID(); }, []);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const estimate = cart.reduce((s, l) => s + l.unit * l.qty, 0);

  const filtered = useMemo(() => (data?.products ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase())), [data, search]);
  const sections = useMemo(() => {
    if (!data) return [];
    const out: { id: string; title: string; items: Product[] }[] = [];
    if (!search && cat === "all") {
      const pop = filtered.filter((p) => p.isPopular); if (pop.length) out.push({ id: "popular", title: "Popular", items: pop });
      const rec = filtered.filter((p) => p.isRecommended && !p.isPopular); if (rec.length) out.push({ id: "rec", title: "Recommended", items: rec });
    }
    for (const c of data.categories) {
      if (cat !== "all" && cat !== c.id) continue;
      const items = filtered.filter((p) => p.categoryId === c.id);
      if (items.length) out.push({ id: c.id, title: c.name, items });
    }
    const un = filtered.filter((p) => !p.categoryId || !data.categories.some((c) => c.id === p.categoryId));
    if (un.length && cat === "all") out.push({ id: "other", title: "More", items: un });
    return out;
  }, [data, filtered, cat, search]);

  function add(p: Product) {
    if (p.availability !== "AVAILABLE") return;
    if (p.variantGroupIds.length || p.addonIds.length) return setCfg(p);
    touch();
    setCart((c) => { const ex = c.find((l) => l.productId === p.id && !l.notes && !l.extras); return ex ? c.map((l) => (l === ex ? { ...l, qty: Math.min(99, l.qty + 1) } : l)) : [...c, { key: crypto.randomUUID(), productId: p.id, name: p.name, qty: 1, unit: p.price, variants: {}, addonIds: [], notes: "", extras: "" }]; });
  }
  const setQty = (key: string, d: number) => { touch(); setCart((c) => c.flatMap((l) => (l.key === key ? (l.qty + d <= 0 ? [] : [{ ...l, qty: Math.min(99, l.qty + d) }]) : [l]))); };

  async function locate(): Promise<{ lat: number; lng: number } | null> {
    if (!data?.restaurant.settings.geofence.enabled) return null;
    if (!("geolocation" in navigator)) throw new Error("Your browser doesn’t support location, which this restaurant requires to order.");
    return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => rej(new Error(e.code === 1 ? "Location permission was denied. Please allow location access to confirm you’re at the restaurant." : e.code === 3 ? "Finding your location timed out. Please try again." : "Your location is unavailable right now.")),
      { timeout: 12000, enableHighAccuracy: true, maximumAge: 30000 },
    ));
  }
  async function placeOrder() {
    setErr("");
    if (offline) return setErr("You’re offline. Reconnect and try again — your cart is saved.");
    setBusy(true);
    try {
      const location = await locate();
      const r = await apiFetch<{ token: string }>("/api/public/order", { method: "POST", json: { ...payload, idempotencyKey: idem.current, location } });
      setCart([]); setOpen(false);
      router.push(`/track/${r.token}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (error && !data) return (
    <div className="grid min-h-screen place-items-center px-6"><EmptyState icon={<MapPinOff className="size-5" />} title={error.includes("QR") ? "This QR code isn’t valid" : "Menu unavailable"} text={error} /></div>
  );
  if (loading || !data) return <div className="mx-auto max-w-lg space-y-3 p-4"><Skeleton className="h-14" /><Skeleton className="h-10" />{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  const r = data.restaurant;
  const accent = /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : "#f59e0b";
  const paused = !r.settings.customerOrdering || (data.table && !r.settings.tableOrdering);

  return (
    <div style={{ ["--accent" as string]: accent, ["--accent-fg" as string]: contrast(accent) }} className="mx-auto min-h-screen max-w-lg pb-28">
      {offline && <div role="alert" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-warn/20 py-2 text-sm text-warn"><WifiOff className="size-4" />Connection lost. Reconnecting…</div>}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          {r.logoUrl ?   <img src={r.logoUrl} alt="" className="size-11 rounded-xl object-cover" /> : <div className="grid size-11 place-items-center rounded-xl bg-accent font-display text-lg font-bold text-accent-fg">{r.name[0]}</div>}
          <div className="min-w-0 flex-1"><h1 className="truncate font-display text-lg font-semibold leading-tight">{r.name}</h1><p className="truncate text-xs text-muted">{data.table ? `Table ${data.table.name}` : r.address || "Order online"}</p></div>
        </div>
        <div className="relative mt-3"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input aria-label="Search menu" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the menu" className="h-11 w-full rounded-xl border border-line bg-surface2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none" /></div>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Categories">
          {[{ id: "all", name: "All" }, ...data.categories].map((c) => <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)} className={cx("shrink-0 rounded-full px-4 py-2 text-sm transition", cat === c.id ? "bg-accent font-semibold text-accent-fg" : "bg-surface2 text-muted")}>{c.name}</button>)}
        </div>
      </header>

      <main className="space-y-7 px-4 pt-5">
        {paused && <Notice tone="warn">Online ordering is paused right now. Please order at the counter.</Notice>}
        {!sections.length && <EmptyState title={search ? "Nothing matches your search" : "The menu is being prepared"} text={search ? "Try a different word." : "Please check back in a moment."} />}
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={`s-${s.id}`}>
            <h2 id={`s-${s.id}`} className="mb-3 font-display text-xl font-semibold">{s.title}</h2>
            <ul className="space-y-3">
              {s.items.map((p) => {
                const off = p.availability !== "AVAILABLE";
                return (
                  <li key={p.id} className={cx("flex gap-3 rounded-2xl border border-line bg-surface p-3", off && "opacity-60")}>
                    <button onClick={() => add(p)} disabled={off || !!paused} aria-label={`${p.name}, ${m(p.price)}`} className="flex min-w-0 flex-1 gap-3 text-left">
                      {p.imageUrl ?   <img src={p.imageUrl} alt="" loading="lazy" className="size-24 shrink-0 rounded-xl object-cover" /> : <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-surface2 text-3xl">🍽️</div>}
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className={cx("grid size-4 shrink-0 place-items-center rounded-sm border", p.isVeg ? "border-ok" : "border-bad")}><Leaf className={cx("size-2.5", p.isVeg ? "text-ok" : "text-bad")} /></span><p className="truncate font-medium">{p.name}</p></div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p>
                        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-accent">{m(p.price)}{off && <span className="rounded bg-bad/15 px-1.5 py-0.5 text-[10px] font-normal text-bad">{p.availability.replace(/_/g, " ").toLowerCase()}</span>}</p></div>
                    </button>
                    {!off && !paused && <button onClick={() => add(p)} aria-label={`Add ${p.name}`} className="grid size-10 shrink-0 self-end place-items-center rounded-full bg-accent text-accent-fg active:scale-95"><Plus className="size-5" /></button>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg p-4"><button onClick={() => setOpen(true)} className="anim-pop flex h-14 w-full items-center justify-between rounded-2xl bg-accent px-5 font-semibold text-accent-fg shadow-2xl"><span className="flex items-center gap-2"><ShoppingBag className="size-5" />View cart · {count} item{count > 1 ? "s" : ""}</span><span>{m(quote?.total ?? estimate)}</span></button></div>
      )}

      {cfg && <ProductConfigurator product={cfg} groups={data.variantGroups} addons={data.addons} currency={cur} onClose={() => setCfg(null)} onAdd={(l) => { touch(); setCart((c) => [...c, l]); setCfg(null); }} />}

      <Modal open={open} onClose={() => setOpen(false)} drawer title="Your order" footer={<div className="w-full space-y-2">
        {err && <Notice tone="bad">{err}</Notice>}
        <Button className="w-full" size="lg" loading={busy} disabled={!cart.length || !quote || !!paused} onClick={placeOrder}>{r.settings.paymentTiming === "PAY_FIRST" ? "Place order & pay" : "Place order"}{quote ? ` · ${m(quote.total)}` : ""}</Button></div>}>
        <div className="space-y-5">
          {!cart.length ? <EmptyState title="Your cart is empty" text="Add something delicious." /> : (<>
            <ul className="space-y-3">
              {cart.map((l) => (
                <li key={l.key} className="rounded-xl bg-surface2 p-3 text-sm">
                  <div className="flex justify-between gap-2"><span className="font-medium">{l.name}</span><span className="tabular-nums">{m(l.unit * l.qty)}</span></div>
                  {l.extras && <p className="text-xs text-muted">{l.extras}</p>}{l.notes && <p className="text-xs text-warn">“{l.notes}”</p>}
                  <div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-1"><button aria-label={`Decrease ${l.name}`} onClick={() => setQty(l.key, -1)} className="grid size-9 place-items-center rounded-lg bg-bg"><Minus className="size-4" /></button><span className="w-8 text-center tabular-nums" aria-live="polite">{l.qty}</span><button aria-label={`Increase ${l.name}`} onClick={() => setQty(l.key, 1)} className="grid size-9 place-items-center rounded-lg bg-bg"><Plus className="size-4" /></button></div><button aria-label={`Remove ${l.name}`} onClick={() => setQty(l.key, -99)} className="text-muted hover:text-bad"><Trash2 className="size-4" /></button></div>
                </li>
              ))}
            </ul>
            <div>
              <label htmlFor="coupon" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><Tag className="size-3.5" />Coupon</label>
              {applied ? <div className="flex items-center justify-between rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm"><span className="text-ok">{applied} applied{quote ? ` · −${m(quote.discount)}` : ""}</span><button className="text-xs text-muted underline" onClick={() => { setApplied(""); setCoupon(""); touch(); }}>Remove</button></div> : (
                <div className="flex gap-2"><Input id="coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Enter code" /><Button variant="secondary" disabled={!coupon.trim()} onClick={() => { setApplied(coupon.trim()); setCouponErr(""); touch(); }}>Apply</Button></div>
              )}
              {couponErr && <p role="alert" className="mt-1 text-xs text-bad">{couponErr}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><Input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} autoComplete="name" /></Field>
              <Field label="Phone" hint="For loyalty rewards"><Input value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} inputMode="tel" autoComplete="tel" /></Field>
              <Field label="Email (for receipt, optional)" className="col-span-2"><Input type="email" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} autoComplete="email" /></Field>
              <Field label="Notes for the kitchen" className="col-span-2"><Textarea className="min-h-16" value={cust.notes} onChange={(e) => setCust({ ...cust, notes: e.target.value })} placeholder="Allergies, preferences…" /></Field>
            </div>
            {quoteErr && <Notice tone="bad">{quoteErr}</Notice>}
            {quote && (
              <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
                <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd>{m(quote.subtotal)}</dd></div>
                {quote.discount > 0 && <div className="flex justify-between text-ok"><dt>Discount</dt><dd>−{m(quote.discount)}</dd></div>}
                {quote.platformFee > 0 && <div className="flex justify-between text-muted"><dt>Platform fee</dt><dd>{m(quote.platformFee)}</dd></div>}
                {quote.tax > 0 && <div className="flex justify-between text-muted"><dt>{quote.taxLabel || "Tax"}</dt><dd>{m(quote.tax)}</dd></div>}
                <div className="flex justify-between text-lg font-semibold"><dt>Total</dt><dd>{m(quote.total)}</dd></div>
              </dl>
            )}
            {r.settings.geofence.enabled && <p className="text-xs text-muted">We’ll ask for your location once to confirm you’re at the restaurant. It isn’t stored.</p>}
            {r.settings.paymentTiming === "PAY_FIRST" && <p className="text-xs text-muted">This restaurant asks you to pay before the kitchen starts. You’ll see payment options after placing your order.</p>}
          </>)}
        </div>
      </Modal>
    </div>
  );
}
