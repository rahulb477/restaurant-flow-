"use client";
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Mail, Printer } from "lucide-react";
import { formatMoney } from "@/lib/calculations";
import { post, useApi } from "@/lib/client/api";
import { Button, Card, ErrorState, Field, Input, Notice, Skeleton, useToast } from "@/components/ui";
import { ItemLines, Totals, type OrderRow } from "@/components/order-ui";
import { RoleGate } from "@/components/shell";

type R = { restaurant: { name: string; logoUrl: string; address: string; city: string; state: string; pincode: string; phone: string; currency: string; timezone: string; settings: { invoiceFooter: string } }; integrations: { email: boolean } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RoleGate module="bills"><Invoice id={id} /></RoleGate>;
}

function Invoice({ id }: { id: string }) {
  const toast = useToast();
  const o = useApi<{ order: OrderRow; bill: { emailedTo: string; emailedAt: string } | null }>(`/api/orders/${id}`);
  const r = useApi<R>("/api/restaurant");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  if (o.error) return <ErrorState message={o.error} onRetry={o.reload} />;
  if (!o.data || !r.data) return <Skeleton className="mx-auto h-[70vh] max-w-xl" />;
  const order = o.data.order, rest = r.data.restaurant, cur = rest.currency;
  const emailValue = email || order.customerEmail || "";

  async function send() {
    setMsg(null); setBusy(true);
    try { await post(`/api/orders/${id}`, { email: emailValue }); setMsg({ tone: "ok", text: `Invoice emailed to ${emailValue}` }); toast.success("Invoice sent"); o.reload(); } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/dashboard/bills" className="flex items-center gap-1 text-sm text-muted hover:text-white"><ArrowLeft className="size-4" />Bills</Link>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" />Print</Button><Button variant="secondary" onClick={() => { toast.info("Choose “Save as PDF” in the print dialog"); window.print(); }}><Download className="size-4" />Download</Button></div>
      </div>
      <Card className="print-area bg-white p-8 text-black">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">{rest.logoUrl &&   <img src={rest.logoUrl} alt="" className="size-12 rounded object-cover" />}<div><h1 className="text-xl font-bold">{rest.name}</h1><p className="text-xs text-neutral-600">{[rest.address, rest.city, rest.state, rest.pincode].filter(Boolean).join(", ")}<br />{rest.phone}</p></div></div>
          <div className="text-right text-xs"><p className="text-sm font-bold">INVOICE</p><p>{order.displayId}</p><p>{new Date(order.createdAt).toLocaleString("en-IN", { timeZone: rest.timezone })}</p>{order.tableName && <p>Table {order.tableName}</p>}</div>
        </div>
        <div className="my-5 border-y border-neutral-300 py-4 [&_*]:!text-black [&_.text-muted]:!text-neutral-600"><ItemLines items={order.items} currency={cur} /></div>
        <div className="[&_*]:!text-black"><Totals o={order} currency={cur} /></div>
        <div className="mt-4 flex justify-between text-sm"><span>Payment</span><span className="font-medium">{order.paymentMethod || "—"} · {order.paymentStatus}</span></div>
        {order.customerName && <p className="mt-2 text-xs text-neutral-600">Billed to {order.customerName}</p>}
        <p className="mt-6 text-center text-xs text-neutral-500">{rest.settings.invoiceFooter}</p>
      </Card>
      <Card className="no-print mt-5 p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><Mail className="size-4 text-accent" />Email this bill</h2>
        {!r.data.integrations.email && <div className="mb-3"><Notice tone="warn">Email isn’t configured on this server (EMAIL_API_KEY / EMAIL_FROM), so bills can’t be emailed yet. Printing works.</Notice></div>}
        {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        <div className="flex flex-wrap items-end gap-2"><Field label="Customer email" className="min-w-60 flex-1"><Input type="email" value={emailValue} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" /></Field><Button loading={busy} disabled={!r.data.integrations.email || !emailValue} onClick={send}>Send bill</Button></div>
        {o.data.bill?.emailedAt && <p className="mt-3 text-xs text-muted">Last emailed to {o.data.bill.emailedTo} on {new Date(o.data.bill.emailedAt).toLocaleString()}</p>}
        <p className="mt-2 text-xs text-muted">Total {formatMoney(order.total, cur)}</p>
      </Card>
    </div>
  );
}
