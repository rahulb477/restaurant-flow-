import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, customers, loyaltyRewards, inventoryTransactions, ingredients } from "@/db/schema";

export const dayKey = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const hourOf = (d: Date, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d)) % 24;
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type Range = "today" | "yesterday" | "7d" | "30d" | "custom";

export function resolveRange(range: Range, tz: string, from?: string, to?: string) {
  const today = dayKey(new Date(), tz);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (range === "custom" && from && to && iso.test(from) && iso.test(to) && from <= to) {
    const span = (Date.parse(to) - Date.parse(from)) / 86400_000;
    if (span <= 366) return { start: from, end: to };
  }
  if (range === "yesterday") return { start: addDays(today, -1), end: addDays(today, -1) };
  if (range === "7d") return { start: addDays(today, -6), end: today };
  if (range === "30d") return { start: addDays(today, -29), end: today };
  return { start: today, end: today };
}

export async function buildAnalytics(restaurantId: string, tz: string, range: Range, opts: { from?: string; to?: string; source?: string } = {}) {
  const { start, end } = resolveRange(range, tz, opts.from, opts.to);
  const lo = new Date(`${start}T00:00:00Z`);
  lo.setUTCHours(lo.getUTCHours() - 14);
  const hi = new Date(`${end}T00:00:00Z`);
  hi.setUTCHours(hi.getUTCHours() + 38);
  const rows = (
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurantId), gte(orders.createdAt, lo), lte(orders.createdAt, hi), ...(opts.source && opts.source !== "ALL" ? [eq(orders.source, opts.source)] : [])))
      .limit(10000)
  ).filter((o) => {
    const k = dayKey(o.createdAt, tz);
    return k >= start && k <= end && o.status !== "CANCELLED";
  });

  const days: string[] = [];
  for (let k = start; k <= end; k = addDays(k, 1)) days.push(k);
  const byDayMap = new Map(days.map((d) => [d, { date: d, revenue: 0, orders: 0 }]));
  const products = new Map<string, { name: string; qty: number; revenue: number }>();
  const cats = new Map<string, { name: string; qty: number; revenue: number }>();
  const pay = new Map<string, number>();
  const sources = new Map<string, number>();
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
  let revenue = 0, paid = 0, discounts = 0, fees = 0;
  const custIds = new Set<string>();
  for (const o of rows) {
    const k = dayKey(o.createdAt, tz);
    const d = byDayMap.get(k)!;
    d.orders += 1;
    hours[hourOf(o.createdAt, tz)].orders += 1;
    sources.set(o.source, (sources.get(o.source) ?? 0) + 1);
    discounts += o.discount + o.manualDiscount;
    fees += o.platformFee;
    if (o.customerId) custIds.add(o.customerId);
    if (o.paymentStatus === "SUCCESS") {
      d.revenue += o.total;
      revenue += o.total;
      paid += 1;
      pay.set(o.paymentMethod || "OTHER", (pay.get(o.paymentMethod || "OTHER") ?? 0) + o.total);
    }
    for (const l of o.items) {
      const p = products.get(l.name) ?? { name: l.name, qty: 0, revenue: 0 };
      p.qty += l.qty; p.revenue += l.lineTotal; products.set(l.name, p);
      const cn = l.categoryName || "Uncategorised";
      const c = cats.get(cn) ?? { name: cn, qty: 0, revenue: 0 };
      c.qty += l.qty; c.revenue += l.lineTotal; cats.set(cn, c);
    }
  }
  const startTs = new Date(`${start}T00:00:00Z`); startTs.setUTCHours(startTs.getUTCHours() - 14);
  const [newCust, unlocked, claimed, lowStock, invTx] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(customers).where(and(eq(customers.restaurantId, restaurantId), gte(customers.createdAt, startTs))),
    db.select({ n: sql<number>`count(*)::int` }).from(loyaltyRewards).where(and(eq(loyaltyRewards.restaurantId, restaurantId), gte(loyaltyRewards.createdAt, startTs))),
    db.select({ n: sql<number>`count(*)::int` }).from(loyaltyRewards).where(and(eq(loyaltyRewards.restaurantId, restaurantId), eq(loyaltyRewards.status, "CLAIMED"), gte(loyaltyRewards.createdAt, startTs))),
    db.select({ n: sql<number>`count(*)::int` }).from(ingredients).where(and(eq(ingredients.restaurantId, restaurantId), eq(ingredients.isActive, true), sql`${ingredients.currentStock} <= ${ingredients.lowStockThreshold}`)),
    db.select({ n: sql<number>`count(*)::int` }).from(inventoryTransactions).where(and(eq(inventoryTransactions.restaurantId, restaurantId), eq(inventoryTransactions.type, "ORDER_DEDUCTION"), gte(inventoryTransactions.createdAt, startTs))),
  ]);
  const top = (m: Map<string, { name: string; qty: number; revenue: number }>) => [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  return {
    range: { start, end },
    revenue,
    orders: rows.length,
    paidOrders: paid,
    averageOrderValue: paid ? Math.round(revenue / paid) : 0,
    discounts,
    platformFees: fees,
    byDay: [...byDayMap.values()],
    topProducts: top(products),
    categories: top(cats),
    paymentMethods: [...pay.entries()].map(([method, amount]) => ({ method, amount })),
    peakHours: hours,
    sources: [...sources.entries()].map(([source, orders]) => ({ source, orders })),
    customers: { withProfile: custIds.size, newCustomers: newCust[0].n },
    loyalty: { unlocked: unlocked[0].n, claimed: claimed[0].n },
    inventory: { lowStock: lowStock[0].n, deductions: invTx[0].n },
  };
}
