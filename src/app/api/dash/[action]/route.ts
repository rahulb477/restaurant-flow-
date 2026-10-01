import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders, ingredients, inventoryTransactions, recipes, notifications, activityLogs, usageLedger, settlements, reviews, customers, loyaltyPrograms, loyaltyRewards,
  products, diningTables, members, users, categories, variantGroups, addons, scratchIssuances, coupons,
} from "@/db/schema";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { buildAnalytics, type Range } from "@/lib/server/services/analytics";
import { resolveSettings, usageBalance } from "@/lib/server/services/orders";
import { logActivity, notify } from "@/lib/server/audit";
import { can } from "@/lib/permissions";
import { serverEnv, integrations } from "@/config/env";

type P = { action: string };
const rangeOf = (u: URL) => (["today", "yesterday", "7d", "30d", "custom"].includes(u.searchParams.get("range") ?? "") ? (u.searchParams.get("range") as Range) : "7d");

export const GET = api<P>(async (req, { action }) => {
  const u = new URL(req.url);
  switch (action) {
    case "dashboard": {
      const ctx = await requireCtx("dashboard");
      const tz = ctx.restaurant.timezone;
      const rid = ctx.restaurantId;
      const sod = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
      const [today] = await db
        .select({
          orders: sql<number>`count(*) filter (where ${orders.status} <> 'CANCELLED')::int`,
          sales: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.paymentStatus} = 'SUCCESS' and ${orders.status} <> 'CANCELLED'),0)::int`,
          pending: sql<number>`count(*) filter (where ${orders.status} in ('PLACED','PAYMENT_PENDING','PAYMENT_COMPLETED','CONFIRMED'))::int`,
          preparing: sql<number>`count(*) filter (where ${orders.status} = 'PREPARING')::int`,
          ready: sql<number>`count(*) filter (where ${orders.status} = 'READY')::int`,
          completed: sql<number>`count(*) filter (where ${orders.status} in ('COMPLETED','SERVED'))::int`,
        })
        .from(orders)
        .where(and(eq(orders.restaurantId, rid), sql`${orders.createdAt} >= ${sod}`));
      const low = await db.select().from(ingredients).where(and(eq(ingredients.restaurantId, rid), eq(ingredients.isActive, true), sql`${ingredients.currentStock} <= ${ingredients.lowStockThreshold}`)).limit(10);
      const usage = await usageBalance(db, rid);
      const unpaid = (await db.select({ s: sql<number>`coalesce(sum(${settlements.amount}),0)::int` }).from(settlements).where(and(eq(settlements.restaurantId, rid), sql`${settlements.status} <> 'PAID'`)))[0].s;
      const tablesActive = (await db.select({ n: sql<number>`count(*)::int` }).from(diningTables).where(and(eq(diningTables.restaurantId, rid), eq(diningTables.status, "OCCUPIED"))))[0].n;
      const staff = (await db.select({ n: sql<number>`count(*)::int` }).from(members).where(and(eq(members.restaurantId, rid), eq(members.status, "ACTIVE"))))[0].n;
      const recent = await db.select().from(orders).where(eq(orders.restaurantId, rid)).orderBy(desc(orders.createdAt)).limit(8);
      const analytics = await buildAnalytics(rid, tz, "7d");
      const setup = {
        products: (await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.restaurantId, rid)))[0].n,
        tables: (await db.select({ n: sql<number>`count(*)::int` }).from(diningTables).where(eq(diningTables.restaurantId, rid)))[0].n,
        ingredients: low.length,
      };
      return {
        metrics: { ...today, lowStock: low.length, outstandingUsage: usage.balance + unpaid, activeTables: tablesActive, staff },
        lowStock: low.map((i) => ({ id: i.id, name: i.name, unit: i.unit, currentStock: i.currentStock, lowStockThreshold: i.lowStockThreshold })),
        recent: recent.map((o) => ({ ...o, publicToken: "" })),
        analytics,
        setup,
      };
    }
    case "analytics": {
      const ctx = await requireCtx("analytics");
      return buildAnalytics(ctx.restaurantId, ctx.restaurant.timezone, rangeOf(u), { from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined, source: u.searchParams.get("source") ?? undefined });
    }
    case "pos-data": {
      const ctx = await requireCtx(["pos", "menu", "orders"]);
      const rid = ctx.restaurantId;
      const [cats, prods, groups, ads, tbls] = await Promise.all([
        db.select().from(categories).where(and(eq(categories.restaurantId, rid), eq(categories.isActive, true))).orderBy(asc(categories.sortOrder)),
        db.select().from(products).where(and(eq(products.restaurantId, rid), eq(products.isActive, true))).orderBy(asc(products.sortOrder)),
        db.select().from(variantGroups).where(and(eq(variantGroups.restaurantId, rid), eq(variantGroups.isActive, true))),
        db.select().from(addons).where(and(eq(addons.restaurantId, rid), eq(addons.isActive, true))).orderBy(asc(addons.sortOrder)),
        db.select().from(diningTables).where(and(eq(diningTables.restaurantId, rid), eq(diningTables.isActive, true))).orderBy(asc(diningTables.number)),
      ]);
      const s = resolveSettings(ctx.restaurant.settings);
      return { categories: cats, products: prods, variantGroups: groups, addons: ads, tables: tbls.map((t) => ({ id: t.id, name: t.name, status: t.status })), settings: { payments: s.payments, tax: s.tax, paymentTiming: s.paymentTiming }, currency: ctx.restaurant.currency };
    }
    case "recipes": {
      const ctx = await requireCtx(["menu", "kds", "inventory"]);
      const rows = await db.select().from(recipes).where(eq(recipes.restaurantId, ctx.restaurantId));
      const ings = await db.select({ id: ingredients.id, name: ingredients.name, unit: ingredients.unit }).from(ingredients).where(eq(ingredients.restaurantId, ctx.restaurantId));
      return { recipes: rows, ingredients: ings };
    }
    case "inventory-tx": {
      const ctx = await requireCtx("inventory");
      const ing = u.searchParams.get("ingredientId");
      const rows = await db
        .select({ t: inventoryTransactions, ingredient: ingredients.name, unit: ingredients.unit })
        .from(inventoryTransactions)
        .leftJoin(ingredients, eq(ingredients.id, inventoryTransactions.ingredientId))
        .where(and(eq(inventoryTransactions.restaurantId, ctx.restaurantId), ...(ing ? [eq(inventoryTransactions.ingredientId, ing)] : [])))
        .orderBy(desc(inventoryTransactions.createdAt))
        .limit(Math.min(Number(u.searchParams.get("limit")) || 50, 200))
        .offset(Number(u.searchParams.get("offset")) || 0);
      return { items: rows.map((r) => ({ ...r.t, ingredient: r.ingredient, unit: r.unit })) };
    }
    case "usage": {
      const ctx = await requireCtx("usage");
      const rid = ctx.restaurantId;
      const s = resolveSettings(ctx.restaurant.settings);
      const bal = await usageBalance(db, rid);
      const ledger = await db.select().from(usageLedger).where(eq(usageLedger.restaurantId, rid)).orderBy(desc(usageLedger.createdAt)).limit(100);
      const sets = await db.select().from(settlements).where(eq(settlements.restaurantId, rid)).orderBy(desc(settlements.createdAt)).limit(50);
      const pendingSettlement = sets.filter((x) => x.status !== "PAID").reduce((a, x) => a + x.amount, 0);
      return {
        summary: { balance: bal.balance, orders: bal.orders, feePerOrder: s.fees.amountMinor, threshold: s.fees.thresholdMinor, mode: s.fees.mode, blockOnThreshold: s.fees.blockOnThreshold, pendingSettlement, overThreshold: bal.balance >= s.fees.thresholdMinor, currency: ctx.restaurant.currency },
        ledger,
        settlements: sets,
        payee: integrations.platformUpi() ? { upiId: serverEnv.PLATFORM_UPI_ID } : null,
      };
    }
    case "reviews": {
      const ctx = await requireCtx("reviews");
      const rows = await db.select({ r: reviews, displayId: orders.displayId, customer: orders.customerName }).from(reviews).leftJoin(orders, eq(orders.id, reviews.orderId)).where(eq(reviews.restaurantId, ctx.restaurantId)).orderBy(desc(reviews.createdAt)).limit(100);
      const avg = rows.length ? rows.reduce((a, x) => a + x.r.rating, 0) / rows.length : 0;
      return { items: rows.map((x) => ({ ...x.r, displayId: x.displayId, customer: x.customer })), average: avg, googleReviewUrl: resolveSettings(ctx.restaurant.settings).googleReviewUrl };
    }
    case "notifications": {
      const ctx = await requireCtx();
      const items = await db.select().from(notifications).where(eq(notifications.restaurantId, ctx.restaurantId)).orderBy(desc(notifications.createdAt)).limit(30);
      const unread = (await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.restaurantId, ctx.restaurantId), eq(notifications.isRead, false))))[0].n;
      return { items, unread };
    }
    case "activity": {
      const ctx = await requireCtx("settings");
      const items = await db.select().from(activityLogs).where(eq(activityLogs.restaurantId, ctx.restaurantId)).orderBy(desc(activityLogs.createdAt)).limit(Math.min(Number(u.searchParams.get("limit")) || 50, 200)).offset(Number(u.searchParams.get("offset")) || 0);
      return { items };
    }
    case "loyalty": {
      const ctx = await requireCtx("loyalty");
      const rid = ctx.restaurantId;
      const prog = (await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.restaurantId, rid)).limit(1))[0] ?? { restaurantId: rid, requiredVisits: 5, rewardTitle: "Free coffee", rewardItem: "", isActive: false };
      const custs = await db.select().from(customers).where(eq(customers.restaurantId, rid)).orderBy(desc(customers.lastOrderAt)).limit(200);
      const rewards = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.restaurantId, rid));
      const scratch = await db.select({ status: scratchIssuances.status, n: sql<number>`count(*)::int` }).from(scratchIssuances).where(eq(scratchIssuances.restaurantId, rid)).groupBy(scratchIssuances.status);
      return {
        program: prog,
        customers: custs.map((c) => ({ ...c, unlocked: rewards.filter((r) => r.customerId === c.id && r.status === "UNLOCKED").length, claimed: rewards.filter((r) => r.customerId === c.id && r.status === "CLAIMED").length })),
        scratch,
      };
    }
    case "search": {
      const ctx = await requireCtx();
      const q = (u.searchParams.get("q") ?? "").trim();
      if (q.length < 2) return { results: [] };
      const s = `%${q.replace(/[%_]/g, "")}%`;
      const rid = ctx.restaurantId;
      const results: { type: string; id: string; title: string; subtitle: string; href: string }[] = [];
      if (can(ctx.role, "menu") || can(ctx.role, "pos")) {
        for (const p of await db.select().from(products).where(and(eq(products.restaurantId, rid), ilike(products.name, s))).limit(5)) results.push({ type: "Product", id: p.id, title: p.name, subtitle: `${p.availability}`, href: "/dashboard/menu" });
      }
      if (can(ctx.role, "orders")) {
        for (const o of await db.select().from(orders).where(and(eq(orders.restaurantId, rid), or(ilike(orders.displayId, s), ilike(orders.customerName, s), ilike(orders.tableName, s), ilike(orders.customerPhone, s)))).orderBy(desc(orders.createdAt)).limit(5)) results.push({ type: "Order", id: o.id, title: o.displayId, subtitle: `${o.status} · ${o.customerName || o.tableName || o.source}`, href: "/dashboard/orders" });
      }
      if (can(ctx.role, "loyalty")) {
        for (const c of await db.select().from(customers).where(and(eq(customers.restaurantId, rid), or(ilike(customers.name, s), ilike(customers.phone, s), ilike(customers.email, s)))).limit(5)) results.push({ type: "Customer", id: c.id, title: c.name || c.phone || c.email, subtitle: `${c.visits} visits`, href: "/dashboard/loyalty" });
      }
      if (can(ctx.role, "tables")) {
        for (const t of await db.select().from(diningTables).where(and(eq(diningTables.restaurantId, rid), ilike(diningTables.name, s))).limit(5)) results.push({ type: "Table", id: t.id, title: t.name, subtitle: t.status, href: "/dashboard/tables" });
      }
      if (can(ctx.role, "staff")) {
        for (const m of await db.select({ id: members.id, name: users.name, email: users.email, role: members.role }).from(members).innerJoin(users, eq(users.id, members.userId)).where(and(eq(members.restaurantId, rid), or(ilike(users.name, s), ilike(users.email, s)))).limit(5)) results.push({ type: "Staff", id: m.id, title: m.name || m.email, subtitle: m.role, href: "/dashboard/staff" });
      }
      if (can(ctx.role, "promotions")) {
        for (const c of await db.select().from(coupons).where(and(eq(coupons.restaurantId, rid), ilike(coupons.code, s))).limit(3)) results.push({ type: "Coupon", id: c.id, title: c.code, subtitle: c.name, href: "/dashboard/promotions" });
      }
      return { results };
    }
    default:
      throw new ApiError("Not found", 404);
  }
});

const adjust = z.object({ ingredientId: z.string().uuid(), mode: z.enum(["ADD", "REMOVE", "SET", "WASTE"]), quantity: z.number().min(0).max(1e9), note: z.string().max(200).optional() });

export const POST = api<P>(async (req, { action }) => {
  const b = (await readJson(req)) as Record<string, unknown>;
  switch (action) {
    case "notifications-read": {
      const ctx = await requireCtx();
      const v = z.object({ id: z.string().uuid().optional() }).parse(b);
      await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.restaurantId, ctx.restaurantId), ...(v.id ? [eq(notifications.id, v.id)] : [])));
      return { ok: true };
    }
    case "inventory-adjust": {
      const ctx = await requireCtx("inventory");
      const v = adjust.parse(b);
      return db.transaction(async (tx) => {
        const row = (await tx.execute(sql`select id, name, current_stock, low_stock_threshold from ingredients where id = ${v.ingredientId} and restaurant_id = ${ctx.restaurantId} for update`)).rows[0] as { id: string; name: string; current_stock: number; low_stock_threshold: number } | undefined;
        if (!row) throw new ApiError("Ingredient not found", 404, "NOT_FOUND");
        const before = Number(row.current_stock);
        const after = v.mode === "SET" ? v.quantity : v.mode === "ADD" ? before + v.quantity : before - v.quantity;
        if (after < 0) throw new ApiError(`Cannot remove more than the ${before} in stock.`, 409, "INSUFFICIENT_STOCK");
        await tx.update(ingredients).set({ currentStock: after, updatedAt: new Date() }).where(eq(ingredients.id, v.ingredientId));
        await tx.insert(inventoryTransactions).values({ restaurantId: ctx.restaurantId, ingredientId: v.ingredientId, type: v.mode === "ADD" ? "RESTOCK" : v.mode === "WASTE" ? "WASTE" : "ADJUSTMENT", quantityBefore: before, quantityUsed: before - after, quantityAfter: after, note: v.note ?? "", actorId: ctx.user.id });
        if (after > Number(row.low_stock_threshold)) await tx.update(notifications).set({ dedupeKey: null }).where(and(eq(notifications.restaurantId, ctx.restaurantId), eq(notifications.dedupeKey, `low:${v.ingredientId}`)));
        else await notify(ctx.restaurantId, "LOW_STOCK", `Low stock: ${row.name}`, `${after} left`, `low:${v.ingredientId}`, tx);
        await logActivity(ctx, "inventory.adjusted", "ingredient", v.ingredientId, { stock: before }, { stock: after, mode: v.mode }, tx);
        return { ok: true, before, after };
      });
    }
    case "usage-settle": {
      const ctx = await requireCtx("usage");
      return db.transaction(async (tx) => {
        await tx.execute(sql`select id from restaurants where id = ${ctx.restaurantId} for update`);
        const bal = await usageBalance(tx, ctx.restaurantId);
        if (bal.balance <= 0) throw new ApiError("There is no outstanding balance to settle.", 409, "NOTHING_TO_SETTLE");
        const [s] = await tx.insert(settlements).values({ restaurantId: ctx.restaurantId, amount: bal.balance, orderCount: bal.orders }).returning();
        await tx.update(usageLedger).set({ status: "SETTLED", settlementId: s.id }).where(and(eq(usageLedger.restaurantId, ctx.restaurantId), eq(usageLedger.status, "CHARGED")));
        await logActivity(ctx, "usage.settlement_created", "settlement", s.id, null, { amount: s.amount }, tx);
        return { settlement: s };
      });
    }
    case "usage-submit": {
      const ctx = await requireCtx("usage");
      const v = z.object({ settlementId: z.string().uuid(), reference: z.string().trim().min(4, "Enter the payment reference / UTR").max(80) }).parse(b);
      const upd = await db.update(settlements).set({ status: "PROCESSING", reference: v.reference, updatedAt: new Date() }).where(and(eq(settlements.id, v.settlementId), eq(settlements.restaurantId, ctx.restaurantId), inArray(settlements.status, ["PENDING", "FAILED"]))).returning();
      if (!upd.length) throw new ApiError("This settlement cannot be updated.", 409);
      await logActivity(ctx, "usage.settlement_submitted", "settlement", v.settlementId, null, { reference: v.reference });
      return { settlement: upd[0] };
    }
    default:
      throw new ApiError("Not found", 404);
  }
});

export const PUT = api<P>(async (req, { action }) => {
  const b = (await readJson(req)) as Record<string, unknown>;
  if (action === "recipes") {
    const ctx = await requireCtx("menu");
    const v = z.object({ productId: z.string().uuid(), items: z.array(z.object({ ingredientId: z.string().uuid(), quantity: z.number().positive().max(1e7) })).max(40), notes: z.string().max(600).default("") }).parse(b);
    const p = (await db.select({ id: products.id }).from(products).where(and(eq(products.id, v.productId), eq(products.restaurantId, ctx.restaurantId))).limit(1))[0];
    if (!p) throw new ApiError("Product not found", 404, "NOT_FOUND");
    const ids = v.items.map((i) => i.ingredientId);
    if (ids.length) {
      const found = await db.select({ id: ingredients.id }).from(ingredients).where(and(eq(ingredients.restaurantId, ctx.restaurantId), inArray(ingredients.id, ids)));
      if (found.length !== new Set(ids).size) throw new ApiError("One of the ingredients does not exist.", 400);
    }
    const before = (await db.select().from(recipes).where(and(eq(recipes.restaurantId, ctx.restaurantId), eq(recipes.productId, v.productId))).limit(1))[0];
    const [row] = await db.insert(recipes).values({ restaurantId: ctx.restaurantId, productId: v.productId, items: v.items, notes: v.notes }).onConflictDoUpdate({ target: [recipes.restaurantId, recipes.productId], set: { items: v.items, notes: v.notes, updatedAt: new Date() } }).returning();
    await logActivity(ctx, "recipe.saved", "recipe", v.productId, before ?? null, row);
    return { recipe: row };
  }
  if (action === "loyalty") {
    const ctx = await requireCtx("loyalty");
    const v = z.object({ requiredVisits: z.number().int().min(1).max(100), rewardTitle: z.string().trim().min(1).max(80), rewardItem: z.string().trim().max(80).default(""), isActive: z.boolean() }).parse(b);
    const [row] = await db.insert(loyaltyPrograms).values({ restaurantId: ctx.restaurantId, ...v }).onConflictDoUpdate({ target: loyaltyPrograms.restaurantId, set: { ...v, updatedAt: new Date() } }).returning();
    await logActivity(ctx, "loyalty.updated", "loyalty", ctx.restaurantId, null, row);
    return { program: row };
  }
  throw new ApiError("Not found", 404);
});
