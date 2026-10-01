import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  restaurants,
  products,
  variantGroups,
  addons,
  categories,
  diningTables,
  coupons,
  couponRedemptions,
  customers,
  orders,
  payments,
  bills,
  usageLedger,
  recipes,
  ingredients,
  inventoryTransactions,
  loyaltyPrograms,
  loyaltyRewards,
  scratchCampaigns,
  scratchIssuances,
  type OrderLine,
} from "@/db/schema";
import {
  OrderError,
  priceLine,
  validateCoupon,
  calculateTotals,
  calculatePlatformFee,
  initialOrderStatus,
  canTransition,
  checkGeofence,
  computeDeductions,
  evaluateVisit,
  formatOrderId,
  mergeSettings,
  defaultSettings,
  normalizePhone,
  ORDER_ACTIONS,
  type OrderAction,
  type Settings,
  type VariantGroupLike,
  type AddonLike,
} from "@/lib/calculations";
import { serverEnv } from "@/config/env";
import { notify } from "../audit";

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Order = typeof orders.$inferSelect;

/** Fee amount & settlement threshold are platform-controlled (env), never tenant-editable. */
export const resolveSettings = (raw: unknown): Settings => {
  const s = mergeSettings(raw, defaultSettings({ feeMinor: serverEnv.PLATFORM_FEE_MINOR, thresholdMinor: serverEnv.SETTLEMENT_THRESHOLD_MINOR, prefix: serverEnv.ORDER_ID_PREFIX || "CP" }));
  s.fees.amountMinor = serverEnv.PLATFORM_FEE_MINOR;
  s.fees.thresholdMinor = serverEnv.SETTLEMENT_THRESHOLD_MINOR;
  return s;
};

export type CreateOrderInput = {
  restaurantId: string;
  source: "QR" | "POS" | "STAFF" | "MANUAL" | "ADMIN";
  tableId?: string | null;
  tableToken?: string | null;
  items: {
    productId?: string;
    custom?: { name: string; price: number };
    qty: number;
    variants?: Record<string, string[]>;
    addonIds?: string[];
    notes?: string;
  }[];
  couponCode?: string;
  customer?: { name?: string; phone?: string; email?: string };
  notes?: string;
  staffNotes?: string;
  manualDiscount?: number;
  idempotencyKey?: string;
  location?: { lat: number; lng: number } | null;
  payment?: { method: "CASH" | "UPI" | "ONLINE"; reference?: string } | null;
  createdBy?: string | null;
  dryRun?: boolean;
};

class DryRun {
  constructor(public order: Order) {}
}

export async function usageBalance(tx: DbTx | typeof db, restaurantId: string) {
  const r = await tx
    .select({ total: sql<number>`coalesce(sum(${usageLedger.amount}),0)::int`, n: sql<number>`count(*)::int` })
    .from(usageLedger)
    .where(and(eq(usageLedger.restaurantId, restaurantId), eq(usageLedger.status, "CHARGED")));
  return { balance: r[0].total, orders: r[0].n };
}

