import crypto from "node:crypto";
import { repos, type DiningTable, type Order, type OrderLine, type Tx, type TenantRepositories } from "@/lib/repositories";
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
import { publicToken, sha256 } from "../auth";

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
  payment?: { method: "CASH" | "UPI"; reference?: string } | null;
  createdBy?: string | null;
  dryRun?: boolean;
};

type Writer = () => void;
const noop: Writer = () => {};

/** Stable customer id: one Firestore document per phone (or email), so upserts are idempotent. */
export const customerIdFor = (key: string) => sha256(key).slice(0, 24);
/** Deterministic inventory-ledger id: a second deduction for the same order+ingredient can never be created. */
export const deductionTxId = (orderId: string, ingredientId: string) => `${orderId}_${ingredientId}_ORDER_DEDUCTION`;
export const orderIdForKey = (restaurantId: string, key: string) => sha256(`${restaurantId}:${key}`).slice(0, 20);

export async function usageBalance(restaurantId: string) {
  const c = await repos().tenant(restaurantId).usage.getCounters();
  return { balance: c.usageBalance, orders: c.usageOrders };
}

/* =============================== create order =============================== */
export async function createOrder(input: CreateOrderInput): Promise<{ order: Order; existing: boolean }> {
  if (!input.items.length) throw new OrderError("Add at least one item to the order.", "EMPTY_ORDER");
  if (input.items.length > 60) throw new OrderError("Too many items in one order.");
  const staff = input.source !== "QR";
  const R = repos();
  const T = R.tenant(input.restaurantId);

  const rest = await R.restaurants.get(input.restaurantId);
  if (!rest) throw new OrderError("Restaurant not found.", "NOT_FOUND", 404);
  const settings = resolveSettings(rest.settings);

  /* table resolution (token for public, id for staff) — a token only resolves inside its own tenant */
  let table: DiningTable | null = null;
  if (input.tableToken) {
    table = await T.tables.getByQrToken(input.tableToken);
    if (!table || !table.isActive) throw new OrderError("This QR code is no longer valid. Please ask staff for help.", "QR_INVALID", 404);
  } else if (input.tableId) {
    table = await T.tables.get(input.tableId);
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
  }

  /* catalogue — always loaded from Firestore under THIS tenant; ids supplied by the client that do not exist here are rejected */
  const productIds = Array.from(new Set(input.items.map((i) => i.productId).filter((x): x is string => !!x)));
  const prods = await T.products.getMany(productIds);
  const prodMap = new Map(prods.map((p) => [p.id, p]));
  const groups = await T.variantGroups.getMany(prods.flatMap((p) => p.variantGroupIds));
  const groupMap = new Map<string, VariantGroupLike>(groups.map((g) => [g.id, g]));
  const adds = await T.addons.getMany(prods.flatMap((p) => p.addonIds));
  const addonMap = new Map<string, AddonLike>(adds.map((a) => [a.id, a]));
  const cats = await T.categories.getMany(prods.map((p) => p.categoryId).filter((x): x is string => !!x));
  const catName = new Map(cats.map((c) => [c.id, c.name]));

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

  const phone = normalizePhone(input.customer?.phone ?? "");
  const email = (input.customer?.email ?? "").trim().toLowerCase();
  const customerKey = phone || email;
  const customerId = customerKey ? customerIdFor(customerKey) : null;
  const customerName = input.customer?.name?.trim().slice(0, 80) ?? "";
  const couponCode = input.couponCode?.trim().toUpperCase() ?? "";

  const orderId = input.idempotencyKey ? orderIdForKey(input.restaurantId, input.idempotencyKey) : T.orders.newId();

  return R.transaction(async (tx) => {
    /* ---------------- reads ---------------- */
    if (input.idempotencyKey) {
      const ex = await T.orders.get(orderId, tx);
      if (ex) return { order: ex, existing: true };
    }
    const counters = await T.usage.getCounters(tx);
    if (!staff && settings.fees.blockOnThreshold && counters.usageBalance >= settings.fees.thresholdMinor) {
      throw new OrderError("This restaurant cannot accept new online orders right now. Please order at the counter.", "USAGE_BLOCKED", 403);
    }
    const coupon = couponCode ? await T.coupons.get(couponCode, tx) : null;
    const used = coupon ? await T.coupons.countRedemptionsForCustomer(coupon.id, customerKey, tx) : 0;
    const customer = customerId ? await T.customers.get(customerId, tx) : null;
    const liveTable = table ? await T.tables.get(table.id, tx) : null;
    if (table && !liveTable) throw new OrderError("Table not found.", "TABLE_INVALID", 404);

    /* ---------------- compute (all trusted, server side) ---------------- */
    let couponDiscount = 0;
    let appliedCouponId: string | null = null;
    if (couponCode) {
      const res = validateCoupon(coupon, { lines, subtotal, customerRedemptions: used });
      if (!res.ok) throw new OrderError(res.reason, "COUPON_INVALID");
      if (coupon!.perCustomerLimit > 0 && !customerKey) throw new OrderError("Enter your phone number to use this coupon.", "COUPON_NEEDS_CUSTOMER");
      appliedCouponId = coupon!.id;
      couponDiscount = res.discount;
    }
    const fee = calculatePlatformFee({ mode: settings.fees.mode, amountMinor: settings.fees.amountMinor, eligible: input.source === "QR" });
    const manual = staff ? Math.max(0, Math.round(input.manualDiscount ?? 0)) : 0;
    const totals = calculateTotals({ subtotal, couponDiscount, manualDiscount: manual, tax: settings.tax, customerFee: fee.customerFee });
    const seq = counters.orderSeq + 1;
    const displayId = formatOrderId(settings.orderPrefix, seq);
    const status = initialOrderStatus(input.source, settings.paymentTiming);
    const now = new Date();

    const order: Order = {
      id: orderId,
      restaurantId: input.restaurantId,
      displayId,
      publicToken: publicToken(),
      idempotencyKey: input.idempotencyKey ?? null,
      source: input.source,
      status,
      paymentStatus: "PENDING",
      paymentMethod: "",
      tableId: table?.id ?? null,
      tableName: table?.name ?? "",
      customerId,
      customerName,
      customerPhone: phone,
      customerEmail: email,
      items: lines,
      customerNotes: staff ? "" : (input.notes ?? "").slice(0, 500),
      staffNotes: staff ? (input.notes ?? input.staffNotes ?? "").slice(0, 500) : "",
      kitchenNotes: "",
      couponId: appliedCouponId,
      couponCode: appliedCouponId ? coupon!.code : "",
      subtotal: totals.subtotal,
      discount: totals.discount,
      manualDiscount: totals.manualDiscount,
      tax: totals.tax,
      taxLabel: settings.tax.enabled ? `${settings.tax.name} ${settings.tax.ratePct}%` : "",
      platformFee: totals.platformFee,
      total: totals.total,
      paymentTiming: settings.paymentTiming,
      inventoryProcessed: false,
      loyaltyProcessed: false,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    const writers: Writer[] = [];
    if (input.payment && staff) writers.push(planPayment(T, order, { method: input.payment.method, reference: input.payment.reference, actorId: input.createdBy ?? null, settings }, tx));
    if (status === settings.inventoryDeductOn) writers.push(await planDeduction(tx, T, order, input.createdBy ?? null, settings));

    if (input.dryRun) return { order, existing: false };

    /* ---------------- writes ---------------- */
    writers.forEach((w) => w());
    T.usage.setCounters({ orderSeq: seq, usageBalance: counters.usageBalance + fee.ledgerAmount, usageOrders: counters.usageOrders + (fee.ledgerAmount > 0 ? 1 : 0) }, tx);
    if (fee.ledgerAmount > 0) {
      await T.usage.create(orderId, { orderId, orderDisplayId: displayId, amount: fee.ledgerAmount, mode: settings.fees.mode, status: "CHARGED", settlementId: null, createdAt: now }, tx);
    }
    if (appliedCouponId && coupon) {
      await T.coupons.update(coupon.id, { usageCount: coupon.usageCount + 1, updatedAt: now }, tx);
      T.coupons.addRedemption(coupon.id, orderId, customerKey, tx);
    }
    if (customerId) {
      if (customer) {
        if (customerName) await T.customers.update(customerId, { name: customerName }, tx);
      } else await T.customers.create(customerId, { phone, email, name: customerName, orders: 0, totalSpend: 0, visits: 0, lastOrderAt: null, createdAt: now }, tx);
    }
    if (liveTable) await T.tables.update(liveTable.id, { status: "OCCUPIED", updatedAt: now }, tx);
    if (input.source === "QR") await T.notifications.push(`order:${orderId}:received`, { type: "ORDER_RECEIVED", title: `New order ${displayId}`, body: table ? `Table ${table.name}` : "Online order" }, tx);
    await T.orders.save(order, tx);
    return { order, existing: false };
  });
}

/* ================================== payments ================================== */
/**
 * Plans a payment write (no reads required). Only CASH and manual UPI confirmation are recorded here;
 * a UPI QR / deep link is NOT proof of payment, so staff must explicitly confirm receipt. Online payments are
 * only ever completed by the provider webhook (see services/payments.ts).
 */
export function planPayment(
  T: TenantRepositories,
  order: Order,
  o: { method: "CASH" | "UPI"; reference?: string; actorId: string | null; settings: Settings },
  tx: Tx,
): Writer {
  if (order.status === "CANCELLED") throw new OrderError("This order was cancelled.", "ORDER_CANCELLED", 409);
  if (order.paymentStatus === "SUCCESS") throw new OrderError("This order is already paid.", "ALREADY_PAID", 409);
  const allowed = o.method === "CASH" ? o.settings.payments.cash : o.settings.payments.upi;
  if (!allowed) throw new OrderError(`${o.method} payments are not enabled for this restaurant.`, "METHOD_DISABLED", 400);
  const now = new Date();
  const nextStatus = order.status === "PAYMENT_PENDING" ? "PAYMENT_COMPLETED" : order.status;
  // reflect immediately so later planners see the post-payment state
  order.paymentStatus = "SUCCESS";
  order.paymentMethod = o.method;
  order.status = nextStatus;
  order.updatedAt = now;
  return () => {
    void T.payments.create(null, { orderId: order.id, method: o.method, status: "SUCCESS", amount: order.total, reference: (o.reference ?? "").slice(0, 80), provider: o.method, providerRef: "", recordedBy: o.actorId, createdAt: now, updatedAt: now }, tx);
    void T.bills.set(order.id, { orderId: order.id, emailedTo: "", emailedAt: null, createdAt: now }, tx);
    void T.notifications.push(`order:${order.id}:paid`, { type: "PAYMENT_SUCCESS", title: `Payment received for ${order.displayId}`, body: `${o.method} · ${(order.total / 100).toFixed(2)}` }, tx);
  };
}

export async function collectPayment(restaurantId: string, orderId: string, method: "CASH" | "UPI", actorId: string | null, reference?: string) {
  const R = repos();
  const T = R.tenant(restaurantId);
  return R.transaction(async (tx) => {
    const order = await T.orders.get(orderId, tx);
    if (!order) throw new OrderError("Order not found.", "NOT_FOUND", 404);
    const rest = await R.restaurants.get(restaurantId, tx);
    planPayment(T, order, { method, reference, actorId, settings: resolveSettings(rest?.settings) }, tx)();
    await T.orders.save(order, tx);
    return order;
  });
}

/* ================================== inventory ================================== */
/**
 * Plans an idempotent inventory deduction. Reads happen now (inside the transaction); the returned writer
 * performs the writes. A deduction can never be applied twice: (1) `order.inventoryProcessed`,
 * (2) a deterministic ledger id per (order, ingredient) that is created, never overwritten.
 */
export async function planDeduction(tx: Tx, T: TenantRepositories, order: Order, actorId: string | null, settings: Settings): Promise<Writer> {
  if (order.inventoryProcessed) return noop;
  const pids = Array.from(new Set(order.items.map((l) => l.productId).filter((x): x is string => !!x)));
  const recipeRows = await T.recipes.getMany(pids, tx);
  const needs = computeDeductions(order.items, new Map(recipeRows.map((r) => [r.productId, r.items])));
  const ids = Array.from(needs.keys()).sort();
  const ings = new Map((await T.ingredients.getMany(ids, tx)).map((i) => [i.id, i]));
  const already = new Set((await T.inventoryTransactions.getMany(ids.map((i) => deductionTxId(order.id, i)), tx)).map((t) => t.ingredientId));
  const steps: { id: string; name: string; before: number; qty: number; after: number; threshold: number }[] = [];
  for (const ingId of ids) {
    const ing = ings.get(ingId);
    if (!ing || already.has(ingId)) continue;
    const qty = needs.get(ingId)!;
    if (ing.currentStock < qty && !settings.allowNegativeStock) {
      throw new OrderError(`Not enough ${ing.name} in stock (need ${qty}, have ${ing.currentStock}). Adjust inventory first.`, "INSUFFICIENT_STOCK", 409);
    }
    steps.push({ id: ingId, name: ing.name, before: ing.currentStock, qty, after: ing.currentStock - qty, threshold: ing.lowStockThreshold });
  }
  order.inventoryProcessed = true;
  return () => {
    const now = new Date();
    for (const s of steps) {
      void T.inventoryTransactions.create(deductionTxId(order.id, s.id), { ingredientId: s.id, orderId: order.id, type: "ORDER_DEDUCTION", quantityBefore: s.before, quantityUsed: s.qty, quantityAfter: s.after, note: order.displayId, actorId, createdAt: now }, tx);
      void T.ingredients.update(s.id, { currentStock: s.after, updatedAt: now }, tx);
      if (s.after <= s.threshold) void T.notifications.push(`low:${s.id}`, { type: "LOW_STOCK", title: `Low stock: ${s.name}`, body: `${s.after} left (threshold ${s.threshold})` }, tx);
    }
  };
}

/* ================================== completion ================================== */
/** Loyalty visit + scratch card issuance. Runs once per order (`loyaltyProcessed`) and uses deterministic ids. */
export async function planCompletion(tx: Tx, T: TenantRepositories, order: Order): Promise<Writer> {
  if (order.loyaltyProcessed) return noop;
  const customer = order.customerId ? await T.customers.get(order.customerId, tx) : null;
  const prog = await T.loyalty.getProgramTx(tx);
  const ev = evaluateVisit(customer?.visits ?? 0, prog?.requiredVisits ?? 5);
  const rewardId = order.customerId && ev.unlockMilestone ? T.loyalty.rewardId(order.customerId, ev.unlockMilestone) : null;
  const existingReward = rewardId ? await T.loyalty.get(rewardId, tx) : null;
  const now = new Date();
  const campaigns = (await T.scratchCampaigns.list({ where: [["isActive", "==", true]] }, tx))
    .filter((c) => (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt >= now) && (c.usageLimit === 0 || c.usedCount < c.usageLimit))
    .sort((a, b) => +a.createdAt - +b.createdAt);
  const existingCard = await T.scratchCards.get(order.id, tx);
  order.loyaltyProcessed = true;
  return () => {
    if (customer && order.customerId) {
      void T.customers.update(order.customerId, { orders: customer.orders + 1, totalSpend: customer.totalSpend + order.total, visits: ev.visits, lastOrderAt: now }, tx);
      if (prog?.isActive && rewardId && ev.unlockMilestone && !existingReward) {
        void T.loyalty.create(rewardId, { customerId: order.customerId, milestone: ev.unlockMilestone, title: prog.rewardTitle, status: "UNLOCKED", code: "", createdAt: now, claimedAt: null }, tx);
        void T.notifications.push(`loyalty:${rewardId}`, { type: "LOYALTY_UNLOCKED", title: "Loyalty reward unlocked", body: `${order.customerName || order.customerPhone || "A customer"} earned: ${prog.rewardTitle}` }, tx);
      }
    }
    if (campaigns[0] && !existingCard) {
      void T.scratchCards.create(order.id, { campaignId: campaigns[0].id, orderId: order.id, status: "ISSUED", reward: "", code: "", createdAt: now }, tx);
    }
  };
}

/* ============================ state transitions ============================ */
export async function transitionOrder(restaurantId: string, orderId: string, action: OrderAction, actorId: string | null): Promise<Order> {
  const to = ORDER_ACTIONS[action].to;
  const R = repos();
  const T = R.tenant(restaurantId);
  return R.transaction(async (tx) => {
    const order = await T.orders.get(orderId, tx);
    if (!order) throw new OrderError("Order not found.", "NOT_FOUND", 404);
    if (order.status === to) return order; // idempotent re-click
    if (!canTransition(order.status, to)) throw new OrderError(`An order that is ${order.status.toLowerCase().replace("_", " ")} cannot be moved to ${to.toLowerCase()}.`, "INVALID_TRANSITION", 409);
    if (to === "CONFIRMED" && order.paymentTiming === "PAY_FIRST" && order.paymentStatus !== "SUCCESS" && order.source === "QR") {
      throw new OrderError("This order must be paid before it can be confirmed.", "PAYMENT_REQUIRED", 409);
    }
    if (to === "COMPLETED" && order.paymentStatus !== "SUCCESS") throw new OrderError("Collect payment before completing the order.", "PAYMENT_REQUIRED", 409);

    /* ---------------- reads ---------------- */
    const rest = await R.restaurants.get(restaurantId, tx);
    const settings = resolveSettings(rest?.settings);
    const now = new Date();
    const u: Order = { ...order, status: to, updatedAt: now, completedAt: to === "COMPLETED" ? now : order.completedAt };
    const writers: Writer[] = [];

    if (to === settings.inventoryDeductOn || to === "COMPLETED") writers.push(await planDeduction(tx, T, u, actorId, settings));
    if (to === "COMPLETED") writers.push(await planCompletion(tx, T, u));

    if (to === "CANCELLED") {
      const usage = await T.usage.get(orderId, tx);
      const counters = await T.usage.getCounters(tx);
      const coupon = order.couponId ? await T.coupons.get(order.couponId, tx) : null;
      const redemption = order.couponId ? await T.coupons.getRedemption(order.couponId, orderId, tx) : null;
      const pays = await T.payments.list({ where: [["orderId", "==", orderId]] }, tx);
      const wasPaid = order.paymentStatus === "SUCCESS";
      if (wasPaid) u.paymentStatus = "REFUNDED";
      else if (order.paymentStatus === "PENDING" || order.paymentStatus === "PROCESSING") u.paymentStatus = "CANCELLED";
      writers.push(() => {
        if (usage && usage.status === "CHARGED") {
          void T.usage.update(orderId, { status: "VOID" }, tx);
          void T.usage.setCounters({ ...counters, usageBalance: Math.max(0, counters.usageBalance - usage.amount), usageOrders: Math.max(0, counters.usageOrders - 1) }, tx);
        }
        if (coupon && redemption) {
          T.coupons.removeRedemption(coupon.id, orderId, tx);
          void T.coupons.update(coupon.id, { usageCount: Math.max(0, coupon.usageCount - 1), updatedAt: now }, tx);
        }
        for (const p of pays) {
          if (p.status === "SUCCESS") void T.payments.update(p.id, { status: "REFUNDED", updatedAt: now }, tx);
          else if (p.status === "PENDING" || p.status === "PROCESSING") void T.payments.update(p.id, { status: "CANCELLED", updatedAt: now }, tx);
        }
      });
    }

    if ((to === "COMPLETED" || to === "CANCELLED") && order.tableId) {
      const siblings = await T.orders.listForTable(order.tableId, tx);
      const table = await T.tables.get(order.tableId, tx);
      const open = siblings.filter((o) => o.id !== order.id && !["COMPLETED", "CANCELLED"].includes(o.status)).length;
      if (table && open === 0) writers.push(() => void T.tables.update(table.id, { status: "FREE", updatedAt: now }, tx));
    }

    /* ---------------- writes ---------------- */
    writers.forEach((w) => w());
    if (to === "CONFIRMED") await T.notifications.push(`order:${orderId}:confirmed`, { type: "ORDER_CONFIRMED", title: `Order ${order.displayId} confirmed` }, tx);
    if (to === "READY") await T.notifications.push(`order:${orderId}:ready`, { type: "ORDER_READY", title: `Order ${order.displayId} is ready`, body: order.tableName ? `Table ${order.tableName}` : "" }, tx);
    await T.orders.save(u, tx);
    return u;
  });
}
