"use client";
import Link from "next/link";
import { AlertTriangle, ChefHat, Boxes, PlusSquare, QrCode, ShoppingCart, ArrowUpRight } from "lucide-react";
import { useLowStockLive } from "@/lib/client/realtime";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/calculations";
import { Card, ChartCard, DataTable, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, StatusBadge, PriceDisplay, Notice } from "../ui";
import { BarList, Donut, HourBars, LineChart } from "../charts";
import { useShell } from "../shell";

type Data = {
  metrics: { orders: number; sales: number; pending: number; preparing: number; ready: number; completed: number; lowStock: number; outstandingUsage: number; activeTables: number; staff: number };
  lowStock: { id: string; name: string; unit: string; currentStock: number; lowStockThreshold: number }[];
  recent: { id: string; displayId: string; status: string; total: number; tableName: string; source: string; customerName: string; createdAt: string }[];
  analytics: { byDay: { date: string; revenue: number; orders: number }[]; topProducts: { name: string; qty: number; revenue: number }[]; categories: { name: string; revenue: number }[]; paymentMethods: { method: string; amount: number }[]; peakHours: { hour: number; orders: number }[] };
  setup: { products: number; tables: number };
};

export function DashboardHome() {
  const { restaurant } = useShell();
  const cur = restaurant.currency;
  const m = (n: number) => formatMoney(n, cur);
  const { data, error, loading, reload } = useApi<Data>("/api/dash/dashboard", { poll: 30000 });
  // inventory alerts are realtime; falls back to the API snapshot if the role cannot read ingredients
  const low = useLowStockLive<Data["lowStock"][number] & { isActive: boolean }>(restaurant.id);
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;
  const lowList = low.data ? low.data.slice(0, 10) : data.lowStock;
  const k = { ...data.metrics, lowStock: low.data ? low.data.length : data.metrics.lowStock };
  const a = data.analytics;
  const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const quick = [
    { href: "/dashboard/pos", label: "New order", icon: ShoppingCart }, { href: "/dashboard/menu?tab=products", label: "Add product", icon: PlusSquare },
    { href: "/dashboard/tables", label: "Add table", icon: QrCode }, { href: "/dashboard/kds", label: "View KDS", icon: ChefHat }, { href: "/dashboard/inventory", label: "Inventory", icon: Boxes },
  ];
  return (
    <div>
      <PageHeader title={`Good day, ${restaurant.name}`} subtitle="Live overview of today’s operations." />
      {(data.setup.products === 0 || data.setup.tables === 0) && (
        <div className="mb-5"><Notice tone="info">Finish setup: {data.setup.products === 0 && <Link href="/dashboard/menu?tab=products" className="underline">add your first product</Link>}{data.setup.products === 0 && data.setup.tables === 0 && " · "}{data.setup.tables === 0 && <Link href="/dashboard/tables" className="underline">create a table & print its QR</Link>}.</Notice></div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {quick.map((q) => <Link key={q.href} href={q.href} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-3 text-sm transition hover:border-accent/50 hover:bg-surface2"><q.icon className="size-4 text-accent" />{q.label}</Link>)}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Today’s orders" value={k.orders} />
        <StatCard label="Today’s sales" value={m(k.sales)} hint="Paid orders" />
        <StatCard label="Pending" value={k.pending} tone={k.pending ? "warn" : undefined} />
        <StatCard label="Preparing" value={k.preparing} />
        <StatCard label="Ready" value={k.ready} tone={k.ready ? "ok" : undefined} />
        <StatCard label="Completed" value={k.completed} />
        <StatCard label="Low stock" value={k.lowStock} tone={k.lowStock ? "bad" : undefined} />
        <StatCard label="Outstanding usage" value={m(k.outstandingUsage)} />
        <StatCard label="Active tables" value={k.activeTables} />
        <StatCard label="Team" value={k.staff} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue trend" subtitle="Last 7 days · paid orders"><LineChart data={a.byDay.map((d) => ({ label: day(d.date), value: d.revenue }))} format={m} /></ChartCard>
        <ChartCard title="Orders trend" subtitle="Last 7 days"><LineChart color="#60a5fa" data={a.byDay.map((d) => ({ label: day(d.date), value: d.orders }))} /></ChartCard>
        <ChartCard title="Top products" subtitle="By revenue, last 7 days"><BarList items={a.topProducts.slice(0, 5).map((p) => ({ label: p.name, value: p.revenue, sub: `${p.qty} sold` }))} format={m} /></ChartCard>
        <ChartCard title="Top categories"><BarList items={a.categories.slice(0, 5).map((c) => ({ label: c.name, value: c.revenue }))} format={m} /></ChartCard>
        <ChartCard title="Payment methods"><Donut items={a.paymentMethods.map((p) => ({ label: p.method, value: p.amount }))} format={m} /></ChartCard>
        <ChartCard title="Peak ordering times" subtitle="Orders by hour of day"><HourBars data={a.peakHours} /></ChartCard>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent orders</h2><Link href="/dashboard/orders" className="flex items-center gap-1 text-sm text-accent">View all <ArrowUpRight className="size-3.5" /></Link></div>
          {!data.recent.length ? <EmptyState title="No orders yet" text="Orders from QR, POS and staff appear here in real time." action={<Link href="/dashboard/pos" className="text-accent hover:underline">Create the first order</Link>} /> : (
            <DataTable columns={[
              { key: "displayId", label: "Order", render: (o) => <span className="font-medium">{o.displayId}</span> },
              { key: "tableName", label: "Table", render: (o) => o.tableName || "—" },
              { key: "source", label: "Source" },
              { key: "status", label: "Status", render: (o) => <StatusBadge status={o.status} /> },
              { key: "total", label: "Total", render: (o) => <PriceDisplay minor={o.total} currency={cur} /> },
            ]} rows={data.recent} />
          )}
        </div>
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-warn" />Low-stock alerts</h2>
          {!lowList.length ? <p className="mt-4 text-sm text-muted">No low-stock ingredients. 🎉</p> : (
            <ul className="mt-4 space-y-3">{lowList.map((i) => <li key={i.id} className="flex justify-between text-sm"><span>{i.name}</span><span className="text-bad tabular-nums">{i.currentStock} {i.unit} <span className="text-muted">/ {i.lowStockThreshold}</span></span></li>)}</ul>
          )}
          <Link href="/dashboard/inventory" className="mt-4 inline-block text-sm text-accent">Manage inventory →</Link>
        </Card>
      </div>
    </div>
  );
}