export async function createOrder(input: CreateOrderInput): Promise<{ order: Order; existing: boolean }> {
  if (!input.items.length) throw new OrderError("Add at least one item to the order.", "EMPTY_ORDER");
  if (input.items.length > 60) throw new OrderError("Too many items in one order.");
  const staff = input.source !== "QR";
  try {
    return await db.transaction(async (tx) => {
      // idempotency: same key => same order
      if (input.idempotencyKey) {
        const ex = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.restaurantId, input.restaurantId), eq(orders.idempotencyKey, input.idempotencyKey)))
          .limit(1);
        if (ex[0]) return { order: ex[0], existing: true };
      }
      const rest = (await tx.select().from(restaurants).where(eq(restaurants.id, input.restaurantId)).limit(1))[0];
      if (!rest) throw new OrderError("Restaurant not found.", "NOT_FOUND", 404);
      const settings = resolveSettings(rest.settings);

      // table resolution (token for public, id for staff)
      let table: typeof diningTables.$inferSelect | undefined;
      if (input.tableToken) {
        table = (await tx.select().from(diningTables).where(and(eq(diningTables.restaurantId, rest.id), eq(diningTables.qrToken, input.tableToken))).limit(1))[0];
        if (!table || !table.isActive) throw new OrderError("This QR code is no longer valid. Please ask staff for help.", "QR_INVALID", 404);
      } else if (input.tableId) {
        table = (await tx.select().from(diningTables).where(and(eq(diningTables.restaurantId, rest.id), eq(diningTables.id, input.tableId))).limit(1))[0];
        if (!table) throw new OrderError("Table not found.", "TABLE_INVALID", 404);
      }

      if (!staff) {
        if (!settings.customerOrdering) throw new OrderError("Ordering is currently paused. Please order at the counter.", "ORDERING_DISABLED", 403);
        if (table && !settings.tableOrdering) throw new OrderError("Table ordering is currently disabled.", "ORDERING_DISABLED", 403);
        const geo = input.dryRun ? { allowed: true as const, reason: "" } : checkGeofence(settings.geofence, input.location);
        if (!geo.allowed) {
          throw new OrderError(
            geo.reason === "LOCATION_REQUIRED" ? "Please allow location access so we can confirm you are at the restaurant." : "You appear to be outside the restaurant. Ordering is only available on-site.",
            "GEOFENCE",
            403,
          );
        }
        if (settings.fees.blockOnThreshold) {
          const u = await usageBalance(tx, rest.id);
          if (u.balance >= settings.fees.thresholdMinor) throw new OrderError("This restaurant cannot accept new online orders right now. Please order at the counter.", "USAGE_BLOCKED", 403);
        }
      }

      // load catalogue (tenant-scoped)
      const productIds = Array.from(new Set(input.items.map((i) => i.productId).filter((x): x is string => !!x)));
      const prodRows = productIds.length ? await tx.select().from(products).where(and(eq(products.restaurantId, rest.id), inArray(products.id, productIds))) : [];
      const prodMap = new Map(prodRows.map((p) => [p.id, p]));
      const groupRows = await tx.select().from(variantGroups).where(eq(variantGroups.restaurantId, rest.id));
      const groupMap = new Map<string, VariantGroupLike>(groupRows.map((g) => [g.id, g]));
      const addonRows = await tx.select().from(addons).where(eq(addons.restaurantId, rest.id));
      const addonMap = new Map<string, AddonLike>(addonRows.map((a) => [a.id, a]));
      const catRows = await tx.select().from(categories).where(eq(categories.restaurantId, rest.id));
      const catName = new Map(catRows.map((c) => [c.id, c.name]));

      const lines: OrderLine[] = input.items.map((it) => {
        const lineId = crypto.randomUUID();
        if (it.custom) {
          if (!staff) throw new OrderError("Custom items can only be added by staff.", "FORBIDDEN", 403);
          const price = Math.round(it.custom.price);
          const qty = Math.floor(it.qty);
          if (!it.custom.name.trim() || price < 0 || qty < 1 || qty > 99) throw new OrderError("Invalid custom item.");
          return { lineId, productId: null, name: it.custom.name.trim().slice(0, 80), custom: true, categoryId: null, categoryName: "Custom", qty, unitPrice: price, variants: [], addons: [], notes: (it.notes ?? "").slice(0, 300), lineTotal: price * qty };
        }
        const product = it.productId ? prodMap.get(it.productId) : undefined;
        if (!product) throw new OrderError("One of the items is no longer on the menu.", "PRODUCT_UNAVAILABLE", 409);
        const p = priceLine(product, groupMap, addonMap, { qty: it.qty, variants: it.variants, addonIds: it.addonIds, notes: it.notes });
        return { lineId, ...p, custom: false, categoryName: p.categoryId ? (catName.get(p.categoryId) ?? "") : "" };
      });
      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

      // customer
      const phone = normalizePhone(input.customer?.phone ?? "");
      const email = (input.customer?.email ?? "").trim().toLowerCase();
      const customerKey = phone || email;

      // coupon
      let couponId: string | null = null;
      let couponCode = "";
      let couponDiscount = 0;
      if (input.couponCode?.trim()) {
        const code = input.couponCode.trim().toUpperCase();
        const c = (await tx.select().from(coupons).where(and(eq(coupons.restaurantId, rest.id), eq(coupons.code, code))).limit(1))[0];
        let used = 0;
        if (c && customerKey) {
          used = (await tx.select({ n: sql<number>`count(*)::int` }).from(couponRedemptions).where(and(eq(couponRedemptions.couponId, c.id), eq(couponRedemptions.customerKey, customerKey))))[0].n;
        }
        const res = validateCoupon(c, { lines, subtotal, customerRedemptions: used });
        if (!res.ok) throw new OrderError(res.reason, "COUPON_INVALID");
        if (c!.perCustomerLimit > 0 && !customerKey) throw new OrderError("Enter your phone number to use this coupon.", "COUPON_NEEDS_CUSTOMER");
        couponId = c!.id;
        couponCode = c!.code;
        couponDiscount = res.discount;
      }

      // fees & totals (never from client)
      const fee = calculatePlatformFee({ mode: settings.fees.mode, amountMinor: settings.fees.amountMinor, eligible: input.source === "QR" });
      const manual = staff ? Math.max(0, Math.round(input.manualDiscount ?? 0)) : 0;
      const totals = calculateTotals({ subtotal, couponDiscount, manualDiscount: manual, tax: settings.tax, customerFee: fee.customerFee });

      // sequence + id
      const seq = (await tx.update(restaurants).set({ orderSeq: sql`${restaurants.orderSeq} + 1` }).where(eq(restaurants.id, rest.id)).returning({ s: restaurants.orderSeq }))[0].s;
      const displayId = formatOrderId(settings.orderPrefix, seq);
      const status = initialOrderStatus(input.source, settings.paymentTiming);

      // customer upsert
      let customerId: string | null = null;
      if (customerKey) {
        const up = await tx
          .insert(customers)
          .values({ restaurantId: rest.id, phone, email, name: input.customer?.name?.trim().slice(0, 80) ?? "" })
          .onConflictDoUpdate({ target: [customers.restaurantId, customers.phone, customers.email], set: { name: sql`case when excluded.name <> '' then excluded.name else ${customers.name} end` } })
          .returning({ id: customers.id });
        customerId = up[0].id;
      }

      const [order] = await tx
        .insert(orders)
        .values({
          restaurantId: rest.id,
          displayId,
          publicToken: crypto.randomBytes(18).toString("hex"),
          idempotencyKey: input.idempotencyKey ?? null,
          source: input.source,
          status,
          paymentStatus: "PENDING",
          tableId: table?.id ?? null,
          tableName: table?.name ?? "",
          customerId,
          customerName: input.customer?.name?.trim().slice(0, 80) ?? "",
          customerPhone: phone,
          customerEmail: email,
          items: lines,
          customerNotes: staff ? "" : (input.notes ?? "").slice(0, 500),
          staffNotes: staff ? (input.notes ?? input.staffNotes ?? "").slice(0, 500) : "",
          couponId,
          couponCode,
          subtotal: totals.subtotal,
          discount: totals.discount,
          manualDiscount: totals.manualDiscount,
          tax: totals.tax,
          taxLabel: settings.tax.enabled ? `${settings.tax.name} ${settings.tax.ratePct}%` : "",
          platformFee: totals.platformFee,
          total: totals.total,
          paymentTiming: settings.paymentTiming,
          createdBy: input.createdBy ?? null,
        })
        .returning();

      if (couponId) {
        const upd = await tx
          .update(coupons)
          .set({ usageCount: sql`${coupons.usageCount} + 1` })
          .where(and(eq(coupons.id, couponId), sql`(${coupons.usageLimit} = 0 or ${coupons.usageCount} < ${coupons.usageLimit})`))
          .returning({ id: coupons.id });
        if (!upd.length) throw new OrderError("This coupon has reached its usage limit", "COUPON_INVALID");
        await tx.insert(couponRedemptions).values({ restaurantId: rest.id, couponId, orderId: order.id, customerKey });
      }
      if (fee.ledgerAmount > 0) {
        await tx.insert(usageLedger).values({ restaurantId: rest.id, orderId: order.id, orderDisplayId: displayId, amount: fee.ledgerAmount, mode: settings.fees.mode });
      }
      if (table) await tx.update(diningTables).set({ status: "OCCUPIED", updatedAt: new Date() }).where(eq(diningTables.id, table.id));

      let current = order;
      if (input.payment && staff) current = await recordPayment(tx, current, { method: input.payment.method, reference: input.payment.reference, actorId: input.createdBy ?? null, settings });
      if (status === settings.inventoryDeductOn) await deductInventory(tx, current, input.createdBy ?? null, settings);

      if (input.source === "QR") await notify(rest.id, "ORDER_RECEIVED", `New order ${displayId}`, table ? `Table ${table.name}` : "Online order", `order:${order.id}:received`, tx);
      if (input.dryRun) throw new DryRun(current);
      return { order: current, existing: false };
    });
  } catch (e) {
    if (e instanceof DryRun) return { order: e.order, existing: false };
    const err = e as { code?: string; cause?: { code?: string } };
    if ((err?.cause?.code ?? err?.code) === "23505" && input.idempotencyKey) {
      const ex = (await db.select().from(orders).where(and(eq(orders.restaurantId, input.restaurantId), eq(orders.idempotencyKey, input.idempotencyKey))).limit(1))[0];
      if (ex) return { order: ex, existing: true };
    }
    throw e;
  }
}

