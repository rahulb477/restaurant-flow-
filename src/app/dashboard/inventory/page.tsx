"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { post, put, useApi } from "@/lib/client/api";
import { Badge, Button, DataTable, EmptyState, Field, Input, ListSkeleton, Modal, Notice, PageHeader, PriceDisplay, Select, Tabs, Textarea, useToast } from "@/components/ui";
import { CrudManager, type Row } from "@/components/crud";
import { RoleGate, useShell } from "@/components/shell";

const TABS = [["stock", "Ingredients"], ["recipes", "Recipes"], ["history", "History"]] as const;
type Tab = (typeof TABS)[number][0];

export default function Page() {
  return <RoleGate module="inventory"><Suspense fallback={null}><Inventory /></Suspense></RoleGate>;
}

function Inventory() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS.find((t) => t[0] === sp.get("tab"))?.[0] ?? "stock") as Tab;
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Track ingredients, map recipes and let stock deduct automatically — exactly once per order." />
      <Tabs tabs={TABS.map(([id, label]) => ({ id, label }))} value={tab} onChange={(t) => router.replace(`/dashboard/inventory?tab=${t}`)} />
      {tab === "stock" && <Stock />}
      {tab === "recipes" && <Recipes />}
      {tab === "history" && <History />}
    </div>
  );
}

