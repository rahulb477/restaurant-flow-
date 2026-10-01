"use client";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, Search, X, XCircle, Upload } from "lucide-react";
import { formatMoney } from "@/lib/calculations";
import { uploadTenantImage, validateImage, type UploadFolder } from "@/lib/firebase/storage";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ------------------------------ Button ------------------------------ */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "outline"; size?: "sm" | "md" | "lg"; loading?: boolean };
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: "bg-accent text-accent-fg hover:brightness-110 font-semibold",
    secondary: "bg-surface2 text-white hover:bg-[#26262b] border border-line",
    outline: "border border-line text-white hover:bg-surface2",
    ghost: "text-muted hover:text-white hover:bg-surface2",
    danger: "bg-bad/15 text-bad hover:bg-bad/25 border border-bad/30",
  }[variant];
  const s = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" }[size];
  return (
    <button {...p} disabled={disabled || loading} className={cx("inline-flex items-center justify-center gap-2 rounded-lg transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap", v, s, className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------ Fields ------------------------------ */
const inputCls = "w-full rounded-lg border border-line bg-surface2 px-3 text-sm text-white placeholder:text-[#6b6b76] focus:border-accent focus:outline-none disabled:opacity-60";
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(inputCls, "h-10", className)} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(inputCls, "py-2 min-h-20", className)} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={cx(inputCls, "h-10 appearance-none bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%239a9aa5' stroke-width='2'%3E%3Cpath d='m2 4 4 4 4-4'/%3E%3C/svg%3E\")", backgroundPosition: "right 12px center" }}>
      {children}
    </select>
  );
}
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-medium text-muted">{label}</label>
      <div id={id}>{children}</div>
      {hint && !error && <p className="text-xs text-muted/80">{hint}</p>}
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  );
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cx("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50", checked ? "bg-accent" : "bg-[#3a3a42]")}>
      <span className={cx("absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition", checked && "translate-x-5")} />
    </button>
  );
}
export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(inputCls, "h-10 pl-9")} />
    </div>
  );
}

/* ------------------------------ Surfaces ------------------------------ */
export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 no-print">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "warn" | "ok" | "bad" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cx("mt-1.5 text-2xl font-semibold tabular-nums", tone === "warn" && "text-warn", tone === "bad" && "text-bad", tone === "ok" && "text-ok")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
export function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cx("p-5", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

const TONES: Record<string, string> = {
  PLACED: "bg-info/15 text-info", CONFIRMED: "bg-info/15 text-info", PAYMENT_PENDING: "bg-warn/15 text-warn", PAYMENT_COMPLETED: "bg-ok/15 text-ok",
  PREPARING: "bg-warn/15 text-warn", READY: "bg-ok/15 text-ok", SERVED: "bg-ok/15 text-ok", COMPLETED: "bg-ok/15 text-ok", CANCELLED: "bg-bad/15 text-bad", DRAFT: "bg-white/10 text-muted",
  PENDING: "bg-warn/15 text-warn", PROCESSING: "bg-info/15 text-info", SUCCESS: "bg-ok/15 text-ok", FAILED: "bg-bad/15 text-bad", REFUNDED: "bg-white/10 text-muted", PAID: "bg-ok/15 text-ok",
  AVAILABLE: "bg-ok/15 text-ok", UNAVAILABLE: "bg-bad/15 text-bad", OUT_OF_STOCK: "bg-bad/15 text-bad", TEMPORARILY_UNAVAILABLE: "bg-warn/15 text-warn",
  FREE: "bg-ok/15 text-ok", OCCUPIED: "bg-warn/15 text-warn", RESERVED: "bg-info/15 text-info", ACTIVE: "bg-ok/15 text-ok", DISABLED: "bg-bad/15 text-bad",
};
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-white/10 text-muted", className)}>{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  return <Badge className={TONES[status]}>{status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}
export function PriceDisplay({ minor, currency = "INR", className }: { minor: number; currency?: string; className?: string }) {
  return <span className={cx("tabular-nums", className)}>{formatMoney(minor, currency)}</span>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-surface2", className)} />;
}
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-14" />)}
    </div>
  );
}
export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-surface2 text-muted">{icon ?? <Inbox className="size-5" />}</div>
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
      <span className="flex items-center gap-2"><XCircle className="size-4 shrink-0" />{message}</span>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok" | "bad"; children: ReactNode }) {
  const c = { info: "border-info/30 bg-info/10 text-info", warn: "border-warn/30 bg-warn/10 text-warn", ok: "border-ok/30 bg-ok/10 text-ok", bad: "border-bad/30 bg-bad/10 text-bad" }[tone];
  return <div role={tone === "bad" ? "alert" : "status"} className={cx("flex items-start gap-2 rounded-xl border p-3 text-sm", c)}><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div>{children}</div></div>;
}