/* ----------------------------- payments ----------------------------- */
export async function recordPayment(
  tx: DbTx,
  order: Order,
  o: { method: "CASH" | "UPI" | "ONLINE"; reference?: string; actorId: string | null; settings: Settings },
): Promise<Order> {
  if (order.status === "CANCELLED") throw new OrderError("This order was cancelled.", "ORDER_CANCELLED", 409);
  if (order.paymentStatus === "SUCCESS") throw new OrderError("This order is already paid.", "ALREADY_PAID", 409);
  const allowed = o.method === "CASH" ? o.settings.payments.cash : o.method === "UPI" ? o.settings.payments.upi : o.settings.payments.online;
  if (!allowed) throw new OrderError(`${o.method} payments are not enabled for this restaurant.`, "METHOD_DISABLED", 400);
  await tx.insert(payments).values({ restaurantId: order.restaurantId, orderId: order.id, method: o.method, status: "SUCCESS", amount: order.total, reference: (o.reference ?? "").slice(0, 80), recordedBy: o.actorId });
  const nextStatus = order.status === "PAYMENT_PENDING" ? "PAYMENT_COMPLETED" : order.status;
  const [u] = await tx.update(orders).set({ paymentStatus: "SUCCESS", paymentMethod: o.method, status: nextStatus, updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
  await tx.insert(bills).values({ restaurantId: order.restaurantId, orderId: order.id }).onConflictDoNothing();
  await notify(order.restaurantId, "PAYMENT_SUCCESS", `Payment received for ${order.displayId}`, `${o.method} · ${(order.total / 100).toFixed(2)}`, `order:${order.id}:paid`, tx);
  return u;
}

/* ----------------------------- inventory ----------------------------- */
export async function deductInventory(tx: DbTx, order: Order, actorId: string | null, settings: Settings) {
  if (order.inventoryProcessed) return;
  const lines = order.items as OrderLine[];
  const pids = Array.from(new Set(lines.map((l) => l.productId).filter((x): x is string => !!x)));
  const recipeRows = pids.length ? await tx.select().from(recipes).where(and(eq(recipes.restaurantId, order.restaurantId), inArray(recipes.productId, pids))) : [];
  const recipeMap = new Map(recipeRows.map((r) => [r.productId, r.items]));
  const needs = computeDeductions(lines, recipeMap);
  const ids = Array.from(needs.keys()).sort(); // stable lock order
  for (const ingId of ids) {
    const qty = needs.get(ingId)!;
    const ing = (await tx.execute(sql`select id, name, current_stock, low_stock_threshold from ingredients where id = ${ingId} and restaurant_id = ${order.restaurantId} for update`)).rows[0] as
      | { id: string; name: string; current_stock: number; low_stock_threshold: number }
      | undefined;
    if (!ing) continue;
    const before = Number(ing.current_stock);
    if (before < qty && !settings.allowNegativeStock) throw new OrderError(`Not enough ${ing.name} in stock (need ${qty}, have ${before}). Adjust inventory first.`, "INSUFFICIENT_STOCK", 409);
    const after = before - qty;
    const ins = await tx
      .insert(inventoryTransactions)
      .values({ restaurantId: order.restaurantId, ingredientId: ingId, orderId: order.id, type: "ORDER_DEDUCTION", quantityBefore: before, quantityUsed: qty, quantityAfter: after, actorId, note: order.displayId })
      .onConflictDoNothing()
      .returning({ id: inventoryTransactions.id });
    if (!ins.length) continue; // already deducted (idempotent)
    await tx.update(ingredients).set({ currentStock: after, updatedAt: new Date() }).where(eq(ingredients.id, ingId));
    if (after <= Number(ing.low_stock_threshold)) {
      await notify(order.restaurantId, "LOW_STOCK", `Low stock: ${ing.name}`, `${after} left (threshold ${ing.low_stock_threshold})`, `low:${ingId}`, tx);
    }
  }
  await tx.update(orders).set({ inventoryProcessed: true }).where(eq(orders.id, order.id));
  order.inventoryProcessed = true;
}

/* ---------------------------- completion ---------------------------- */
async function onCompleted(tx: DbTx, order: Order) {
  if (order.loyaltyProcessed) return;
  const flag = await tx.update(orders).set({ loyaltyProcessed: true }).where(and(eq(orders.id, order.id), eq(orders.loyaltyProcessed, false))).returning({ id: orders.id });
  if (!flag.length) return;
  if (order.customerId) {
    const c = (await tx.execute(sql`select visits from customers where id = ${order.customerId} for update`)).rows[0] as { visits: number } | undefined;
    const prog = (await tx.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.restaurantId, order.restaurantId)).limit(1))[0];
    const prev = c?.visits ?? 0;
    const ev = evaluateVisit(prev, prog?.requiredVisits ?? 5);
    await tx
      .update(customers)
      .set({ orders: sql`${customers.orders} + 1`, totalSpend: sql`${customers.totalSpend} + ${order.total}`, visits: ev.visits, lastOrderAt: new Date() })
      .where(eq(customers.id, order.customerId));
    if (prog?.isActive && ev.unlockMilestone) {
      const r = await tx
        .insert(loyaltyRewards)
        .values({ restaurantId: order.restaurantId, customerId: order.customerId, milestone: ev.unlockMilestone, title: prog.rewardTitle })
        .onConflictDoNothing()
        .returning({ id: loyaltyRewards.id });
      if (r.length) await notify(order.restaurantId, "LOYALTY_UNLOCKED", "Loyalty reward unlocked", `${order.customerName || order.customerPhone || "A customer"} earned: ${prog.rewardTitle}`, `loyalty:${r[0].id}`, tx);
    }
  }
  const now = new Date();
  const camp = (
    await tx
      .select()
      .from(scratchCampaigns)
      .where(and(eq(scratchCampaigns.restaurantId, order.restaurantId), eq(scratchCampaigns.isActive, true), sql`(${scratchCampaigns.startsAt} is null or ${scratchCampaigns.startsAt} <= ${now})`, sql`(${scratchCampaigns.endsAt} is null or ${scratchCampaigns.endsAt} >= ${now})`, sql`(${scratchCampaigns.usageLimit} = 0 or ${scratchCampaigns.usedCount} < ${scratchCampaigns.usageLimit})`))
      .limit(1)
  )[0];
  if (camp) await tx.insert(scratchIssuances).values({ restaurantId: order.restaurantId, campaignId: camp.id, orderId: order.id }).onConflictDoNothing();
}

