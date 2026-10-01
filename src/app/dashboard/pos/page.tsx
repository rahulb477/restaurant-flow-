"use client";
import { useMemo, useState } from "react";
import { Banknote, CheckCircle2, Minus, Plus, QrCode, ShoppingBag, Trash2, PenLine } from "lucide-react";
import { formatMoney, toMinor } from "@/lib/calculations";
import { post, patch, useApi } from "@/lib/client/api";
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, Notice, SearchInput, Select, Skeleton, Textarea, cx, useToast } from "@/components/ui";
import { ProductConfigurator, type CartLine, type CGroup, type CAddon, type CProduct } from "@/components/configurator";
import { UpiQr } from "@/components/upi";
import { RoleGate } from "@/components/shell";

type Data = {
  categories: { id: string; name: string }[];
  products: (CProduct & { availability: string; isPopular: boolean })[];
  variantGroups: CGroup[];
  addons: CAddon[];
  tables: { id: string; name: string; status: string }[];
  settings: { payments: { cash: boolean; upi: boolean; upiId: string; upiName: string }; tax: { enabled: boolean; name: string; ratePct: number; mode: string } };
  currency: string;
};

export default function Page() {
  return <RoleGate module="pos"><POS /></RoleGate>;
}

function POS() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Data>("/api/dash/pos-data");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cfg, setCfg] = useState<CProduct | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState({ name: "", price: "", qty: 1, notes: "" });
  const [customErr, setCustomErr] = useState("");
  const [f, setF] = useState({ tableId: "", name: "", phone: "", email: "", notes: "", coupon: "", discount: "", pay: "LATER" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<{ id: string; displayId: string; total: number; upi: boolean; paid: boolean } | null>(null);
  const cur = data?.currency ?? "INR";

  const products = useMemo(() => (data?.products ?? []).filter((p) => (cat === "all" || p.categoryId === cat) && p.name.toLowerCase().includes(q.toLowerCase())), [data, cat, q]);
  const subtotal = cart.reduce((s, l) => s + l.unit * l.qty, 0);
  const discount = Math.min(toMinor(Number(f.discount) || 0), subtotal);
  const tax = data?.settings.tax;
  const taxable = subtotal - discount;
  const taxAmt = tax?.enabled ? (tax.mode === "EXCLUSIVE" ? Math.round((taxable * tax.ratePct) / 100) : 0) : 0;

  function addProduct(p: CProduct & { availability: string }) {
    if (p.availability !== "AVAILABLE") return toast.error(`${p.name} is ${p.availability.toLowerCase().replace(/_/g, " ")}`);
    if (p.variantGroupIds.length || p.addonIds.length) return setCfg(p);
    setCart((c) => {
      const ex = c.find((l) => l.productId === p.id && !l.notes && !l.extras);
      return ex ? c.map((l) => (l === ex ? { ...l, qty: Math.min(99, l.qty + 1) } : l)) : [...c, { key: crypto.randomUUID(), productId: p.id, name: p.name, qty: 1, unit: p.price, variants: {}, addonIds: [], notes: "", extras: "" }];
    });
  }
  function addCustom() {
    const price = toMinor(Number(custom.price));
    if (!custom.name.trim()) return setCustomErr("Enter an item name.");
    if (!(Number(custom.price) >= 0) || custom.price === "") return setCustomErr("Enter a valid price.");
    setCart((c) => [...c, { key: crypto.randomUUID(), custom: { name: custom.name.trim(), price }, name: custom.name.trim(), qty: Math.max(1, custom.qty), unit: price, variants: {}, addonIds: [], notes: custom.notes, extras: "Custom item" }]);
    setCustom({ name: "", price: "", qty: 1, notes: "" }); setCustomErr(""); setCustomOpen(false);
  }
  const setQty = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(99, l.qty + d)) } : l)));

  async function submit() {
    setErr("");
    if (!cart.length) return setErr("Add at least one item.");
    setBusy(true);
    try {
      const body = {
        items: cart.map((l) => ({ productId: l.productId, custom: l.custom, qty: l.qty, variants: l.variants, addonIds: l.addonIds, notes: l.notes })),
        tableId: f.tableId || null, couponCode: f.coupon || undefined, customer: { name: f.name, phone: f.phone, email: f.email }, notes: f.notes,
        manualDiscount: discount || undefined, payment: f.pay === "CASH" ? { method: "CASH" } : null, idempotencyKey: idem,
      };
      const r = await post<{ order: { id: string; displayId: string; total: number } }>("/api/orders", body);
      setDone({ id: r.order.id, displayId: r.order.displayId, total: r.order.total, upi: f.pay === "UPI", paid: f.pay === "CASH" });
      setCart([]); setF({ tableId: "", name: "", phone: "", email: "", notes: "", coupon: "", discount: "", pay: "LATER" }); setIdem(crypto.randomUUID()); reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function confirmUpi() {
    if (!done) return;
    try { await patch(`/api/orders/${done.id}`, { payment: { method: "UPI" } }); toast.success("UPI payment recorded"); setDone({ ...done, upi: false, paid: true }); } catch (e) { toast.error((e as Error).message); }
  }

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <div className="grid gap-4 lg:grid-cols-[1fr_380px]"><Skeleton className="h-[70vh]" /><Skeleton className="h-[70vh]" /></div>;
  const pay = data.settings.payments;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_390px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search products…" className="w-full sm:w-64" />
          <Button variant="secondary" onClick={() => setCustomOpen(true)}><PenLine className="size-4" />Custom item</Button>
        </div>
        <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto" role="tablist" aria-label="Categories">
          {[{ id: "all", name: "All" }, ...data.categories].map((c) => <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)} className={cx("shrink-0 rounded-full px-4 py-2 text-sm transition", cat === c.id ? "bg-accent font-semibold text-accent-fg" : "bg-surface2 text-muted hover:text-white")}>{c.name}</button>)}
        </div>
        {!data.products.length ? <EmptyState title="No products yet" text="Add products in the Menu section to start selling." /> : !products.length ? <EmptyState title="No matching products" /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => {
              const off = p.availability !== "AVAILABLE";
              return (
                <button key={p.id} onClick={() => addProduct(p)} aria-disabled={off} className={cx("group overflow-hidden rounded-2xl border border-line bg-surface text-left transition hover:border-accent/60 active:scale-[0.98]", off && "opacity-50")}>
                  <div className="aspect-[4/3] bg-surface2">{p.imageUrl ?   <img src={p.imageUrl} alt="" loading="lazy" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-3xl">☕</div>}</div>
                  <div className="p-3"><p className="truncate text-sm font-medium">{p.name}</p><div className="mt-1 flex items-center justify-between"><span className="text-sm text-accent">{formatMoney(p.price, cur)}</span>{off ? <span className="text-[10px] text-bad">{p.availability.replace(/_/g, " ").toLowerCase()}</span> : (p.variantGroupIds.length > 0 || p.addonIds.length > 0) && <span className="text-[10px] text-muted">customise</span>}</div></div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Card className="h-fit p-4 lg:sticky lg:top-20">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><ShoppingBag className="size-4 text-accent" />Current order</h2>
        {!cart.length ? <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-muted">Tap products to add them.</p> : (
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {cart.map((l) => (
              <li key={l.key} className="rounded-xl bg-surface2 p-3 text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium">{l.name}</span><span className="tabular-nums">{formatMoney(l.unit * l.qty, cur)}</span></div>
                {l.extras && <p className="text-xs text-muted">{l.extras}</p>}{l.notes && <p className="text-xs text-warn">“{l.notes}”</p>}
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1"><button aria-label="Decrease" onClick={() => setQty(l.key, -1)} className="grid size-8 place-items-center rounded-md bg-bg"><Minus className="size-3.5" /></button><span className="w-7 text-center tabular-nums">{l.qty}</span><button aria-label="Increase" onClick={() => setQty(l.key, 1)} className="grid size-8 place-items-center rounded-md bg-bg"><Plus className="size-3.5" /></button></div>
                  <button aria-label={`Remove ${l.name}`} onClick={() => setCart(cart.filter((x) => x.key !== l.key))} className="text-muted hover:text-bad"><Trash2 className="size-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Field label="Table" className="col-span-2"><Select value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })}><option value="">Takeaway / no table</option>{data.tables.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.status.toLowerCase()}</option>)}</Select></Field>
          <Field label="Customer"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="For loyalty" inputMode="tel" /></Field>
          <Field label="Coupon"><Input value={f.coupon} onChange={(e) => setF({ ...f, coupon: e.target.value.toUpperCase() })} placeholder="CODE" /></Field>
          <Field label="Discount"><Input type="number" min={0} step="0.01" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} placeholder="0" /></Field>
          <Field label="Order notes" className="col-span-2"><Textarea className="min-h-14" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Kitchen notes" /></Field>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment">
          {[["LATER", "Pay later", null], ["CASH", "Cash", pay.cash], ["UPI", "UPI QR", pay.upi && !!pay.upiId]].map(([v, l, en]) => (
            <button key={v as string} role="radio" aria-checked={f.pay === v} disabled={en === false} onClick={() => setF({ ...f, pay: v as string })} className={cx("rounded-lg border px-2 py-2 text-xs transition disabled:opacity-40", f.pay === v ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>{l as string}</button>
          ))}
        </div>
        <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(subtotal, cur)}</dd></div>
          {discount > 0 && <div className="flex justify-between text-muted"><dt>Discount</dt><dd>-{formatMoney(discount, cur)}</dd></div>}
          {tax?.enabled && <div className="flex justify-between text-muted"><dt>{tax.name} {tax.ratePct}%{tax.mode === "INCLUSIVE" ? " (incl.)" : ""}</dt><dd>{tax.mode === "EXCLUSIVE" ? formatMoney(taxAmt, cur) : "included"}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(taxable + taxAmt, cur)}</dd></div>
        </dl>
        <p className="mt-1 text-[11px] text-muted">Final amount (incl. coupon) is calculated securely when the order is created.</p>
        {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
        <Button className="mt-3 w-full" size="lg" loading={busy} disabled={!cart.length} onClick={submit}>Create order</Button>
      </Card>

      {cfg && <ProductConfigurator product={cfg} groups={data.variantGroups} addons={data.addons} currency={cur} onClose={() => setCfg(null)} onAdd={(l) => { setCart((c) => [...c, l]); setCfg(null); }} />}

      <Modal open={customOpen} onClose={() => setCustomOpen(false)} title="Add custom item" footer={<><Button variant="ghost" onClick={() => setCustomOpen(false)}>Cancel</Button><Button onClick={addCustom}>Add to order</Button></>}>
        <div className="space-y-4">
          {customErr && <Notice tone="bad">{customErr}</Notice>}
          <Field label="Item name"><Input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="e.g. Birthday cake slice" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Price"><Input type="number" min={0} step="0.01" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} /></Field><Field label="Quantity"><Input type="number" min={1} max={99} value={custom.qty} onChange={(e) => setCustom({ ...custom, qty: Number(e.target.value) })} /></Field></div>
          <Field label="Notes"><Textarea value={custom.notes} onChange={(e) => setCustom({ ...custom, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={!!done} onClose={() => setDone(null)} title="Order created" footer={<Button onClick={() => setDone(null)}>Done</Button>}>
        {done && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-10 text-ok" />
            <p className="text-lg font-semibold">{done.displayId}</p>
            {done.paid && <p className="flex items-center justify-center gap-2 text-sm text-ok"><Banknote className="size-4" />Cash payment recorded</p>}
            {done.upi && pay.upiId && (<>
              <UpiQr upiId={pay.upiId} name={pay.upiName || "Merchant"} amountMinor={done.total} orderRef={done.displayId} currency={cur} />
              <p className="flex items-center justify-center gap-1 text-xs text-muted"><QrCode className="size-3.5" />Scanning does not confirm payment. Confirm once the money arrives.</p>
              <Button variant="secondary" onClick={confirmUpi}>Payment received</Button>
            </>)}
            {!done.upi && !done.paid && <p className="text-sm text-muted">Payment can be collected from the Orders page.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