/* ------------------------------ Tabs ------------------------------ */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1 no-print">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cx("shrink-0 rounded-lg px-3.5 py-1.5 text-sm transition", value === t.id ? "bg-accent text-accent-fg font-semibold" : "text-muted hover:text-white")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Modal / Drawer ------------------------------ */
export function Modal({ open, onClose, title, children, wide, drawer, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; drawer?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={cx("fixed inset-0 z-50 flex no-print", drawer ? "justify-end" : "items-end justify-center sm:items-center")}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx("relative flex max-h-[92vh] flex-col border border-line bg-surface shadow-2xl", drawer ? "anim-slide h-full max-h-none w-full max-w-md rounded-l-2xl" : cx("anim-pop w-full rounded-t-2xl sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-md"))}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface2 hover:text-white"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
    </>}>
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}

/* ------------------------------ Toast ------------------------------ */
type T = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastCtx = createContext<{ success: (t: string) => void; error: (t: string) => void; info: (t: string) => void }>({ success() {}, error() {}, info() {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: T["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  const api = { success: (t: string) => push("ok", t), error: (t: string) => push("error", t), info: (t: string) => push("info", t) };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6 no-print">
        {items.map((t) => (
          <div key={t.id} role="status" className="anim-pop pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border border-line bg-surface2 px-4 py-3 text-sm shadow-xl">
            {t.kind === "ok" ? <CheckCircle2 className="mt-0.5 size-4 text-ok" /> : t.kind === "error" ? <XCircle className="mt-0.5 size-4 text-bad" /> : <AlertTriangle className="mt-0.5 size-4 text-info" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------ Uploader ------------------------------ */
/** Provided by the dashboard shell so uploaders know which tenant folder to write to. */
export const UploadScope = createContext<string | null>(null);

export function ImageUploader({ value, onChange, label = "Image", maxMb = 5, folder = "products" }: { value: string; onChange: (url: string) => void; label?: string; maxMb?: number; folder?: UploadFolder }) {
  const rid = useContext(UploadScope);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  const inp = useRef<HTMLInputElement>(null);
  async function pick(f?: File) {
    if (!f) return;
    setErr("");
    const problem = validateImage(f, maxMb);
    if (problem) return setErr(problem);
    if (!rid) return setErr("Uploads are unavailable outside the dashboard.");
    setBusy(true);
    setPct(0);
    try {
      onChange(await uploadTenantImage(rid, folder, f, setPct));
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setErr(code.startsWith("storage/unauthorized") ? "You don’t have permission to upload here." : code === "storage/canceled" ? "Upload cancelled." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex items-center gap-3">
        {value ? <img src={value} alt={label} className="size-16 rounded-lg border border-line object-cover" /> : <div className="grid size-16 place-items-center rounded-lg border border-dashed border-line text-muted"><Upload className="size-5" /></div>}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => inp.current?.click()}>{busy ? `${pct}%` : value ? "Replace" : "Upload"}</Button>
          {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>Remove</Button>}
        </div>
        <input ref={inp} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}

/* ------------------------------ Pagination ------------------------------ */
export function Pagination({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted no-print">
      <span>Page {page} of {pages} · {total} total</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

/* ------------------------------ DataTable ------------------------------ */
export type Column<R> = { key: string; label: string; render?: (r: R) => ReactNode; className?: string };
export function DataTable<R extends { id: string }>({ columns, rows, actions }: { columns: Column<R>[]; rows: R[]; actions?: (r: R) => ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            {columns.map((c) => <th key={c.key} scope="col" className={cx("px-4 py-3 font-medium", c.className)}>{c.label}</th>)}
            {actions && <th scope="col" className="px-4 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="bg-bg/40 hover:bg-surface/60">
              {columns.map((c) => <td key={c.key} className={cx("px-4 py-3 align-middle", c.className)}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}</td>)}
              {actions && <td className="px-4 py-3 text-right"><div className="flex justify-end gap-1.5">{actions(r)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
