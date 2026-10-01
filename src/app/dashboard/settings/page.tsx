"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, MessageCircle } from "lucide-react";
import { formatMoney } from "@/lib/calculations";
import { patch, post, useApi } from "@/lib/client/api";
import { Button, Card, ConfirmDialog, DataTable, ErrorState, Field, ImageUploader, Input, ListSkeleton, Notice, PageHeader, Select, Tabs, Toggle, useToast } from "@/components/ui";
import { RoleGate, useShell } from "@/components/shell";

 
type R = Record<string, any>;
const TABS = [["business", "Business"], ["payments", "Payments"], ["ordering", "Ordering & fees"], ["security", "Security"], ["account", "Account"]] as const;
type Tab = (typeof TABS)[number][0];

export default function Page() {
  return <RoleGate module="settings"><Suspense fallback={null}><Settings /></Suspense></RoleGate>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>{children}</div>;
}

function Settings() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const tab = (TABS.find((t) => t[0] === sp.get("tab"))?.[0] ?? "business") as Tab;
  const { data, error, loading, reload } = useApi<{ restaurant: R; integrations: R }>("/api/restaurant");
  const { restaurant: shell } = useShell();
  const [r, setR] = useState<R | null>(null);
  const [s, setS] = useState<R | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<null | { title: string; message: string; run: () => Promise<void> }>(null);
  useEffect(() => { if (data) Promise.resolve().then(() => { setR(data.restaurant); setS(JSON.parse(JSON.stringify(data.restaurant.settings))); }); }, [data]);

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data || !r || !s) return <ListSkeleton />;
  const integ = data.integrations;
  const set = (path: string[], v: unknown) => setS((cur) => { const n = JSON.parse(JSON.stringify(cur)); let o = n; path.slice(0, -1).forEach((k) => (o = o[k])); o[path[path.length - 1]] = v; return n; });

  async function save(body: R, msg = "Settings saved") {
    setErr(""); setBusy(true);
    try { await patch("/api/restaurant", body); toast.success(msg); reload(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const num = (v: unknown) => (v === "" || v == null ? null : Number(v));
  const locate = () => {
    if (!("geolocation" in navigator)) return toast.error("Your browser doesn’t support location.");
    navigator.geolocation.getCurrentPosition((p) => { set(["geofence", "latitude"], +p.coords.latitude.toFixed(6)); set(["geofence", "longitude"], +p.coords.longitude.toFixed(6)); }, (e) => toast.error(e.code === 1 ? "Location permission denied." : "Couldn’t get your location."), { timeout: 10000, enableHighAccuracy: true });
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure your business, payments, ordering and security." />
      <Tabs tabs={TABS.map(([id, label]) => ({ id, label }))} value={tab} onChange={(t) => router.replace(`/dashboard/settings?tab=${t}`)} />
      {err && <div className="mb-4 max-w-2xl"><Notice tone="bad">{err}</Notice></div>}

      {tab === "business" && (
        <Card className="max-w-2xl space-y-4 p-6">
          <Field label="Logo"><ImageUploader value={r.logoUrl} onChange={(u) => setR({ ...r, logoUrl: u })} label="Logo" maxMb={integ.maxUploadMb} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name"><Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
            <Field label="Brand accent colour"><div className="flex gap-2"><input type="color" aria-label="Accent colour" value={r.accent} onChange={(e) => setR({ ...r, accent: e.target.value })} className="h-10 w-14 rounded-lg border border-line bg-surface2 p-1" /><Input value={r.accent} onChange={(e) => setR({ ...r, accent: e.target.value })} /></div></Field>
            <Field label="Phone"><Input value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={r.email} onChange={(e) => setR({ ...r, email: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={r.address} onChange={(e) => setR({ ...r, address: e.target.value })} /></Field>
            <Field label="City"><Input value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} /></Field><Field label="State"><Input value={r.state} onChange={(e) => setR({ ...r, state: e.target.value })} /></Field>
            <Field label="Country"><Input value={r.country} onChange={(e) => setR({ ...r, country: e.target.value })} /></Field><Field label="Pincode"><Input value={r.pincode} onChange={(e) => setR({ ...r, pincode: e.target.value })} /></Field>
            <Field label="Currency"><Select value={r.currency} onChange={(e) => setR({ ...r, currency: e.target.value })}>{["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Timezone"><Input value={r.timezone} onChange={(e) => setR({ ...r, timezone: e.target.value })} placeholder="Asia/Kolkata" /></Field>
            <Field label="Invoice footer" className="sm:col-span-2"><Input value={s.invoiceFooter} onChange={(e) => set(["invoiceFooter"], e.target.value)} /></Field>
          </div>
          <p className="text-xs text-muted">Your public menu link: <code>/order/{r.slug}</code> — it never changes when you rename the business.</p>
          <Button loading={busy} onClick={() => save({ name: r.name, accent: r.accent, logoUrl: r.logoUrl, phone: r.phone, email: r.email, address: r.address, city: r.city, state: r.state, country: r.country, pincode: r.pincode, currency: r.currency, timezone: r.timezone, settings: { invoiceFooter: s.invoiceFooter } })}>Save business profile</Button>
        </Card>
      )}

      {tab === "payments" && (
        <Card className="max-w-2xl p-6">
          <div className="divide-y divide-line">
            <Row label="Accept cash" hint="Staff confirm cash received"><Toggle checked={s.payments.cash} onChange={(v) => set(["payments", "cash"], v)} label="Cash" /></Row>
            <Row label="Accept UPI" hint="Dynamic QR with the exact order amount"><Toggle checked={s.payments.upi} onChange={(v) => set(["payments", "upi"], v)} label="UPI" /></Row>
          </div>
          {s.payments.upi && <div className="mt-3 grid gap-4 sm:grid-cols-2"><Field label="Your UPI ID" hint="Stored for your restaurant only"><Input value={s.payments.upiId} onChange={(e) => set(["payments", "upiId"], e.target.value.trim())} placeholder="cafe@okbank" /></Field><Field label="Payee name"><Input value={s.payments.upiName} onChange={(e) => set(["payments", "upiName"], e.target.value)} placeholder={r.name} /></Field></div>}
          <div className="mt-4"><Notice tone={integ.onlinePayments ? "ok" : "info"}>Online card/wallet payments: {integ.onlinePayments ? "a provider is configured on this server." : "no provider is configured on this server yet."}</Notice></div>
          <p className="mt-3 text-xs text-muted">UPI links can’t prove a payment was made, so staff confirm receipt before an order is marked paid.</p>
          <Button className="mt-5" loading={busy} onClick={() => save({ settings: { payments: { cash: s.payments.cash, upi: s.payments.upi, upiId: s.payments.upiId, upiName: s.payments.upiName } } })}>Save payments</Button>
        </Card>
      )}

      {tab === "ordering" && (
        <div className="max-w-2xl space-y-5">
          <Card className="p-6">
            <h2 className="mb-1 font-semibold">Ordering</h2>
            <div className="divide-y divide-line">
              <Row label="Customer QR ordering" hint="Turn off to pause all online orders"><Toggle checked={s.customerOrdering} onChange={(v) => v ? set(["customerOrdering"], true) : setConfirm({ title: "Disable customer ordering?", message: "Guests will no longer be able to place orders from their phones until you turn this back on.", run: async () => set(["customerOrdering"], false) })} label="Customer ordering" /></Row>
              <Row label="Table ordering" hint="Allow orders from table QR codes"><Toggle checked={s.tableOrdering} onChange={(v) => set(["tableOrdering"], v)} label="Table ordering" /></Row>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Payment timing" hint={s.paymentTiming === "PAY_FIRST" ? "Orders wait for payment before the kitchen can start." : "Customers order first and pay afterwards."}><Select value={s.paymentTiming} onChange={(e) => set(["paymentTiming"], e.target.value)}><option value="PAY_AT_END">Pay at end</option><option value="PAY_FIRST">Pay first</option></Select></Field>
              <Field label="Order ID prefix" hint="e.g. CP → CP-000123"><Input value={s.orderPrefix} maxLength={6} onChange={(e) => set(["orderPrefix"], e.target.value.toUpperCase())} /></Field>
              <Field label="Deduct inventory when order is" hint="Deduction happens once per order"><Select value={s.inventoryDeductOn} onChange={(e) => set(["inventoryDeductOn"], e.target.value)}><option value="CONFIRMED">Confirmed</option><option value="PREPARING">Preparing</option><option value="COMPLETED">Completed</option></Select></Field>
              <Field label="Allow negative stock"><div className="pt-2"><Toggle checked={s.allowNegativeStock} onChange={(v) => set(["allowNegativeStock"], v)} label="Allow negative stock" /></div></Field>
              <Field label="Google review link" className="sm:col-span-2" hint="Customers are sent here after rating; reviews are never auto-posted."><Input value={s.googleReviewUrl} onChange={(e) => set(["googleReviewUrl"], e.target.value)} placeholder="https://g.page/r/…/review" /></Field>
              <Field label="Support WhatsApp number" className="sm:col-span-2"><Input value={s.whatsapp} onChange={(e) => set(["whatsapp"], e.target.value)} placeholder="+91 98765 43210" /></Field>
            </div>
          </Card>
          <Card className="p-6">
            <h2 className="mb-1 font-semibold">Tax</h2>
            <Row label="Charge tax" hint="Disabled until you configure it"><Toggle checked={s.tax.enabled} onChange={(v) => set(["tax", "enabled"], v)} label="Tax enabled" /></Row>
            {s.tax.enabled && <div className="grid gap-4 sm:grid-cols-3"><Field label="Tax name"><Input value={s.tax.name} onChange={(e) => set(["tax", "name"], e.target.value)} /></Field><Field label="Rate (%)"><Input type="number" min={0} max={100} step="0.01" value={s.tax.ratePct} onChange={(e) => set(["tax", "ratePct"], Number(e.target.value))} /></Field><Field label="Mode"><Select value={s.tax.mode} onChange={(e) => set(["tax", "mode"], e.target.value)}><option value="EXCLUSIVE">Added on top</option><option value="INCLUSIVE">Included in prices</option></Select></Field></div>}
          </Card>
          <Card className="p-6">
            <h2 className="mb-1 font-semibold">Platform fee</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Fee mode"><Select value={s.fees.mode} onChange={(e) => set(["fees", "mode"], e.target.value)}><option value="CUSTOMER_BASED">Customer based</option><option value="STORE_BASED">Store based</option></Select></Field>
              <Field label="Fee per QR order" hint="Set by the platform"><Input readOnly value={formatMoney(integ.platformFeeMinor, shell.currency)} /></Field>
              <Field label="Settlement threshold" hint="Set by the platform"><Input readOnly value={formatMoney(integ.thresholdMinor, shell.currency)} /></Field>
            </div>
            <Row label="Block new QR orders at threshold" hint="Customers can’t order until you settle"><Toggle checked={s.fees.blockOnThreshold} onChange={(v) => set(["fees", "blockOnThreshold"], v)} label="Block at threshold" /></Row>
            <p className="text-xs text-muted">{s.fees.mode === "CUSTOMER_BASED" ? "Customers see the fee as a separate line; it’s recorded in your usage ledger." : "Customers pay nothing extra; the fee is recorded in your usage ledger."}</p>
          </Card>
          <Button loading={busy} onClick={() => {
            const body = { settings: { customerOrdering: s.customerOrdering, tableOrdering: s.tableOrdering, paymentTiming: s.paymentTiming, orderPrefix: s.orderPrefix, inventoryDeductOn: s.inventoryDeductOn, allowNegativeStock: s.allowNegativeStock, googleReviewUrl: s.googleReviewUrl, whatsapp: s.whatsapp, tax: s.tax, fees: { mode: s.fees.mode, blockOnThreshold: s.fees.blockOnThreshold } } };
            if (s.fees.mode !== data.restaurant.settings.fees.mode) setConfirm({ title: "Change platform fee mode?", message: s.fees.mode === "CUSTOMER_BASED" ? "Customers will start seeing the platform fee on their bill." : "Customers will no longer see a platform fee; your store absorbs it.", run: async () => save(body) });
            else save(body);
          }}>Save ordering settings</Button>
        </div>
      )}

      {tab === "security" && (
        <Card className="max-w-2xl p-6">
          <h2 className="font-semibold">Ordering geofence</h2>
          <p className="mt-1 text-sm text-muted">Only customers physically near your location can place QR orders. Their location is checked once and never stored.</p>
          <Row label="Enable geofence"><Toggle checked={s.geofence.enabled} onChange={(v) => set(["geofence", "enabled"], v)} label="Geofence" /></Row>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Latitude"><Input type="number" step="any" value={s.geofence.latitude ?? ""} onChange={(e) => set(["geofence", "latitude"], num(e.target.value))} /></Field>
            <Field label="Longitude"><Input type="number" step="any" value={s.geofence.longitude ?? ""} onChange={(e) => set(["geofence", "longitude"], num(e.target.value))} /></Field>
            <Field label="Radius (metres)"><Input type="number" min={10} max={5000} value={s.geofence.radiusMeters} onChange={(e) => set(["geofence", "radiusMeters"], Number(e.target.value))} /></Field>
          </div>
          <Button variant="secondary" className="mt-3" onClick={locate}><MapPin className="size-4" />Use my current location</Button>
          {s.geofence.latitude != null && s.geofence.longitude != null && <iframe title="Geofence centre" loading="lazy" className="mt-4 h-52 w-full rounded-xl border border-line" src={`https://www.openstreetmap.org/export/embed.html?bbox=${s.geofence.longitude - 0.004}%2C${s.geofence.latitude - 0.003}%2C${s.geofence.longitude + 0.004}%2C${s.geofence.latitude + 0.003}&layer=mapnik&marker=${s.geofence.latitude}%2C${s.geofence.longitude}`} />}
          {s.geofence.enabled && (s.geofence.latitude == null || s.geofence.longitude == null) && <div className="mt-3"><Notice tone="warn">Set a location or the geofence won’t be enforced.</Notice></div>}
          <Button className="mt-5" loading={busy} onClick={() => save({ settings: { geofence: s.geofence } })}>Save security settings</Button>
        </Card>
      )}

      {tab === "account" && <Account />}
      <ConfirmDialog open={!!confirm} title={confirm?.title ?? ""} message={confirm?.message ?? ""} danger onClose={() => setConfirm(null)} onConfirm={async () => { await confirm?.run(); setConfirm(null); }} />
      {integ.supportWhatsapp && <a className="mt-6 inline-flex items-center gap-2 text-sm text-muted hover:text-white" href={`https://wa.me/${String(integ.supportWhatsapp).replace(/[^\d]/g, "")}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4 text-[#25d366]" />Contact support</a>}
    </div>
  );
}

function Account() {
  const toast = useToast();
  const { user } = useShell();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const log = useApi<{ items: { id: string; action: string; actorName: string; actorRole: string; before: unknown; after: unknown; createdAt: string }[] }>("/api/dash/activity?limit=40");
  async function change() {
    setErr("");
    if (f.next.length < 8) return setErr("New password must be at least 8 characters.");
    if (f.next !== f.again) return setErr("New passwords don’t match.");
    setBusy(true);
    try { await post("/api/auth/change-password", { current: f.current, next: f.next }); toast.success("Password changed"); setF({ current: "", next: "", again: "" }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const summarize = (a: { before: unknown; after: unknown }) => { const j = (x: unknown) => (x ? JSON.stringify(x).slice(0, 90) : ""); return a.before || a.after ? `${j(a.before)}${a.before && a.after ? " → " : ""}${j(a.after)}` : "—"; };
  return (
    <div className="max-w-3xl space-y-5">
      <Card className="p-6">
        <p className="text-sm text-muted">Signed in as <b className="text-white">{user.email}</b> {user.emailVerified ? "· verified" : "· not verified"}</p>
        <h2 className="mb-3 mt-5 font-semibold">Change password</h2>
        {err && <div className="mb-3"><Notice tone="bad">{err}</Notice></div>}
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Current password"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field><Field label="New password"><Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field><Field label="Repeat new password"><Input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field></div>
        <div className="mt-4 flex gap-2"><Button loading={busy} onClick={change}>Update password</Button><Button variant="outline" onClick={async () => { await post("/api/auth/logout"); window.location.href = "/login"; }}>Log out</Button></div>
      </Card>
      <div><h2 className="mb-3 font-semibold">Activity log</h2>
        {log.data?.items.length ? <DataTable columns={[{ key: "createdAt", label: "When", render: (a) => new Date(a.createdAt).toLocaleString() }, { key: "action", label: "Action", render: (a) => <span className="font-mono text-xs">{a.action}</span> }, { key: "actorName", label: "By", render: (a) => `${a.actorName} (${a.actorRole.toLowerCase()})` }, { key: "before", label: "Change", render: (a) => <span className="text-xs text-muted">{summarize(a)}</span> }]} rows={log.data.items} /> : <p className="text-sm text-muted">{log.loading ? "Loading…" : "No activity recorded yet."}</p>}
      </div>
    </div>
  );
}