function Stock() {
  const { restaurant } = useShell();
  const toast = useToast();
  const [adj, setAdj] = useState<Row | null>(null);
  const [f, setF] = useState({ mode: "ADD", quantity: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  async function submit(reload: () => void) {
    if (!adj) return;
    setErr(""); setBusy(true);
    try { await post("/api/dash/inventory-adjust", { ingredientId: adj.id, mode: f.mode, quantity: Number(f.quantity), note: f.note }); toast.success("Stock updated"); setAdj(null); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  let reloadRef: () => void = () => {};
  return (
    <>
      <div className="mb-4 flex gap-2 no-print">{[["all", "All"], ["low", "Low stock"]].map(([v, l]) => <Button key={v} size="sm" variant={filter === v ? "primary" : "secondary"} onClick={() => setFilter(v)}>{l}</Button>)}</div>
      <CrudManager key={filter} resource="ingredients" singular="Ingredient" plural="Ingredients" softDelete
        fields={[{ key: "name", label: "Name", type: "text", required: true }, { key: "unit", label: "Unit", type: "text", placeholder: "g, ml, pcs", required: true }, { key: "currentStock", label: "Opening stock", type: "number", step: 0.01, createOnly: true }, { key: "lowStockThreshold", label: "Low-stock threshold", type: "number", step: 0.01 }, { key: "costPerUnit", label: `Cost per unit (${restaurant.currency})`, type: "money" }, { key: "isActive", label: "Active", type: "boolean", editOnly: true }]}
        defaults={{ name: "", unit: "g", currentStock: 0, lowStockThreshold: 0, costPerUnit: 0, isActive: true }} emptyText="Add ingredients like Milk or Coffee Powder, then map them to recipes."
        deleteMessage={(r) => `“${r.name}” will be deactivated (its history is kept).`}
        columns={[
          { key: "name", label: "Ingredient", render: (r) => <span className="flex items-center gap-2 font-medium">{r.name}{!r.isActive && <Badge>inactive</Badge>}</span> },
          { key: "currentStock", label: "In stock", render: (r) => { const low = r.isActive && r.currentStock <= r.lowStockThreshold; return <span className={low ? "flex items-center gap-1.5 text-bad" : ""}>{low && <AlertTriangle className="size-3.5" />}<span className="tabular-nums">{+r.currentStock.toFixed(2)} {r.unit}</span>{low && <span className="text-xs">low</span>}</span>; } },
          { key: "lowStockThreshold", label: "Threshold", render: (r) => `${r.lowStockThreshold} ${r.unit}` },
          { key: "costPerUnit", label: "Cost/unit", render: (r) => <PriceDisplay minor={r.costPerUnit} currency={restaurant.currency} /> },
        ]}
        extraActions={(r, reload) => { reloadRef = reload; return <Button size="sm" variant="secondary" onClick={() => { setAdj(r); setF({ mode: "ADD", quantity: "", note: "" }); setErr(""); }}><SlidersHorizontal className="size-3.5" />Adjust</Button>; }}
      />
      <Modal open={!!adj} onClose={() => setAdj(null)} title={adj ? `Adjust ${adj.name}` : ""} footer={<><Button variant="ghost" onClick={() => setAdj(null)}>Cancel</Button><Button loading={busy} onClick={() => submit(() => reloadRef())}>Apply</Button></>}>
        {adj && <div className="space-y-4">
          <p className="text-sm text-muted">Current stock: <b className="text-white">{adj.currentStock} {adj.unit}</b></p>
          {err && <Notice tone="bad">{err}</Notice>}
          <Field label="Action"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="ADD">Add stock (restock)</option><option value="REMOVE">Remove stock</option><option value="WASTE">Record waste</option><option value="SET">Set exact amount</option></Select></Field>
          <Field label={`Quantity (${adj.unit})`}><Input type="number" min={0} step="any" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Optional" /></Field>
        </div>}
      </Modal>
    </>
  );
}

function Recipes() {
  const toast = useToast();
  const prods = useApi<{ items: Row[] }>("/api/r/products?limit=500");
  const ings = useApi<{ items: Row[] }>("/api/r/ingredients?limit=500");
  const rec = useApi<{ recipes: { productId: string; items: { ingredientId: string; quantity: number }[]; notes: string }[] }>("/api/dash/recipes");
  const [pid, setPid] = useState("");
  const [items, setItems] = useState<{ ingredientId: string; quantity: number | string }[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!pid || !rec.data) return;
    const r = rec.data.recipes.find((x) => x.productId === pid);
    Promise.resolve().then(() => { setItems(r?.items ?? []); setNotes(r?.notes ?? ""); setErr(""); });
  }, [pid, rec.data]);
  if (prods.loading || ings.loading) return <ListSkeleton rows={3} />;
  if (!prods.data?.items.length || !ings.data?.items.length) return <EmptyState title="Add products and ingredients first" text="Recipes connect a product to the ingredients it consumes." />;
  const active = ings.data.items.filter((i) => i.isActive);
  async function save() {
    setErr("");
    const clean = items.filter((i) => i.ingredientId && Number(i.quantity) > 0).map((i) => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity) }));
    if (new Set(clean.map((c) => c.ingredientId)).size !== clean.length) return setErr("Each ingredient can only appear once.");
    setBusy(true);
    try { await put("/api/dash/recipes", { productId: pid, items: clean, notes }); toast.success("Recipe saved"); rec.reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="max-w-2xl space-y-4">
      <Field label="Product"><Select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Select a product…</option>{prods.data.items.map((p) => <option key={p.id} value={p.id}>{p.name}{rec.data?.recipes.some((r) => r.productId === p.id) ? " ✓" : ""}</option>)}</Select></Field>
      {pid && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-5">
          {err && <Notice tone="bad">{err}</Notice>}
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select aria-label="Ingredient" value={it.ingredientId} onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, ingredientId: e.target.value } : x)))}><option value="">Ingredient…</option>{active.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}</Select>
              <Input aria-label="Quantity" type="number" step="any" min={0} className="w-32" placeholder="Qty" value={it.quantity} onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} />
              <button aria-label="Remove" className="text-muted hover:text-bad" onClick={() => setItems(items.filter((_, x) => x !== i))}><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setItems([...items, { ingredientId: "", quantity: "" }])}><Plus className="size-3.5" />Add ingredient</Button>
          <Field label="Preparation notes (shown to the kitchen)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Button loading={busy} onClick={save}>Save recipe</Button>
        </div>
      )}
    </div>
  );
}

function History() {
  const { data, loading, error } = useApi<{ items: Row[] }>("/api/dash/inventory-tx?limit=100", { poll: 15000 });
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <Notice tone="bad">{error}</Notice>;
  if (!data?.items.length) return <EmptyState title="No stock movements yet" text="Restocks, adjustments and automatic deductions are recorded here." />;
  return <DataTable columns={[
    { key: "createdAt", label: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: "ingredient", label: "Ingredient" },
    { key: "type", label: "Type", render: (r) => <Badge>{String(r.type).replace("_", " ").toLowerCase()}</Badge> },
    { key: "quantityUsed", label: "Change", render: (r) => <span className={r.quantityUsed > 0 ? "text-bad" : "text-ok"}>{r.quantityUsed > 0 ? "−" : "+"}{Math.abs(+r.quantityUsed.toFixed(2))} {r.unit}</span> },
    { key: "quantityAfter", label: "Before → after", render: (r) => `${+r.quantityBefore.toFixed(2)} → ${+r.quantityAfter.toFixed(2)}` },
    { key: "note", label: "Note" },
  ]} rows={data.items} />;
}
