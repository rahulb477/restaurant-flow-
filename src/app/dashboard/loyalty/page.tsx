"use client";
import { useEffect, useState } from "react";
import { put, useApi } from "@/lib/client/api";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Input, ListSkeleton, Notice, PageHeader, PriceDisplay, Toggle, useToast } from "@/components/ui";
import { RoleGate, useShell } from "@/components/shell";

type Data = { program: { requiredVisits: number; rewardTitle: string; rewardItem: string; isActive: boolean }; customers: { id: string; name: string; phone: string; email: string; visits: number; orders: number; totalSpend: number; lastOrderAt: string | null; unlocked: number; claimed: number }[] };

export default function Page() {
  return <RoleGate module="loyalty"><Loyalty /></RoleGate>;
}

function Loyalty() {
  const toast = useToast();
  const { restaurant } = useShell();
  const { data, error, loading, reload } = useApi<Data>("/api/dash/loyalty");
  const [f, setF] = useState({ requiredVisits: 5, rewardTitle: "", rewardItem: "", isActive: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (data) Promise.resolve().then(() => setF({ requiredVisits: data.program.requiredVisits, rewardTitle: data.program.rewardTitle, rewardItem: data.program.rewardItem, isActive: data.program.isActive })); }, [data]);
  async function save() {
    setErr(""); setBusy(true);
    try { await put("/api/dash/loyalty", f); toast.success("Loyalty program saved"); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <ListSkeleton />;
  return (
    <div>
      <PageHeader title="Loyalty" subtitle="Reward regulars. Visits are counted when a customer’s order (identified by phone or email) is completed." />
      <Card className="mb-6 max-w-2xl p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Program</h2><div className="flex items-center gap-2 text-sm text-muted">{f.isActive ? "Active" : "Inactive"}<Toggle checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Loyalty active" /></div></div>
        {err && <div className="mb-3"><Notice tone="bad">{err}</Notice></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Visits required"><Input type="number" min={1} max={100} value={f.requiredVisits} onChange={(e) => setF({ ...f, requiredVisits: Number(e.target.value) })} /></Field>
          <Field label="Reward"><Input value={f.rewardTitle} onChange={(e) => setF({ ...f, rewardTitle: e.target.value })} placeholder="Free coffee" /></Field>
          <Field label="Reward item (optional)"><Input value={f.rewardItem} onChange={(e) => setF({ ...f, rewardItem: e.target.value })} /></Field>
        </div>
        <p className="mt-3 text-xs text-muted">Example: {f.requiredVisits} visits → {f.rewardTitle || "reward"}. Each milestone unlocks one reward that can be claimed once.</p>
        <Button className="mt-4" loading={busy} onClick={save}>Save program</Button>
      </Card>
      <h2 className="mb-3 font-semibold">Customers</h2>
      {!data.customers.length ? <EmptyState title="No customers yet" text="Customers appear when orders include a phone number or email." /> : (
        <DataTable columns={[
          { key: "name", label: "Customer", render: (c) => <div><p className="font-medium">{c.name || "Guest"}</p><p className="text-xs text-muted">{c.phone || c.email}</p></div> },
          { key: "visits", label: "Visits", render: (c) => `${c.visits % data.program.requiredVisits === 0 && c.visits > 0 ? data.program.requiredVisits : c.visits % data.program.requiredVisits} / ${data.program.requiredVisits}` },
          { key: "orders", label: "Orders" },
          { key: "totalSpend", label: "Total spend", render: (c) => <PriceDisplay minor={c.totalSpend} currency={restaurant.currency} /> },
          { key: "unlocked", label: "Rewards", render: (c) => `${c.unlocked} unlocked · ${c.claimed} claimed` },
          { key: "lastOrderAt", label: "Last order", render: (c) => (c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : "—") },
        ]} rows={data.customers} />
      )}
    </div>
  );
}
