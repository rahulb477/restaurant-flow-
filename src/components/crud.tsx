"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { del, patch, post, useApi, useDebounced } from "@/lib/client/api";
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, ImageUploader, Input, ListSkeleton, Modal, Notice, Pagination, SearchInput, Select, Textarea, Toggle, useToast, type Column } from "./ui";

 
export type Row = Record<string, any> & { id: string };
export type CField = {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "textarea" | "select" | "boolean" | "image" | "multi" | "datetime" | "options" | "rewards";
  options?: { value: string; label: string }[];
  source?: { resource: string; label?: string };
  /** Storage folder for image fields (default "products"). */
  folder?: "logo" | "menu" | "products" | "scratch";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  full?: boolean;
  step?: number;
  min?: number;
  editOnly?: boolean;
  createOnly?: boolean;
  allowEmpty?: boolean;
};

const toLocal = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function toForm(fields: CField[], row: Row | null, defaults: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...defaults };
  if (!row) return out;
  for (const f of fields) {
    const v = row[f.key];
    if (f.type === "money") out[f.key] = v === undefined ? defaults[f.key] : v / 100;
    else if (f.type === "datetime") out[f.key] = toLocal(v);
    else if (f.type === "options") out[f.key] = (v ?? []).map((o: Row) => ({ ...o, priceAdjustment: o.priceAdjustment / 100 }));
    else if (v !== undefined) out[f.key] = v;
  }
  return out;
}
function toPayload(fields: CField[], form: Record<string, unknown>, editing: boolean) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if ((editing && f.createOnly) || (!editing && f.editOnly)) continue;
    const v = form[f.key];
    if (f.type === "money") out[f.key] = Math.round((Number(v) || 0) * 100);
    else if (f.type === "number") out[f.key] = Number(v) || 0;
    else if (f.type === "datetime") out[f.key] = v ? new Date(v as string).toISOString() : null;
    else if (f.type === "options") out[f.key] = (v as Row[]).map((o) => ({ ...o, name: String(o.name ?? "").trim(), priceAdjustment: Math.round((Number(o.priceAdjustment) || 0) * 100) }));
    else if (f.type === "rewards") out[f.key] = (v as Row[]).map((o) => ({ label: String(o.label ?? "").trim(), probability: Number(o.probability) || 0 }));
    else out[f.key] = v;
  }
  return out;
}

function SourceList({ field, value, onChange }: { field: CField; value: string[]; onChange: (v: string[]) => void }) {
  const { data, loading } = useApi<{ items: Row[] }>(`/api/r/${field.source!.resource}?limit=500`);
  if (loading) return <p className="text-xs text-muted">Loading…</p>;
  const items = data?.items ?? [];
  if (!items.length) return <p className="text-xs text-muted">Nothing available yet — create some first.</p>;
  const label = field.source!.label ?? "name";
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface2 p-2">
      {items.map((it) => (
        <label key={it.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5">
          <input type="checkbox" className="accent-[var(--accent)]" checked={value.includes(it.id)} onChange={(e) => onChange(e.target.checked ? [...value, it.id] : value.filter((x) => x !== it.id))} />
          {String(it[label])}
        </label>
      ))}
    </div>
  );
}
function SourceSelect({ field, value, onChange }: { field: CField; value: string; onChange: (v: string) => void }) {
  const { data } = useApi<{ items: Row[] }>(`/api/r/${field.source!.resource}?limit=500`);
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{field.allowEmpty === false ? "Select…" : "— None —"}</option>
      {(data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{String(i[field.source!.label ?? "name"])}</option>)}
    </Select>
  );
}

