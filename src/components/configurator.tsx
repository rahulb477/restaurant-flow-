"use client";
import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { formatMoney } from "@/lib/calculations";
import { Button, Modal, Notice, Textarea, cx } from "./ui";

export type CProduct = { id: string; name: string; description?: string; imageUrl?: string; price: number; variantGroupIds: string[]; addonIds: string[]; categoryId?: string | null };
export type CGroup = { id: string; name: string; selectionType: string; required: boolean; minSelections: number; maxSelections: number; options: { id: string; name: string; priceAdjustment: number; isAvailable?: boolean }[] };
export type CAddon = { id: string; name: string; price: number };
export type CartLine = { key: string; productId?: string; custom?: { name: string; price: number }; name: string; qty: number; unit: number; variants: Record<string, string[]>; addonIds: string[]; notes: string; extras: string };

export function ProductConfigurator({ product, groups, addons, currency, onAdd, onClose, actionLabel = "Add to cart" }: { product: CProduct; groups: CGroup[]; addons: CAddon[]; currency: string; onAdd: (l: CartLine) => void; onClose: () => void; actionLabel?: string }) {
  const myGroups = useMemo(() => product.variantGroupIds.map((id) => groups.find((g) => g.id === id)).filter(Boolean) as CGroup[], [product, groups]);
  const myAddons = useMemo(() => product.addonIds.map((id) => addons.find((a) => a.id === id)).filter(Boolean) as CAddon[], [product, addons]);
  const [sel, setSel] = useState<Record<string, string[]>>(() => Object.fromEntries(myGroups.filter((g) => g.required && g.selectionType === "SINGLE").map((g) => [g.id, [g.options.find((o) => o.isAvailable !== false)?.id].filter(Boolean) as string[]])));
  const [ad, setAd] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const unit = product.price + myGroups.flatMap((g) => (sel[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)?.priceAdjustment ?? 0)).reduce((a, b) => a + b, 0) + myAddons.filter((a) => ad.includes(a.id)).reduce((s, a) => s + a.price, 0);

  function toggle(g: CGroup, id: string) {
    setErr("");
    setSel((s) => {
      const cur = s[g.id] ?? [];
      if (g.selectionType === "SINGLE") return { ...s, [g.id]: cur[0] === id && !g.required ? [] : [id] };
      if (cur.includes(id)) return { ...s, [g.id]: cur.filter((x) => x !== id) };
      if (cur.length >= Math.max(1, g.maxSelections)) return s;
      return { ...s, [g.id]: [...cur, id] };
    });
  }
  function add() {
    for (const g of myGroups) {
      const min = g.required ? Math.max(1, g.minSelections) : g.minSelections;
      if ((sel[g.id]?.length ?? 0) < min) return setErr(`Please choose ${min > 1 ? `at least ${min} options for` : ""} ${g.name}.`);
    }
    const extras = [...myGroups.flatMap((g) => (sel[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)?.name ?? "")), ...myAddons.filter((a) => ad.includes(a.id)).map((a) => `+ ${a.name}`)].filter(Boolean).join(", ");
    onAdd({ key: crypto.randomUUID(), productId: product.id, name: product.name, qty, unit, variants: sel, addonIds: ad, notes: notes.trim(), extras });
  }

  return (
    <Modal open onClose={onClose} title={product.name} footer={<div className="flex w-full items-center justify-between gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-line"><button aria-label="Decrease quantity" className="grid size-10 place-items-center" onClick={() => setQty(Math.max(1, qty - 1))}><Minus className="size-4" /></button><span className="w-6 text-center tabular-nums" aria-live="polite">{qty}</span><button aria-label="Increase quantity" className="grid size-10 place-items-center" onClick={() => setQty(Math.min(99, qty + 1))}><Plus className="size-4" /></button></div>
      <Button onClick={add} className="flex-1" size="lg">{actionLabel} · {formatMoney(unit * qty, currency)}</Button></div>}>
      <div className="space-y-5">
        {product.imageUrl &&   <img src={product.imageUrl} alt={product.name} className="h-44 w-full rounded-xl object-cover" />}
        {product.description && <p className="text-sm text-muted">{product.description}</p>}
        <p className="font-semibold">{formatMoney(product.price, currency)}</p>
        {err && <Notice tone="bad">{err}</Notice>}
        {myGroups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold">{g.name}<span className="text-xs font-normal text-muted">{g.required ? "Required" : "Optional"}{g.selectionType === "MULTIPLE" ? ` · up to ${g.maxSelections}` : ""}</span></legend>
            <div className="space-y-1.5">
              {g.options.filter((o) => o.isAvailable !== false).map((o) => {
                const on = (sel[g.id] ?? []).includes(o.id);
                return (
                  <button type="button" key={o.id} role={g.selectionType === "SINGLE" ? "radio" : "checkbox"} aria-checked={on} onClick={() => toggle(g, o.id)} className={cx("flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition", on ? "border-accent bg-accent/10" : "border-line hover:bg-surface2")}>
                    <span className="flex items-center gap-2"><span className={cx("grid size-4 place-items-center border", g.selectionType === "SINGLE" ? "rounded-full" : "rounded", on ? "border-accent bg-accent" : "border-muted")}>{on && <span className="size-1.5 rounded-full bg-accent-fg" />}</span>{o.name}</span>
                    <span className="text-muted">{o.priceAdjustment ? `${o.priceAdjustment > 0 ? "+" : ""}${formatMoney(o.priceAdjustment, currency)}` : ""}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        {myAddons.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Add-ons</legend>
            <div className="space-y-1.5">
              {myAddons.map((a) => {
                const on = ad.includes(a.id);
                return (
                  <button type="button" key={a.id} role="checkbox" aria-checked={on} onClick={() => setAd(on ? ad.filter((x) => x !== a.id) : [...ad, a.id])} className={cx("flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition", on ? "border-accent bg-accent/10" : "border-line hover:bg-surface2")}>
                    <span className="flex items-center gap-2"><span className={cx("grid size-4 place-items-center rounded border", on ? "border-accent bg-accent" : "border-muted")}>{on && <span className="size-1.5 rounded-full bg-accent-fg" />}</span>{a.name}</span>
                    <span className="text-muted">+{formatMoney(a.price, currency)}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <div><label htmlFor="notes" className="mb-1.5 block text-sm font-semibold">Notes</label><Textarea id="notes" maxLength={300} placeholder="e.g. less spicy, no onion" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
