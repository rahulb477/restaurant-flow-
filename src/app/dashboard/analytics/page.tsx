"use client";
import { useState } from "react";
import { formatMoney } from "@/lib/calculations";
import { useApi } from "@/lib/client/api";
import { ChartCard, ErrorState, Field, Input, PageHeader, Select, Skeleton, StatCard, Tabs } from "@/components/ui";
import { BarList, Donut, HourBars, LineChart } from "@/components/charts";
import { RoleGate, useShell } from "@/components/shell";

type A = {
  range: { start: string; end: string }; revenue: number; orders: number; paidOrders: number; averageOrderValue: number; discounts: number; platformFees: number;
  byDay: { date: string; revenue: number; orders: number }[]; topProducts: { name: string; qty: number; revenue: number }[]; categories: { name: string; qty: number; revenue: number }[];
  paymentMethods: { method: string; amount: number }[]; peakHours: { hour: number; orders: number }[]; sources: { source: string; orders: number }[];
  customers: { withProfile: number; newCustomers: number }; loyalty: { unlocked: number; claimed: number }; inventory: { lowStock: number; deductions: number };
};
const RANGES = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"], ["custom", "Custom"]] as const;

export default function Page() {
  return <RoleGate module="analytics"><Analytics /></RoleGate>;
}

function Analytics() {
  const { restaurant } = useShell();
  const m = (n: number) => formatMoney(n, restaurant.currency);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState("ALL");
  const custom = range === "custom";
  const ready = !custom || (from && to && from <= to);
  const url = ready ? `/api/dash/analytics?range=${range}&source=${source}${custom ? `&from=${from}&to=${to}` : ""}` : null;
  const { data, error, loading, reload } = useApi<A>(url);
  const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div>
      <PageHeader title="Analytics" subtitle={data ? `${day(data.range.start)} – ${day(data.range.end)} · calculated from your real orders` : "Calculated from your real orders"} />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0"><Tabs tabs={RANGES.map(([id, label]) => ({ id, label }))} value={range} onChange={setRange} /></div>
        {custom && <div className="mb-5 flex gap-2"><Field label="From"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field></div>}
        <Field label="Order source" className="mb-5 w-40"><Select value={source} onChange={(e) => setSource(e.target.value)}>{["ALL", "QR", "POS", "STAFF", "MANUAL", "ADMIN"].map((s) => <option key={s} value={s}>{s === "ALL" ? "All sources" : s}</option>)}</Select></Field>
      </div>
      {!ready ? <p className="text-sm text-muted">Pick a start and end date.</p> : error && !data ? <ErrorState message={error} onRetry={reload} /> : loading || !data ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Revenue" value={m(data.revenue)} hint="Paid orders" /><StatCard label="Orders" value={data.orders} /><StatCard label="Average order value" value={m(data.averageOrderValue)} /><StatCard label="Discounts given" value={m(data.discounts)} />
            <StatCard label="Platform fees" value={m(data.platformFees)} /><StatCard label="Customers" value={data.customers.withProfile} hint={`${data.customers.newCustomers} new`} /><StatCard label="Loyalty rewards" value={data.loyalty.unlocked} hint={`${data.loyalty.claimed} claimed`} /><StatCard label="Low-stock items" value={data.inventory.lowStock} tone={data.inventory.lowStock ? "bad" : undefined} hint={`${data.inventory.deductions} stock deductions`} />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <ChartCard title="Revenue" subtitle="Paid orders per day"><LineChart data={data.byDay.map((d) => ({ label: day(d.date), value: d.revenue }))} format={m} /></ChartCard>
            <ChartCard title="Orders" subtitle="Orders per day"><LineChart color="#60a5fa" data={data.byDay.map((d) => ({ label: day(d.date), value: d.orders }))} /></ChartCard>
            <ChartCard title="Top products"><BarList items={data.topProducts.map((p) => ({ label: p.name, value: p.revenue, sub: `${p.qty} sold` }))} format={m} /></ChartCard>
            <ChartCard title="Categories"><BarList items={data.categories.map((c) => ({ label: c.name, value: c.revenue, sub: `${c.qty} items` }))} format={m} /></ChartCard>
            <ChartCard title="Payment methods"><Donut items={data.paymentMethods.map((p) => ({ label: p.method, value: p.amount }))} format={m} /></ChartCard>
            <ChartCard title="Order source"><Donut items={data.sources.map((s) => ({ label: s.source, value: s.orders }))} /></ChartCard>
            <ChartCard title="Peak hours" subtitle="Orders by hour of day" className="lg:col-span-2"><HourBars data={data.peakHours} /></ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
