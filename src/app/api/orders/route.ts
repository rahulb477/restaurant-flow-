import { z } from "zod";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { api, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { createOrder } from "@/lib/server/services/orders";

const FILTERS: Record<string, string[]> = {
  new: ["PLACED", "PAYMENT_COMPLETED"],
  confirmed: ["CONFIRMED"],
  preparing: ["PREPARING"],
  ready: ["READY"],
  completed: ["COMPLETED", "SERVED"],
  cancelled: ["CANCELLED"],
  payment_pending: ["PAYMENT_PENDING"],
};

export const GET = api(async (req) => {
  const ctx = await requireCtx(["orders", "kds", "pos", "bills", "dashboard"]);
  const u = new URL(req.url);
  const filter = u.searchParams.get("status") ?? "all";
  const q = u.searchParams.get("q")?.trim();
  const limit = Math.min(Number(u.searchParams.get("limit")) || 50, 200);
  const offset = Number(u.searchParams.get("offset")) || 0;
  const where: SQL[] = [eq(orders.restaurantId, ctx.restaurantId)];
  if (u.searchParams.get("board")) {
    where.push(or(inArray(orders.status, ["CONFIRMED", "PREPARING", "READY"]), and(inArray(orders.status, ["SERVED", "COMPLETED"]), sql`${orders.updatedAt} > now() - interval '2 hours'`))!);
  } else if (filter === "payment_pending") {
    where.push(or(eq(orders.status, "PAYMENT_PENDING"), and(eq(orders.paymentStatus, "PENDING"), sql`${orders.status} not in ('CANCELLED','COMPLETED')`))!);
  } else if (FILTERS[filter]) where.push(inArray(orders.status, FILTERS[filter]));
  if (u.searchParams.get("bills")) where.push(inArray(orders.paymentStatus, ["SUCCESS", "REFUNDED"]));
  if (q) {
    const s = `%${q.replace(/[%_]/g, "")}%`;
    where.push(or(ilike(orders.displayId, s), ilike(orders.tableName, s), ilike(orders.customerName, s), ilike(orders.customerPhone, s))!);
  }
  const rows = await db.select().from(orders).where(and(...where)).orderBy(desc(orders.createdAt)).limit(limit).offset(offset);
  const total = (await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(...where)))[0].n;
  // Kitchen role must not see financial/customer-contact details
  const safe = ctx.role === "KITCHEN" ? rows.map((o) => ({ ...o, subtotal: 0, discount: 0, tax: 0, platformFee: 0, total: 0, customerPhone: "", customerEmail: "", publicToken: "" })) : rows.map((o) => ({ ...o, publicToken: "" }));
  return { items: safe, total };
});

const item = z.object({
  productId: z.string().uuid().optional(),
  custom: z.object({ name: z.string().trim().min(1).max(80), price: z.number().int().min(0).max(100_000_000) }).optional(),
  qty: z.number().int().min(1).max(99),
  variants: z.record(z.string(), z.array(z.string())).optional(),
  addonIds: z.array(z.string()).optional(),
  notes: z.string().max(300).optional(),
});

export const POST = api(async (req) => {
  const ctx = await requireCtx("pos");
  const b = z
    .object({
      items: z.array(item).min(1).max(60),
      tableId: z.string().uuid().nullable().optional(),
      couponCode: z.string().max(30).optional(),
      customer: z.object({ name: z.string().max(80).optional(), phone: z.string().max(20).optional(), email: z.union([z.string().email(), z.literal("")]).optional() }).optional(),
      notes: z.string().max(500).optional(),
      manualDiscount: z.number().int().min(0).max(100_000_000).optional(),
      payment: z.object({ method: z.enum(["CASH", "UPI", "ONLINE"]), reference: z.string().max(80).optional() }).nullable().optional(),
      idempotencyKey: z.string().min(8).max(80).optional(),
      source: z.enum(["POS", "STAFF", "MANUAL"]).optional(),
    })
    .parse(await readJson(req));
  const { order, existing } = await createOrder({
    restaurantId: ctx.restaurantId,
    source: b.source ?? "POS",
    items: b.items,
    tableId: b.tableId,
    couponCode: b.couponCode,
    customer: b.customer,
    notes: b.notes,
    manualDiscount: ctx.role === "STAFF" ? 0 : b.manualDiscount,
    payment: b.payment,
    idempotencyKey: b.idempotencyKey,
    createdBy: ctx.user.id,
  });
  return { order: { ...order, publicToken: "" }, existing };
});
