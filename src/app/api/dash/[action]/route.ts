import { z } from "zod";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { repos, tenantRepos } from "@/lib/repositories";
import { buildAnalytics, startOfDayInTz, type Range } from "@/lib/server/services/analytics";
import { resolveSettings, usageBalance } from "@/lib/server/services/orders";
import { createSettlement, submitSettlementReference } from "@/lib/server/services/usage";
import { logActivity, notify } from "@/lib/server/audit";
import { can } from "@/lib/permissions";
import { serverEnv, integrations } from "@/config/env";

type P = { action: string };
const rangeOf = (u: URL) => (["today", "yesterday", "7d", "30d", "custom"].includes(u.searchParams.get("range") ?? "") ? (u.searchParams.get("range") as Range) : "7d");
const num = (v: string | null, d: number, max: number) => Math.min(Math.max(Number(v) || d, 1), max);
const ts = (d: Date | null | undefined) => (d ? d.getTime() : 0);

export const GET = api<P>(async (req, { action }) => {
  const u = new URL(req.url);
  switch (action) {
    case "dashboard": {
      const ctx = await requireCtx("dashboard");
      const T = tenantRepos(ctx.restaurantId);
      const now = new Date();
      const [todays, low, usage, settlements, tablesActive, staff, recent, analytics, products, tables, ingredients] = await Promise.all([
        T.analytics.ordersBetween(startOfDayInTz(now, ctx.restaurant.timezone), new Date(now.getTime() + 86400_000)),
        T.analytics.lowStockIngredients(),
        usageBalance(ctx.restaurantId),
        T.settlements.list({ limit: 100 }),
        T.analytics.tableCounts(),
        T.members.count({ where: [["status", "==", "ACTIVE"]] }),
        T.orders.listRecent(8),
        buildAnalytics(ctx.restaurantId, ctx.restaurant.timezone, "7d"),
        T.products.count(),
        T.tables.count(),
        T.ingredients.count(),
      ]);
      const live = todays.filter((o) => o.status !== "CANCELLED");
      const inSet = (o: { status: string }, set: string[]) => set.includes(o.status);
      const metrics = {
        orders: live.length,
        sales: live.filter((o) => o.paymentStatus === "SUCCESS").reduce((a, o) => a + o.total, 0),
        pending: todays.filter((o) => inSet(o, ["PLACED", "PAYMENT_PENDING", "PAYMENT_COMPLETED", "CONFIRMED"])).length,
        preparing: todays.filter((o) => o.status === "PREPARING").length,
        ready: todays.filter((o) => o.status === "READY").length,
        completed: todays.filter((o) => inSet(o, ["COMPLETED", "SERVED"])).length,
      };
      const unpaid = settlements.filter((s) => s.status !== "PAID").reduce((a, s) => a + s.amount, 0);
      return {
        metrics: { ...metrics, lowStock: low.length, outstandingUsage: usage.balance + unpaid, activeTables: tablesActive.occupied, staff },
        lowStock: low.slice(0, 10).map((i) => ({ id: i.id, name: i.name, unit: i.unit, currentStock: i.currentStock, lowStockThreshold: i.lowStockThreshold })),
        recent: recent.map((o) => ({ ...o, publicToken: "" })),
        analytics,
        setup: { products, tables, ingredients },
      };
    }
    case "analytics": {
      const ctx = await requireCtx("analytics");
      return buildAnalytics(ctx.restaurantId, ctx.restaurant.timezone, rangeOf(u), { from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined, source: u.searchParams.get("source") ?? undefined });
    }
    case "pos-data": {
      const ctx = await requireCtx(["pos", "menu", "orders"]);
      const T = tenantRepos(ctx.restaurantId);
      const [cats, prods, groups, ads, tbls] = await Promise.all([T.categories.list({ limit: 500 }), T.products.listAll(1000), T.variantGroups.list({ limit: 500 }), T.addons.list({ limit: 500 }), T.tables.list({ limit: 500 })]);
      const s = resolveSettings(ctx.restaurant.settings);
      const bySort = <X extends { sortOrder: number }>(a: X, b: X) => a.sortOrder - b.sortOrder;
      return {
        categories: cats.filter((c) => c.isActive).sort(bySort),
        products: prods.filter((p) => p.isActive).sort(bySort),
        variantGroups: groups.filter((g) => g.isActive),
        addons: ads.filter((a) => a.isActive).sort(bySort),
        tables: tbls.filter((t) => t.isActive).sort((a, b) => a.number - b.number).map((t) => ({ id: t.id, name: t.name, status: t.status })),
        settings: { payments: s.payments, tax: s.tax, paymentTiming: s.paymentTiming },
        currency: ctx.restaurant.currency,
      };
    }
    case "recipes": {
      const ctx = await requireCtx(["menu", "kds", "inventory"]);
      const T = tenantRepos(ctx.restaurantId);
      const [rows, ings] = await Promise.all([T.recipes.list({ limit: 1000 }), T.ingredients.list({ limit: 1000 })]);
      return { recipes: rows, ingredients: ings.map((i) => ({ id: i.id, name: i.name, unit: i.unit })) };
    }
    case "inventory-tx": {
      const ctx = await requireCtx("inventory");
      const T = tenantRepos(ctx.restaurantId);
      const ing = u.searchParams.get("ingredientId");
      const limit = num(u.searchParams.get("limit"), 50, 200);
      const offset = Math.max(Number(u.searchParams.get("offset")) || 0, 0);
      // equality filter + in-memory ordering keeps this on Firestore's automatic single-field indexes
      const rows = ing
        ? (await T.inventoryTransactions.list({ where: [["ingredientId", "==", ing]], limit: 1000 })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
        : await T.inventoryTransactions.list({ orderBy: [["createdAt", "desc"]], limit: limit + offset });
      const page = rows.slice(offset, offset + limit);
      const ings = new Map((await T.ingredients.getMany(page.map((r) => r.ingredientId))).map((i) => [i.id, i]));
      return { items: page.map((r) => ({ ...r, ingredient: ings.get(r.ingredientId)?.name ?? null, unit: ings.get(r.ingredientId)?.unit ?? null })) };
    }
    case "usage": {
      const ctx = await requireCtx("usage");
      const T = tenantRepos(ctx.restaurantId);
      const s = resolveSettings(ctx.restaurant.settings);
      const [bal, ledger, sets] = await Promise.all([usageBalance(ctx.restaurantId), T.usage.list({ orderBy: [["createdAt", "desc"]], limit: 100 }), T.settlements.list({ orderBy: [["createdAt", "desc"]], limit: 50 })]);
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
      const T = tenantRepos(ctx.restaurantId);
      const rows = await T.reviews.list({ orderBy: [["createdAt", "desc"]], limit: 200 });
      const ords = new Map((await T.orders.getMany(rows.map((r) => r.orderId))).map((o) => [o.id, o]));
      const avg = rows.length ? rows.reduce((a, x) => a + x.rating, 0) / rows.length : 0;
      return { items: rows.map((r) => ({ ...r, displayId: ords.get(r.orderId)?.displayId ?? null, customer: ords.get(r.orderId)?.customerName ?? null })), average: avg, googleReviewUrl: resolveSettings(ctx.restaurant.settings).googleReviewUrl };
    }
    case "notifications": {
      const ctx = await requireCtx();
      const T = tenantRepos(ctx.restaurantId);
      const [items, unread] = await Promise.all([T.notifications.listRecent(30), T.notifications.count({ where: [["isRead", "==", false]] })]);
      return { items, unread };
    }
    case "activity": {
      const ctx = await requireCtx("settings");
      const limit = num(u.searchParams.get("limit"), 50, 200);
      const offset = Math.max(Number(u.searchParams.get("offset")) || 0, 0);
      const rows = await tenantRepos(ctx.restaurantId).activityLogs.list(limit + offset);
      return { items: rows.slice(offset, offset + limit) };
    }
    case "loyalty": {
      const ctx = await requireCtx("loyalty");
      const T = tenantRepos(ctx.restaurantId);
      const [prog, custs, rewards, cards] = await Promise.all([T.loyalty.getProgram(), T.customers.list({ orderBy: [["lastOrderAt", "desc"]], limit: 200 }), T.loyalty.list({ limit: 2000 }), T.scratchCards.list({ limit: 2000 })]);
      const counts = new Map<string, number>();
      for (const c of cards) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
      return {
        program: prog ?? { requiredVisits: 5, rewardTitle: "Free coffee", rewardItem: "", isActive: false },
        customers: custs.map((c) => ({ ...c, unlocked: rewards.filter((r) => r.customerId === c.id && r.status === "UNLOCKED").length, claimed: rewards.filter((r) => r.customerId === c.id && r.status === "CLAIMED").length })),
        scratch: Array.from(counts, ([status, n]) => ({ status, n })),
      };
    }
    case "search": {
      const ctx = await requireCtx();
      const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
      if (q.length < 2) return { results: [] };
      const T = tenantRepos(ctx.restaurantId);
      const has = (...v: (string | undefined | null)[]) => v.some((x) => (x ?? "").toLowerCase().includes(q));
      const results: { type: string; id: string; title: string; subtitle: string; href: string }[] = [];
      // Firestore has no substring search; each section scans a bounded, tenant-scoped window.
      if (can(ctx.role, "menu") || can(ctx.role, "pos")) for (const p of (await T.products.listAll(1000)).filter((p) => has(p.name)).slice(0, 5)) results.push({ type: "Product", id: p.id, title: p.name, subtitle: `${p.availability}`, href: can(ctx.role, "menu") ? "/dashboard/menu" : "/dashboard/pos" });
      if (can(ctx.role, "orders")) for (const o of (await T.orders.listRecent(300)).filter((o) => has(o.displayId, o.customerName, o.tableName, o.customerPhone)).slice(0, 5)) results.push({ type: "Order", id: o.id, title: o.displayId, subtitle: `${o.status} · ${o.customerName || o.tableName || o.source}`, href: "/dashboard/orders" });
      if (can(ctx.role, "loyalty")) for (const c of (await T.customers.list({ orderBy: [["lastOrderAt", "desc"]], limit: 300 })).filter((c) => has(c.name, c.phone, c.email)).slice(0, 5)) results.push({ type: "Customer", id: c.id, title: c.name || c.phone || c.email, subtitle: `${c.visits} visits`, href: "/dashboard/loyalty" });
      if (can(ctx.role, "tables")) for (const t of (await T.tables.list({ limit: 500 })).filter((t) => has(t.name)).slice(0, 5)) results.push({ type: "Table", id: t.id, title: t.name, subtitle: t.status, href: "/dashboard/tables" });
      if (can(ctx.role, "staff")) for (const m of (await T.members.listAll()).filter((m) => has(m.name, m.email)).slice(0, 5)) results.push({ type: "Staff", id: m.id, title: m.name, subtitle: m.role, href: "/dashboard/staff" });
      if (can(ctx.role, "promotions")) for (const c of (await T.coupons.list({ limit: 300 })).filter((c) => has(c.code, c.name)).slice(0, 3)) results.push({ type: "Coupon", id: c.id, title: c.code, subtitle: c.name, href: "/dashboard/promotions" });
      return { results };
    }
    default:
      throw new ApiError("Not found", 404);
  }
});

const docId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const adjust = z.object({ ingredientId: docId, mode: z.enum(["ADD", "REMOVE", "SET", "WASTE"]), quantity: z.number().min(0).max(1e9), note: z.string().max(200).optional() });

export const POST = api<P>(async (req, { action }) => {
  const b = (await readJson(req)) as Record<string, unknown>;
  switch (action) {
    case "notifications-read": {
      const ctx = await requireCtx();
      const v = z.object({ id: docId.optional() }).parse(b);
      await tenantRepos(ctx.restaurantId).notifications.markRead(v.id);
      return { ok: true };
    }
    case "inventory-adjust": {
      const ctx = await requireCtx("inventory");
      const v = adjust.parse(b);
      const T = tenantRepos(ctx.restaurantId);
      return repos().transaction(async (tx) => {
        const row = await T.ingredients.get(v.ingredientId, tx);
        if (!row) throw new ApiError("Ingredient not found", 404, "NOT_FOUND");
        const before = row.currentStock;
        const after = v.mode === "SET" ? v.quantity : v.mode === "ADD" ? before + v.quantity : before - v.quantity;
        if (after < 0) throw new ApiError(`Cannot remove more than the ${before} in stock.`, 409, "INSUFFICIENT_STOCK");
        const now = new Date();
        await T.ingredients.update(v.ingredientId, { currentStock: after, updatedAt: now }, tx);
        await T.inventoryTransactions.create(null, { ingredientId: v.ingredientId, orderId: null, type: v.mode === "ADD" ? "RESTOCK" : v.mode === "WASTE" ? "WASTE" : "ADJUSTMENT", quantityBefore: before, quantityUsed: before - after, quantityAfter: after, note: v.note ?? "", actorId: ctx.user.id, createdAt: now }, tx);
        if (after <= row.lowStockThreshold) await notify(ctx.restaurantId, "LOW_STOCK", `Low stock: ${row.name}`, `${after} left`, `low:${v.ingredientId}:${now.getTime()}`, tx);
        await logActivity(ctx, "inventory.adjusted", "ingredient", v.ingredientId, { stock: before }, { stock: after, mode: v.mode }, tx);
        return { ok: true, before, after };
      });
    }
    case "usage-settle": {
      const ctx = await requireCtx("usage");
      const s = await createSettlement(ctx.restaurantId);
      await logActivity(ctx, "usage.settlement_created", "settlement", s.id, null, { amount: s.amount });
      return { settlement: s };
    }
    case "usage-submit": {
      const ctx = await requireCtx("usage");
      const v = z.object({ settlementId: docId, reference: z.string().trim().min(4, "Enter the payment reference / UTR").max(80) }).parse(b);
      const s = await submitSettlementReference(ctx.restaurantId, v.settlementId, v.reference);
      await logActivity(ctx, "usage.settlement_submitted", "settlement", v.settlementId, null, { reference: v.reference });
      return { settlement: s };
    }
    default:
      throw new ApiError("Not found", 404);
  }
});

export const PUT = api<P>(async (req, { action }) => {
  const b = (await readJson(req)) as Record<string, unknown>;
  if (action === "recipes") {
    const ctx = await requireCtx("menu");
    const v = z.object({ productId: docId, items: z.array(z.object({ ingredientId: docId, quantity: z.number().positive().max(1e7) })).max(40), notes: z.string().max(600).default("") }).parse(b);
    const T = tenantRepos(ctx.restaurantId);
    if (!(await T.products.get(v.productId))) throw new ApiError("Product not found", 404, "NOT_FOUND");
    const ids = v.items.map((i) => i.ingredientId);
    if (ids.length && (await T.ingredients.getMany(ids)).length !== new Set(ids).size) throw new ApiError("One of the ingredients does not exist.", 400);
    const before = await T.recipes.get(v.productId);
    const row = { productId: v.productId, items: v.items, notes: v.notes, updatedAt: new Date() };
    await T.recipes.set(v.productId, row);
    await logActivity(ctx, "recipe.saved", "recipe", v.productId, before ?? null, row);
    return { recipe: { id: v.productId, ...row } };
  }
  if (action === "loyalty") {
    const ctx = await requireCtx("loyalty");
    const v = z.object({ requiredVisits: z.number().int().min(1).max(100), rewardTitle: z.string().trim().min(1).max(80), rewardItem: z.string().trim().max(80).default(""), isActive: z.boolean() }).parse(b);
    const row = await tenantRepos(ctx.restaurantId).loyalty.saveProgram(v);
    await logActivity(ctx, "loyalty.updated", "loyalty", ctx.restaurantId, null, row);
    return { program: row };
  }
  throw new ApiError("Not found", 404);
});