/* --------------------------- state transitions --------------------------- */
export async function transitionOrder(restaurantId: string, orderId: string, action: OrderAction, actorId: string | null): Promise<Order> {
  const to = ORDER_ACTIONS[action].to;
  return db.transaction(async (tx) => {
    const locked = (await tx.execute(sql`select id from orders where id = ${orderId} and restaurant_id = ${restaurantId} for update`)).rows[0];
    if (!locked) throw new OrderError("Order not found.", "NOT_FOUND", 404);
    const order = (await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
    if (order.status === to) return order; // idempotent re-click
    if (!canTransition(order.status, to)) throw new OrderError(`An order that is ${order.status.toLowerCase().replace("_", " ")} cannot be moved to ${to.toLowerCase()}.`, "INVALID_TRANSITION", 409);
    if (to === "CONFIRMED" && order.paymentTiming === "PAY_FIRST" && order.paymentStatus !== "SUCCESS" && order.source === "QR") {
      throw new OrderError("This order must be paid before it can be confirmed.", "PAYMENT_REQUIRED", 409);
    }
    if (to === "COMPLETED" && order.paymentStatus !== "SUCCESS") throw new OrderError("Collect payment before completing the order.", "PAYMENT_REQUIRED", 409);
    const rest = (await tx.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1))[0];
    const settings = resolveSettings(rest.settings);

    const [u] = await tx
      .update(orders)
      .set({ status: to, updatedAt: new Date(), ...(to === "COMPLETED" ? { completedAt: new Date() } : {}) })
      .where(eq(orders.id, orderId))
      .returning();

    if (to === settings.inventoryDeductOn || to === "COMPLETED") await deductInventory(tx, u, actorId, settings);

    if (to === "CANCELLED") {
      await tx.update(usageLedger).set({ status: "VOID" }).where(and(eq(usageLedger.orderId, orderId), eq(usageLedger.status, "CHARGED")));
      if (order.couponId) {
        const del = await tx.delete(couponRedemptions).where(and(eq(couponRedemptions.orderId, orderId))).returning({ id: couponRedemptions.id });
        if (del.length) await tx.update(coupons).set({ usageCount: sql`greatest(${coupons.usageCount} - 1, 0)` }).where(eq(coupons.id, order.couponId));
      }
      if (order.paymentStatus === "SUCCESS") {
        await tx.update(orders).set({ paymentStatus: "REFUNDED" }).where(eq(orders.id, orderId));
        await tx.update(payments).set({ status: "REFUNDED" }).where(eq(payments.orderId, orderId));
      } else if (order.paymentStatus === "PENDING") {
        await tx.update(orders).set({ paymentStatus: "CANCELLED" }).where(eq(orders.id, orderId));
      }
    }
    if (to === "CONFIRMED") await notify(restaurantId, "ORDER_CONFIRMED", `Order ${order.displayId} confirmed`, "", `order:${orderId}:confirmed`, tx);
    if (to === "READY") await notify(restaurantId, "ORDER_READY", `Order ${order.displayId} is ready`, order.tableName ? `Table ${order.tableName}` : "", `order:${orderId}:ready`, tx);
    if (to === "COMPLETED") await onCompleted(tx, u);
    if ((to === "COMPLETED" || to === "CANCELLED") && order.tableId) {
      const open = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.tableId, order.tableId), sql`${orders.status} not in ('COMPLETED','CANCELLED')`));
      if (open[0].n === 0) await tx.update(diningTables).set({ status: "FREE", updatedAt: new Date() }).where(eq(diningTables.id, order.tableId));
    }
    return (await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
  });
}

export async function collectPayment(restaurantId: string, orderId: string, method: "CASH" | "UPI" | "ONLINE", actorId: string | null, reference?: string) {
  return db.transaction(async (tx) => {
    const locked = (await tx.execute(sql`select id from orders where id = ${orderId} and restaurant_id = ${restaurantId} for update`)).rows[0];
    if (!locked) throw new OrderError("Order not found.", "NOT_FOUND", 404);
    const order = (await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
    const rest = (await tx.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1))[0];
    return recordPayment(tx, order, { method, reference, actorId, settings: resolveSettings(rest.settings) });
  });
}