function FieldInput({ f, value, onChange }: { f: CField; value: unknown; onChange: (v: unknown) => void }) {
  switch (f.type) {
    case "textarea":
      return <Textarea value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />;
    case "number":
    case "money":
      return <Input type="number" inputMode="decimal" step={f.step ?? (f.type === "money" ? 0.01 : 1)} min={f.min ?? 0} value={(value as number | string) ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} placeholder={f.placeholder} />;
    case "datetime":
      return <Input type="datetime-local" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "boolean":
      return <Toggle checked={!!value} onChange={onChange} label={f.label} />;
    case "image":
      return <ImageUploader value={(value as string) ?? ""} onChange={onChange} label={f.label} folder={f.folder} />;
    case "select":
      return f.source ? (
        <SourceSelect field={f} value={(value as string) ?? ""} onChange={onChange} />
      ) : (
        <Select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
      );
    case "multi":
      return <SourceList field={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "options": {
      const list = (value as Row[]) ?? [];
      const set = (i: number, patch: Record<string, unknown>) => onChange(list.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
      return (
        <div className="space-y-2">
          {list.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label="Option name" placeholder="Option name" value={o.name ?? ""} onChange={(e) => set(i, { name: e.target.value })} />
              <Input aria-label="Price adjustment" className="w-28" type="number" step="0.01" placeholder="+ price" value={o.priceAdjustment ?? 0} onChange={(e) => set(i, { priceAdjustment: Number(e.target.value) })} />
              <Toggle checked={o.isAvailable !== false} onChange={(v) => set(i, { isAvailable: v })} label="Available" />
              <button type="button" aria-label="Remove option" className="text-muted hover:text-bad" onClick={() => onChange(list.filter((_, x) => x !== i))}><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, { name: "", priceAdjustment: 0, isAvailable: true }])}><Plus className="size-3.5" />Add option</Button>
        </div>
      );
    }
    case "rewards": {
      const list = (value as Row[]) ?? [];
      const set = (i: number, patch: Record<string, unknown>) => onChange(list.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
      const sum = list.reduce((s, r) => s + (Number(r.probability) || 0), 0);
      return (
        <div className="space-y-2">
          {list.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label="Reward" placeholder="e.g. Free cookie" value={o.label ?? ""} onChange={(e) => set(i, { label: e.target.value })} />
              <div className="relative w-28"><Input aria-label="Probability %" type="number" min={0} max={100} value={o.probability ?? 0} onChange={(e) => set(i, { probability: Number(e.target.value) })} className="pr-7" /><span className="absolute right-3 top-2.5 text-xs text-muted">%</span></div>
              <button type="button" aria-label="Remove reward" className="text-muted hover:text-bad" onClick={() => onChange(list.filter((_, x) => x !== i))}><Trash2 className="size-4" /></button>
            </div>
          ))}
          <div className="flex items-center justify-between"><Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, { label: "", probability: 10 }])}><Plus className="size-3.5" />Add reward</Button><span className={sum > 100 ? "text-xs text-bad" : "text-xs text-muted"}>Win chance {sum}% · no reward {Math.max(0, 100 - sum)}%</span></div>
        </div>
      );
    }
    default:
      return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />;
  }
}

