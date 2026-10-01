"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { apiFetch, post, useApi } from "@/lib/client/api";
import { Button, Card, Input, Notice, PageHeader, Skeleton, useToast } from "@/components/ui";
import { RoleGate } from "@/components/shell";

type Menu = { categories: { name: string; items: { name: string; price: number; description?: string }[] }[] };

export default function Page() {
  return <RoleGate module="menu"><Digitize /></RoleGate>;
}

function Digitize() {
  const toast = useToast();
  const status = useApi<{ configured: boolean; maxUploadMb: number }>("/api/ai/status");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState<{ categories: number; products: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const max = status.data?.maxUploadMb ?? 5;

  function pick(f?: File) {
    if (!f) return;
    setErr(""); setMenu(null); setSaved(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setErr("Please choose a PNG, JPG, JPEG or WEBP image.");
    if (f.size > max * 1024 * 1024) return setErr(`That image is larger than ${max} MB.`);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }
  async function run() {
    if (!file) return;
    setBusy(true); setErr("");
    try { const fd = new FormData(); fd.append("file", file); const r = await apiFetch<{ menu: Menu }>("/api/ai/digitize", { method: "POST", body: fd }); if (!r.menu.categories.length) setErr("No menu items were detected. Try a clearer, well-lit photo."); else setMenu(r.menu); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    if (!menu) return;
    setSaving(true); setErr("");
    try { const r = await post<{ categories: number; products: number }>("/api/ai/import", { categories: menu.categories.filter((c) => c.name.trim()).map((c) => ({ ...c, items: c.items.filter((i) => i.name.trim()) })) }); setSaved(r); setMenu(null); toast.success("Menu saved"); } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  const upd = (ci: number, fn: (c: Menu["categories"][number]) => Menu["categories"][number]) => setMenu((m) => m && { categories: m.categories.map((c, i) => (i === ci ? fn(c) : c)) });

  return (
    <div>
      <Link href="/dashboard/menu" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-white"><ArrowLeft className="size-4" />Menu</Link>
      <PageHeader title="AI menu digitization" subtitle="Upload a photo of your menu, review what the AI found, then save it to your menu." />
      {status.loading ? <Skeleton className="h-24" /> : !status.data?.configured && <div className="mb-5"><Notice tone="warn">AI isn’t configured on this server. Ask the administrator to set <code>AI_API_KEY</code> and <code>AI_MODEL</code>. Until then this feature is disabled — you can still add products manually.</Notice></div>}
      {err && <div className="mb-4"><Notice tone="bad">{err}</Notice></div>}
      {saved && <div className="mb-4"><Notice tone="ok"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" />Saved {saved.products} products in {saved.categories} new categories. <Link className="underline" href="/dashboard/menu">Open menu</Link></span></Notice></div>}

      {!menu && (
        <Card className="max-w-2xl p-6">
          <p className="mb-1 text-sm font-semibold">1 · Upload</p>
          <button onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }} className="grid w-full place-items-center rounded-xl border-2 border-dashed border-line px-4 py-10 text-center transition hover:border-accent/60">
            <Upload className="size-6 text-muted" /><span className="mt-2 text-sm">Click or drop a menu image</span><span className="text-xs text-muted">PNG, JPG, JPEG, WEBP · up to {max} MB</span>
          </button>
          <input ref={input} type="file" className="hidden" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} />
          {preview && <><p className="mb-1 mt-5 text-sm font-semibold">2 · Preview</p>{ }<img src={preview} alt="Menu preview" className="max-h-80 w-full rounded-xl border border-line object-contain" /><Button className="mt-4" size="lg" loading={busy} disabled={!status.data?.configured} onClick={run}><Sparkles className="size-4" />{busy ? "Reading your menu…" : "Start AI digitization"}</Button>{busy && <p className="mt-2 text-xs text-muted">Extracting categories, items and prices. This can take up to a minute.</p>}</>}
        </Card>
      )}

      {menu && (
        <div className="space-y-4">
          <Notice tone="info">3 · Review and edit. Nothing is saved until you press “Save to menu”. Prices are in your currency.</Notice>
          {menu.categories.map((c, ci) => (
            <Card key={ci} className="p-4">
              <div className="mb-3 flex items-center gap-2"><Input aria-label="Category name" className="font-semibold" value={c.name} onChange={(e) => upd(ci, (x) => ({ ...x, name: e.target.value }))} /><button aria-label="Remove category" className="text-muted hover:text-bad" onClick={() => setMenu({ categories: menu.categories.filter((_, i) => i !== ci) })}><Trash2 className="size-4" /></button></div>
              <div className="space-y-2">{c.items.map((it, ii) => (
                <div key={ii} className="grid grid-cols-[1fr_6rem_auto] gap-2 sm:grid-cols-[1fr_2fr_6rem_auto]">
                  <Input aria-label="Item name" value={it.name} onChange={(e) => upd(ci, (x) => ({ ...x, items: x.items.map((y, i) => (i === ii ? { ...y, name: e.target.value } : y)) }))} />
                  <Input aria-label="Description" className="hidden sm:block" placeholder="Description" value={it.description ?? ""} onChange={(e) => upd(ci, (x) => ({ ...x, items: x.items.map((y, i) => (i === ii ? { ...y, description: e.target.value } : y)) }))} />
                  <Input aria-label="Price" type="number" min={0} step="0.01" value={it.price} onChange={(e) => upd(ci, (x) => ({ ...x, items: x.items.map((y, i) => (i === ii ? { ...y, price: Number(e.target.value) } : y)) }))} />
                  <button aria-label="Remove item" className="px-1 text-muted hover:text-bad" onClick={() => upd(ci, (x) => ({ ...x, items: x.items.filter((_, i) => i !== ii) }))}><Trash2 className="size-4" /></button>
                </div>
              ))}</div>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => upd(ci, (x) => ({ ...x, items: [...x.items, { name: "", price: 0 }] }))}><Plus className="size-3.5" />Add item</Button>
            </Card>
          ))}
          <div className="flex gap-2"><Button variant="ghost" onClick={() => setMenu(null)}>Discard</Button><Button size="lg" loading={saving} onClick={save}>Save to menu</Button></div>
        </div>
      )}
    </div>
  );
}
