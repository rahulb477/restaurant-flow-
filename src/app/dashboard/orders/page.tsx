"use client";
import { useState } from "react";
import { Eye, Receipt } from "lucide-react";
import Link from "next/link";
import { formatMoney } from "@/lib/calculations";
import { patch, useApi, useDebounced } from "@/lib/client/api";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, ListSkeleton, Modal, Notice, PageHeader, Pagination, SearchInput, StatusBadge, Tabs, Textarea, useToast, cx } from "@/components/ui";
import { ItemLines, Timeline, Totals, type OrderRow } from "@/components/order-ui";
import { UpiQr } from "@/components/upi";
import { RoleGate, useShell } from "@/components/shell";
import { can } from "@/lib/permissions";

const FILTERS = [["all", "All"], ["new", "New"], ["confirmed", "Confirmed"], ["preparing", "Preparing"], ["ready", "Ready"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["payment_pending", "Payment pending"]] as const;
type Filter = (typeof FILTERS)[number][0];
type Settings = { restaurant: { settings: { payments: { cash: boolean; upi: boolean; upiId: string; upiName: string } } } };

export default function Page() {
  return <RoleGate module="orders"><Orders /></RoleGate>;
}

function Orders() {
  const toast = useToast();
  const { restaurant, role } = useShell();
  const cur = restaurant.currency;
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [offset, setOffset] = useState(0);
  const limit = 24;
  const { data, error, loading, reload } = useApi<{ items: OrderRow[]; total: number }>(`/api/orders?status=${filter}&limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`, { poll: 5000 });
  const cfg = useApi<Settings>("/api/restaurant");
  const [view, setView] = useState<OrderRow | null>(null);
  const [pay, setPay] = useState<OrderRow | null>(null);
  const [cancel, setCancel] = useState<OrderRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  async function act(o: OrderRow, action: string, label: string) {
    setBusy(o.id + action);
    try { await patch(`/api/orders/${o.id}`, { action }); toast.success(`${o.displayId}: ${label}`); reload(); setView(null); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function collect(method: "CASH" | "UPI") {
    if (!pay) return;
    try { await patch(`/api/orders/${pay.id}`, { payment: { method } }); toast.success(`Payment recorded for ${pay.displayId}`); setPay(null); setView(null); reload(); } catch (e) { toast.error((e as Error).message); }
  }
  async function saveNotes() {
    if (!view) return;
    try { await patch(`/api/orders/${view.id}`, { staffNotes: notes }); toast.success("Notes saved"); reload(); } catch (e) { toast.error((e as Error).message); }
  }

  function actions(o: OrderRow) {
    const b = (action: string, label: string, v: "primary" | "secondary" | "danger" = "primary") => <Button key={action} size="sm" variant={v} loading={busy === o.id + action} onClick={() => (action === "cancel" ? setCancel(o) : act(o, action, label))}>{label}</Button>;
    const unpaid = o.paymentStatus !== "SUCCESS" && o.status !== "CANCELLED" && can(role, "orders");
    const list = [];
    if (o.status === "PLACED" || o.status === "PAYMENT_COMPLETED") list.push(b("confirm", "Confirm"));
    if (o.status === "CONFIRMED") list.push(b("start", "Start prep"));
    if (o.status === "PREPARING") list.push(b("ready", "Mark ready"));
    if (o.status === "READY") list.push(b("serve", "Serve"));
    if ((o.status === "READY" || o.status === "SERVED") && o.paymentStatus === "SUCCESS") list.push(b("complete", "Complete"));
    if (unpaid) list.push(<Button key="pay" size="sm" variant="secondary" onClick={() => setPay(o)}>Collect payment</Button>);
    if (["PLACED", "PAYMENT_PENDING", "PAYMENT_COMPLETED", "CONFIRMED", "PREPARING"].includes(o.status)) list.push(b("cancel", "Cancel", "danger"));
    return list;
  }

  const orders = data?.items ?? [];
  const p = cfg.data?.restaurant.settings.payments;
  return (
    <div>
      <PageHeader title="Orders" subtitle="Live orders from QR, POS and staff. Updates automatically." />
      <Tabs tabs={FILTERS.map(([id, label]) => ({ id, label }))} value={filter} onChange={(f) => { setFilter(f); setOffset(0); }} />
      <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder="Search order ID, table, customer…" className="mb-5 max-w-md" />
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <ListSkeleton /> : !orders.length ? <EmptyState title="No orders here" text={q ? "No orders match your search." : "New orders will appear here as they come in."} /> : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {orders.map((o) => (
              <Card key={o.id} className="anim-pop flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold">{o.displayId}</p><p className="text-xs text-muted">{o.tableName ? `Table ${o.tableName}` : "No table"} · {o.source} · {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>
                  <div className="flex flex-col items-end gap-1"><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} /></div>
                </div>
                <ul className="my-3 flex-1 space-y-0.5 text-sm text-muted">{o.items.slice(0, 3).map((l) => <li key={l.lineId} className="truncate">{l.qty}× {l.name}</li>)}{o.items.length > 3 && <li>+{o.items.length - 3} more</li>}</ul>
                <div className="mb-3 flex items-center justify-between"><span className="text-sm text-muted">{o.customerName || o.customerPhone || ""}</span><span className="font-semibold tabular-nums">{formatMoney(o.total, cur)}</span></div>
                <div className="flex flex-wrap gap-1.5">{actions(o)}<Button size="sm" variant="ghost" onClick={() => { setView(o); setNotes(o.staffNotes ?? ""); }}><Eye className="size-4" />View</Button></div>
              </Card>
            ))}
          </div>
          <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}

      <Modal open={!!view} onClose={() => setView(null)} wide title={view ? `Order ${view.displayId}` : ""}>
        {view && (
          <div className="space-y-5">
            <Timeline status={view.status} />
            <div className="flex flex-wrap gap-2 text-sm"><StatusBadge status={view.status} /><StatusBadge status={view.paymentStatus} />{view.paymentMethod && <span className="text-muted">via {view.paymentMethod}</span>}<span className="text-muted">{view.tableName ? `Table ${view.tableName}` : "No table"} · {view.source}</span></div>
            <ItemLines items={view.items} currency={cur} />
            <Totals o={view} currency={cur} />
            {(view.customerName || view.customerPhone || view.customerEmail) && <p className="text-sm text-muted">Customer: {[view.customerName, view.customerPhone, view.customerEmail].filter(Boolean).join(" · ")}</p>}
            {view.customerNotes && <Notice tone="warn">Customer note: {view.customerNotes}</Notice>}
            <div><label className="mb-1 block text-xs text-muted" htmlFor="sn">Staff notes</label><Textarea id="sn" value={notes} onChange={(e) => setNotes(e.target.value)} /><Button size="sm" variant="secondary" className="mt-2" onClick={saveNotes}>Save notes</Button></div>
            <div className="flex flex-wrap gap-2">{actions(view)}{view.paymentStatus === "SUCCESS" && <Link href={`/dashboard/bills/${view.id}`} className={cx("inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs hover:bg-surface2")}><Receipt className="size-3.5" />Bill</Link>}</div>
          </div>
        )}
      </Modal>

      <Modal open={!!pay} onClose={() => setPay(null)} title={pay ? `Collect payment · ${pay.displayId}` : ""}>
        {pay && (
          <div className="space-y-5">
            <p className="text-center text-3xl font-semibold tabular-nums">{formatMoney(pay.total, cur)}</p>
            {p?.cash && <Button className="w-full" size="lg" onClick={() => collect("CASH")}>Cash received</Button>}
            {p?.upi && p.upiId ? (
              <div className="rounded-xl border border-line p-4"><UpiQr upiId={p.upiId} name={p.upiName || restaurant.name} amountMinor={pay.total} orderRef={pay.displayId} currency={cur} size={170} />
                <Button className="mt-4 w-full" variant="secondary" onClick={() => collect("UPI")}>UPI payment received</Button><p className="mt-2 text-center text-[11px] text-muted">Only confirm after you see the money in your account.</p></div>
            ) : p?.upi ? <Notice tone="warn">UPI is enabled but no UPI ID is set. Add it in Settings → Payments.</Notice> : null}
            {!p?.cash && !p?.upi && <Notice tone="warn">No payment methods are enabled. Enable them in Settings → Payments.</Notice>}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!cancel} onClose={() => setCancel(null)} danger title="Cancel this order?" confirmLabel="Cancel order" message={cancel?.paymentStatus === "SUCCESS" ? "This order is already paid. It will be marked refunded — you must return the money to the customer yourself." : "The order will be cancelled and its usage fee voided."} onConfirm={async () => { if (cancel) { await act(cancel, "cancel", "cancelled"); setCancel(null); } }} />
    </div>
  );
}