export function CrudManager({
  resource, singular, plural, fields, columns, defaults, emptyText, searchable = true, duplicate, softDelete, deleteMessage, extraActions, toolbar, onChanged, readOnly, mapIn, mapOut,
}: {
  resource: string; singular: string; plural: string; fields: CField[]; columns: Column<Row>[]; defaults: Record<string, unknown>; emptyText: string;
  searchable?: boolean; duplicate?: boolean; softDelete?: boolean; deleteMessage?: (r: Row) => string; extraActions?: (r: Row, reload: () => void) => ReactNode; toolbar?: ReactNode; onChanged?: () => void; readOnly?: boolean;
  mapIn?: (form: Record<string, unknown>, row: Row) => Record<string, unknown>; mapOut?: (payload: Record<string, unknown>, form: Record<string, unknown>) => Record<string, unknown>;
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const url = `/api/r/${resource}?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const { data, loading, error, reload } = useApi<{ items: Row[]; total: number }>(url);
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const visible = useMemo(() => fields.filter((f) => (editing ? !f.createOnly : !f.editOnly)), [fields, editing]);

  const done = () => { reload(); onChanged?.(); };
  function openForm(r: Row | null) {
    setEditing(r); setForm(r && mapIn ? mapIn(toForm(fields, r, defaults), r) : toForm(fields, r, defaults)); setFormErr(""); setOpen(true);
  }
  async function save() {
    for (const f of visible) {
      if (f.required && (form[f.key] === "" || form[f.key] == null || (typeof form[f.key] === "string" && !(form[f.key] as string).trim()))) return setFormErr(`${f.label} is required`);
    }
    setSaving(true); setFormErr("");
    try {
      const base = toPayload(fields, form, !!editing);
      const payload = mapOut ? mapOut(base, form) : base;
      if (editing) await patch(`/api/r/${resource}/${editing.id}`, payload);
      else await post(`/api/r/${resource}`, payload);
      toast.success(`${singular} ${editing ? "updated" : "created"}`);
      setOpen(false); done();
    } catch (e) { setFormErr((e as Error).message); } finally { setSaving(false); }
  }
  async function dup(r: Row) {
    try {
      const payload = toPayload(fields, toForm(fields, r, defaults), false);
      payload.name = `${r.name} (copy)`;
      await post(`/api/r/${resource}`, payload);
      toast.success(`${singular} duplicated`); done();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function remove() {
    if (!toDelete) return;
    try {
      await del(`/api/r/${resource}/${toDelete.id}`);
      toast.success(softDelete ? `${singular} deactivated` : `${singular} deleted`);
      setToDelete(null); done();
    } catch (e) { toast.error((e as Error).message); setToDelete(null); }
  }

  const items = data?.items ?? [];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 no-print">
        {searchable && <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder={`Search ${plural.toLowerCase()}…`} className="w-full sm:w-72" />}
        <div className="ml-auto flex items-center gap-2">{toolbar}{!readOnly && <Button onClick={() => openForm(null)}><Plus className="size-4" />Add {singular.toLowerCase()}</Button>}</div>
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <ListSkeleton /> : !items.length ? (
        <EmptyState title={q ? `No ${plural.toLowerCase()} match “${q}”` : `No ${plural.toLowerCase()} yet`} text={q ? "Try a different search." : emptyText} action={!q && !readOnly ? <Button onClick={() => openForm(null)}><Plus className="size-4" />Add {singular.toLowerCase()}</Button> : undefined} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={items}
            actions={(r) => (
              <>
                {extraActions?.(r, done)}
                {duplicate && !readOnly && <Button size="sm" variant="ghost" aria-label={`Duplicate ${r.name}`} onClick={() => dup(r)}><Copy className="size-4" /></Button>}
                {!readOnly && <Button size="sm" variant="ghost" aria-label={`Edit ${r.name ?? r.code}`} onClick={() => openForm(r)}><Pencil className="size-4" /></Button>}
                {!readOnly && <Button size="sm" variant="ghost" aria-label={`Delete ${r.name ?? r.code}`} onClick={() => setToDelete(r)}><Trash2 className="size-4 text-bad" /></Button>}
              </>
            )}
          />
          <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} wide title={`${editing ? "Edit" : "Add"} ${singular.toLowerCase()}`} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} onClick={save}>{editing ? "Save changes" : `Create ${singular.toLowerCase()}`}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4 sm:grid-cols-2">
          {formErr && <div className="sm:col-span-2"><Notice tone="bad">{formErr}</Notice></div>}
          {visible.map((f) => (
            <Field key={f.key} label={f.label + (f.required ? " *" : "")} hint={f.hint} className={f.full || ["textarea", "multi", "options", "rewards", "image"].includes(f.type) ? "sm:col-span-2" : ""}>
              <FieldInput f={f} value={form[f.key]} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
            </Field>
          ))}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} danger confirmLabel={softDelete ? "Deactivate" : "Delete"} title={`${softDelete ? "Deactivate" : "Delete"} ${singular.toLowerCase()}?`}
        message={toDelete ? (deleteMessage?.(toDelete) ?? `“${toDelete.name ?? toDelete.code}” will be ${softDelete ? "deactivated" : "permanently deleted"}. This cannot be undone.`) : ""}
        onConfirm={remove}
      />
    </div>
  );
}
