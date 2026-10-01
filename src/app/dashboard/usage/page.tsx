"use client";
import { useState } from "react";
import { AlertTriangle, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/calculations";
import { post, useApi } from "@/lib/client/api";
import { Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, Notice, PageHeader, StatCard, StatusBadge, useToast } from "@/components/ui";
import { UpiQr } from "@/components/upi";
import { RoleGate } from "@/components/shell";

type Data = {
  summary: { balance: number; orders: number; feePerOrder: number; threshold: number; mode: string; blockOnThreshold: boolean; pendingSettlement: number; overThreshold: boolean; currency: string };
  ledger: { id: string; orderDisplayId: string; amount: number; mode: string; status: string; createdAt: string }[];
  settlements: { id: string; amount: number; orderCount: number; status: string; reference: string; createdAt: string }[];
  payee: { upiId: string } | null;
};

export default function Page() {
  return <RoleGate module="usage"><Usage /></RoleGate>;
}

function Usage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Data>("/api/dash/usage", { poll: 20000 });
  const [confirm, setConfirm] = useState(false);
  const [pay, setPay] = useState<Data["settlements"][number] | null>(null);
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <ListSkeleton />;
  const s = data.summary;
  const m = (n: number) => formatMoney(n, s.currency);
  const pct = Math.min(100, Math.round((s.balance / Math.max(1, s.threshold)) * 100));
  async function submitRef() {
    if (!pay) return;
    setErr("");
    try { await post("/api/dash/usage-submit", { settlementId: pay.id, reference: ref }); toast.success("Payment reference submitted"); setPay(null); setRef(""); reload(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div>
      <PageHeader title="Usage" subtitle="A small fee is recorded for each eligible customer QR order. Every charge is linked to its order." actions={<Button disabled={s.balance <= 0} onClick={() => setConfirm(true)}><Wallet className="size-4" />Settle {m(s.balance)}</Button>} />
      {s.overThreshold && <div className="mb-5"><Notice tone="warn"><span className="flex items-center gap-2"><AlertTriangle className="size-4" />Your balance has reached the settlement threshold.{s.blockOnThreshold ? " New customer QR orders are blocked until you settle." : " Please settle soon."}</span></Notice></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Current balance" value={m(s.balance)} tone={s.overThreshold ? "warn" : undefined} /><StatCard label="Orders counted" value={s.orders} /><StatCard label="Fee per order" value={m(s.feePerOrder)} hint={s.mode === "CUSTOMER_BASED" ? "Paid by customer" : "Paid by store"} /><StatCard label="Settlement threshold" value={m(s.threshold)} /><StatCard label="Awaiting confirmation" value={m(s.pendingSettlement)} />
      </div>
      <Card className="mt-4 p-4"><div className="mb-2 flex justify-between text-xs text-muted"><span>Balance vs threshold</span><span>{pct}%</span></div><div className="h-2 overflow-hidden rounded-full bg-surface2"><div className={`h-full rounded-full ${s.overThreshold ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div></Card>

      <h2 className="mb-3 mt-8 font-semibold">Settlements</h2>
      {!data.settlements.length ? <EmptyState title="No settlements yet" text="When you settle your balance, the record and its status appear here." /> : (
        <DataTable columns={[
          { key: "createdAt", label: "Created", render: (r) => new Date(r.createdAt).toLocaleString() }, { key: "orderCount", label: "Orders" }, { key: "amount", label: "Amount", render: (r) => m(r.amount) },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> }, { key: "reference", label: "Reference", render: (r) => r.reference || "—" },
        ]} rows={data.settlements} actions={(r) => (r.status === "PENDING" || r.status === "FAILED") ? <Button size="sm" variant="secondary" onClick={() => { setPay(r); setRef(""); setErr(""); }}>Pay</Button> : null} />
      )}

      <h2 className="mb-3 mt-8 font-semibold">Usage history</h2>
      {!data.ledger.length ? <EmptyState title="No usage recorded" text="Fees appear here when customers place QR orders." /> : (
        <DataTable columns={[
          { key: "createdAt", label: "Date", render: (r) => new Date(r.createdAt).toLocaleString() }, { key: "orderDisplayId", label: "Order", render: (r) => <span className="font-medium">{r.orderDisplayId}</span> },
          { key: "mode", label: "Mode", render: (r) => (r.mode === "CUSTOMER_BASED" ? "Customer" : "Store") }, { key: "amount", label: "Fee", render: (r) => m(r.amount) },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status === "CHARGED" ? "PENDING" : r.status === "SETTLED" ? "PAID" : "CANCELLED"} /> },
        ]} rows={data.ledger} />
      )}

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Create settlement?" confirmLabel="Create settlement" message={`This bundles ${s.orders} order fee(s) totalling ${m(s.balance)} into a settlement you can pay.`} onConfirm={async () => { try { await post("/api/dash/usage-settle"); toast.success("Settlement created"); reload(); } catch (e) { toast.error((e as Error).message); } setConfirm(false); }} />
      <Modal open={!!pay} onClose={() => setPay(null)} title="Pay settlement" footer={<><Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button><Button onClick={submitRef}>Submit reference</Button></>}>
        {pay && <div className="space-y-4">
          <p className="text-center text-2xl font-semibold">{m(pay.amount)}</p>
          {data.payee ? <UpiQr upiId={data.payee.upiId} name="Platform settlement" amountMinor={pay.amount} orderRef={`SET-${pay.id.slice(0, 6)}`} currency={s.currency} size={170} /> : <Notice tone="warn">The platform’s payment details aren’t configured yet. Contact support to pay this settlement.</Notice>}
          {err && <Notice tone="bad">{err}</Notice>}
          <Field label="Payment reference / UTR" hint="The platform confirms receipt before the settlement shows as Paid."><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>}
      </Modal>
    </div>
  );
}
