"use client";
import { useEffect, useState } from "react";
import { BookOpen, Flame, Check, Play } from "lucide-react";
import { patch, useApi } from "@/lib/client/api";
import { Button, EmptyState, ErrorState, Modal, Skeleton, useToast, cx } from "@/components/ui";
import { ItemLines, type OrderRow } from "@/components/order-ui";
import { RoleGate } from "@/components/shell";

type Recipes = { recipes: { productId: string; items: { ingredientId: string; quantity: number }[]; notes: string }[]; ingredients: { id: string; name: string; unit: string }[] };
const COLS = [["NEW", "New", ["CONFIRMED"]], ["PREP", "Preparing", ["PREPARING"]], ["READY", "Ready", ["READY"]], ["DONE", "Completed", ["SERVED", "COMPLETED"]]] as const;

export default function Page() {
  return <RoleGate module="kds"><KDS /></RoleGate>;
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => new Date(since).getTime());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 20000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  return <span className={cx("tabular-nums", mins >= 15 ? "text-bad" : mins >= 8 ? "text-warn" : "text-muted")}>{mins}m</span>;
}

function KDS() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ items: OrderRow[] }>("/api/orders?board=1&limit=100", { poll: 3000 });
  const rec = useApi<Recipes>("/api/dash/recipes");
  const [busy, setBusy] = useState<string | null>(null);
  const [recipeFor, setRecipeFor] = useState<OrderRow | null>(null);

  async function act(o: OrderRow, action: string) {
    setBusy(o.id);
    try { await patch(`/api/orders/${o.id}`, { action }); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <div className="grid gap-3 md:grid-cols-4">{COLS.map((c) => <Skeleton key={c[0]} className="h-96" />)}</div>;
  const orders = data?.items ?? [];
  const nameOf = (id: string) => rec.data?.ingredients.find((i) => i.id === id);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><h1 className="font-display text-2xl font-semibold">Kitchen display</h1><span className="flex items-center gap-2 text-xs text-muted"><span className="size-2 animate-pulse rounded-full bg-ok" />Live</span></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLS.map(([key, label, statuses]) => {
          const list = orders.filter((o) => (statuses as readonly string[]).includes(o.status)).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
          return (
            <section key={key} aria-label={label} className="rounded-2xl bg-surface p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold uppercase tracking-wide text-muted">{label}<span className="grid min-w-6 place-items-center rounded-full bg-surface2 px-2 py-0.5 text-xs text-white">{list.length}</span></h2>
              <div className="space-y-3">
                {!list.length && <p className="py-10 text-center text-sm text-muted/60">Nothing here</p>}
                {list.map((o) => (
                  <article key={o.id} className={cx("anim-pop rounded-xl border-2 bg-surface2 p-3.5", key === "NEW" ? "border-info/50" : key === "PREP" ? "border-warn/60" : key === "READY" ? "border-ok/60" : "border-line opacity-70")}>
                    <header className="mb-2 flex items-center justify-between"><div><p className="text-lg font-bold">{o.displayId}</p><p className="text-sm text-muted">{o.tableName ? `Table ${o.tableName}` : o.source}</p></div><div className="flex items-center gap-1 text-sm"><Flame className="size-4 text-accent" /><Elapsed since={o.createdAt} /></div></header>
                    <ItemLines items={o.items} currency="INR" showPrices={false} />
                    {(o.customerNotes || o.staffNotes || o.kitchenNotes) && <p className="mt-2 rounded-lg bg-warn/10 p-2 text-sm text-warn">{[o.customerNotes, o.staffNotes, o.kitchenNotes].filter(Boolean).join(" · ")}</p>}
                    <div className="mt-3 flex gap-2">
                      {key === "NEW" && <Button size="lg" className="flex-1" loading={busy === o.id} onClick={() => act(o, "start")}><Play className="size-4" />Start prep</Button>}
                      {key === "PREP" && <Button size="lg" className="flex-1" loading={busy === o.id} onClick={() => act(o, "ready")}><Check className="size-4" />Mark ready</Button>}
                      {key === "READY" && <Button size="lg" className="flex-1" variant="secondary" loading={busy === o.id} onClick={() => act(o, "serve")}><Check className="size-4" />Complete</Button>}
                      <Button size="lg" variant="outline" aria-label="View recipe" onClick={() => setRecipeFor(o)}><BookOpen className="size-4" /></Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {!orders.length && <div className="mt-6"><EmptyState title="No active tickets" text="New confirmed orders show up here instantly." /></div>}

      <Modal open={!!recipeFor} onClose={() => setRecipeFor(null)} wide title={recipeFor ? `Recipes · ${recipeFor.displayId}` : ""}>
        {recipeFor && (
          <div className="space-y-5">
            {Array.from(new Map(recipeFor.items.filter((l) => !l.custom).map((l) => [l.name, l])).values()).map((l) => {
              const r = rec.data?.recipes.find((x) => x.productId === (l as unknown as { productId: string }).productId);
              return (
                <div key={l.lineId} className="rounded-xl border border-line p-4">
                  <p className="font-semibold">{l.name}</p>
                  {!r ? <p className="mt-1 text-sm text-muted">No recipe configured.</p> : (<>
                    <ul className="mt-2 space-y-1 text-sm">{r.items.map((i) => <li key={i.ingredientId} className="flex justify-between"><span>{nameOf(i.ingredientId)?.name ?? "Ingredient"}</span><span className="tabular-nums text-muted">{i.quantity} {nameOf(i.ingredientId)?.unit}</span></li>)}</ul>
                    {r.notes && <p className="mt-3 rounded-lg bg-surface2 p-3 text-sm text-muted">{r.notes}</p>}
                  </>)}
                </div>
              );
            })}
            {recipeFor.items.every((l) => l.custom) && <p className="text-sm text-muted">Custom items have no recipe.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
