import { beforeEach, describe, expect, it } from "vitest";
import { createOrder, transitionOrder, collectPayment, usageBalance, deductionTxId, orderIdForKey } from "@/lib/server/services/orders";
import { OrderError } from "@/lib/calculations";
import { createWorld, setRestaurantSettings, type World } from "./helpers/seed";

let w: World;
beforeEach(async () => {
  w = await createWorld();
});

const coffee = (w: World, extra: object = {}) => ({ productId: w.ids.coffee, qty: 2, variants: { [w.ids.size]: [w.ids.large] }, addonIds: [w.ids.cheese], ...extra });
const qr = (w: World, o: Partial<Parameters<typeof createOrder>[0]> = {}) =>
  createOrder({ restaurantId: w.rid, source: "QR", tableToken: w.tableToken, items: [coffee(w)], idempotencyKey: `key-${Math.random()}`, customer: { name: "Asha", phone: "9876543210" }, ...o });

describe("order totals are computed on the server", () => {
  it("prices variants, add-ons and quantity from stored data (coffee 100 + large 30 + cheese 20, x2)", async () => {
    const { order } = await qr(w);
    expect(order.subtotal).toBe(2 * (10000 + 3000 + 2000));
    expect(order.platformFee).toBe(100); // ₹1 from env default, customer-based
    expect(order.total).toBe(order.subtotal - order.discount + order.tax + order.platformFee);
    expect(order.items[0].unitPrice).toBe(15000);
    expect(order.items[0].variants[0].optionName).toBe("Large");
  });

  it("rejects unknown, inactive and cross-tenant products and bad variant selections", async () => {
    await expect(qr(w, { items: [{ productId: "does-not-exist", qty: 1 }] })).rejects.toBeInstanceOf(OrderError);
    await expect(qr(w, { items: [{ productId: w.ids.hidden, qty: 1 }] })).rejects.toBeInstanceOf(OrderError);
    await expect(qr(w, { items: [{ productId: w.ids.coffee, qty: 1 }] })).rejects.toThrow(/Size|required/i); // required variant missing
    await expect(qr(w, { items: [{ productId: w.ids.coffee, qty: 1, variants: { [w.ids.size]: ["nope"] } }] })).rejects.toBeInstanceOf(OrderError);
    await expect(qr(w, { items: [{ productId: w.ids.sandwich, qty: 1, addonIds: [w.ids.cheese] }] })).rejects.toBeInstanceOf(OrderError); // add-on not offered on this product
  });

  it("customers cannot create custom-priced items or manual discounts", async () => {
    await expect(qr(w, { items: [{ custom: { name: "Free", price: 0 }, qty: 1 }] })).rejects.toBeInstanceOf(OrderError);
    const { order } = await qr(w, { manualDiscount: 99999 });
    expect(order.manualDiscount).toBe(0);
  });

  it("dry-run quotes write nothing", async () => {
    const before = w.db.dump().length;
    const { order } = await qr(w, { dryRun: true, idempotencyKey: undefined });
    expect(order.total).toBeGreaterThan(0);
    expect(w.db.dump().length).toBe(before);
  });
});

describe("idempotency", () => {
  it("the same idempotency key creates exactly one order, one usage record and one fee", async () => {
    const key = "same-key-12345";
    const results = await Promise.all([qr(w, { idempotencyKey: key }), qr(w, { idempotencyKey: key }), qr(w, { idempotencyKey: key })]);
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(results.filter((r) => !r.existing)).toHaveLength(1);
    expect(results[0].order.id).toBe(orderIdForKey(w.rid, key));
    expect(await w.T.usage.list()).toHaveLength(1);
    expect(await usageBalance(w.rid)).toEqual({ balance: 100, orders: 1 });
    expect((await w.T.orders.list()).length).toBe(1);
  });

  it("different keys get distinct, sequential display ids", async () => {
    const a = await qr(w);
    const b = await qr(w);
    expect(a.order.displayId).not.toBe(b.order.displayId);
    expect(a.order.displayId).toMatch(/^CP-\d{6}$/);
  });
});

describe("platform fee & usage ledger", () => {
  it("CUSTOMER_BASED adds the fee to the bill and records usage referencing the order", async () => {
    const { order } = await qr(w);
    const rec = await w.T.usage.get(order.id);
    expect(rec).toMatchObject({ orderId: order.id, amount: 100, mode: "CUSTOMER_BASED", status: "CHARGED" });
  });

  it("STORE_BASED does not change the customer's total but still records usage", async () => {
    await setRestaurantSettings(w, { fees: { mode: "STORE_BASED" } });
    const { order } = await qr(w);
    expect(order.platformFee).toBe(0);
    expect(order.total).toBe(order.subtotal);
    expect(await w.T.usage.get(order.id)).toMatchObject({ amount: 100, mode: "STORE_BASED" });
  });

  it("only QR orders are charged; POS orders create no usage record", async () => {
    const { order } = await createOrder({ restaurantId: w.rid, source: "POS", items: [{ productId: w.ids.sandwich, qty: 1 }], idempotencyKey: "pos-key-0001" });
    expect(order.platformFee).toBe(0);
    expect(await w.T.usage.get(order.id)).toBeNull();
    expect(await usageBalance(w.rid)).toEqual({ balance: 0, orders: 0 });
  });

  it("blocks new QR orders once the threshold is reached (staff orders still work)", async () => {
    await setRestaurantSettings(w, { fees: { blockOnThreshold: true } });
    await w.T.usage.setCounters({ orderSeq: 0, usageBalance: 50000, usageOrders: 500 });
    await expect(qr(w)).rejects.toMatchObject({ code: "USAGE_BLOCKED" });
    await expect(createOrder({ restaurantId: w.rid, source: "POS", items: [{ productId: w.ids.sandwich, qty: 1 }], idempotencyKey: "pos-key-0002" })).resolves.toBeTruthy();
  });

  it("the fee amount comes from env, not from tenant settings", async () => {
    await setRestaurantSettings(w, { fees: { amountMinor: 1 } }); // a tenant trying to lower the fee
    const { order } = await qr(w);
    expect(order.platformFee).toBe(100);
  });
});

describe("geofence", () => {
  beforeEach(async () => {
    await setRestaurantSettings(w, { geofence: { enabled: true, latitude: 12.9716, longitude: 77.5946, radiusMeters: 100 } });
  });
  it("blocks missing and distant locations, allows nearby, and never stores coordinates", async () => {
    await expect(qr(w)).rejects.toBeInstanceOf(OrderError);
    await expect(qr(w, { location: { lat: 13.5, lng: 77.5946 } })).rejects.toBeInstanceOf(OrderError);
    const { order } = await qr(w, { location: { lat: 12.97165, lng: 77.59465 } });
    const stored = JSON.stringify(w.db.dump(`restaurants/${w.rid}`));
    expect(stored).not.toContain("12.97165");
    expect(stored).not.toContain("77.59465");
    expect(order.id).toBeTruthy();
  });
  it("staff orders are not geofenced", async () => {
    await expect(createOrder({ restaurantId: w.rid, source: "POS", items: [{ productId: w.ids.sandwich, qty: 1 }], idempotencyKey: "pos-key-0003" })).resolves.toBeTruthy();
  });
});

describe("coupons", () => {
  const couponDoc = (over: object = {}) => ({
    name: "Ten", description: "", discountType: "PERCENTAGE" as const, discountValue: 10, maxDiscount: 0, minOrderValue: 0, usageLimit: 1, usageCount: 0, perCustomerLimit: 0,
    validFrom: null, validUntil: null, applicableProducts: [], applicableCategories: [], isActive: true, code: "SAVE10", createdAt: new Date(), updatedAt: new Date(), ...over,
  });
  it("applies a percentage discount, enforces the usage limit and restores it on cancel", async () => {
    await w.T.coupons.create("SAVE10", couponDoc());
    const a = await qr(w, { couponCode: "save10" });
    expect(a.order.discount).toBe(Math.round(a.order.subtotal * 0.1));
    await expect(qr(w, { couponCode: "SAVE10" })).rejects.toBeInstanceOf(OrderError); // limit 1 reached
    await transitionOrder(w.rid, a.order.id, "cancel", w.ownerId);
    const b = await qr(w, { couponCode: "SAVE10" });
    expect(b.order.discount).toBeGreaterThan(0);
  });
  it("does not let a coupon be redeemed twice by racing requests", async () => {
    await w.T.coupons.create("SAVE10", couponDoc());
    const res = await Promise.allSettled([qr(w, { couponCode: "SAVE10" }), qr(w, { couponCode: "SAVE10" })]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await w.T.coupons.get("SAVE10"))!.usageCount).toBe(1);
  });
  it("rejects unknown and expired coupons", async () => {
    await expect(qr(w, { couponCode: "NOPE" })).rejects.toBeInstanceOf(OrderError);
    await w.T.coupons.create("OLD", couponDoc({ code: "OLD", validUntil: new Date(Date.now() - 86400_000) }));
    await expect(qr(w, { couponCode: "OLD" })).rejects.toBeInstanceOf(OrderError);
  });
});

describe("order state machine, payments and inventory", () => {
  const stock = async (id: string) => (await w.T.ingredients.get(id))!.currentStock;

  it("walks PLACED → CONFIRMED → PREPARING → READY → SERVED → COMPLETED and blocks illegal jumps", async () => {
    const { order } = await qr(w);
    expect(order.status).toBe("PLACED");
    await expect(transitionOrder(w.rid, order.id, "complete", w.ownerId)).rejects.toBeInstanceOf(OrderError);
    await expect(transitionOrder(w.rid, order.id, "ready", w.ownerId)).rejects.toBeInstanceOf(OrderError);
    expect((await transitionOrder(w.rid, order.id, "confirm", w.ownerId)).status).toBe("CONFIRMED");
    expect((await transitionOrder(w.rid, order.id, "start", w.ownerId)).status).toBe("PREPARING");
    expect((await transitionOrder(w.rid, order.id, "ready", w.ownerId)).status).toBe("READY");
    expect((await transitionOrder(w.rid, order.id, "serve", w.ownerId)).status).toBe("SERVED");
    await expect(transitionOrder(w.rid, order.id, "complete", w.ownerId)).rejects.toThrow(/payment/i); // unpaid orders cannot complete
    await collectPayment(w.rid, order.id, "CASH", w.ownerId);
    expect((await transitionOrder(w.rid, order.id, "complete", w.ownerId)).status).toBe("COMPLETED");
    await expect(transitionOrder(w.rid, order.id, "cancel", w.ownerId)).rejects.toBeInstanceOf(OrderError);
  });

  it("deducts recipe quantities exactly once (2 coffees = 400 ml milk, 30 g beans, 20 g sugar)", async () => {
    const { order } = await qr(w);
    await transitionOrder(w.rid, order.id, "confirm", w.ownerId);
    await transitionOrder(w.rid, order.id, "start", w.ownerId); // default deduct point
    expect([await stock(w.ids.milk), await stock(w.ids.beans), await stock(w.ids.sugar)]).toEqual([600, 470, 280]);
    await transitionOrder(w.rid, order.id, "ready", w.ownerId);
    await transitionOrder(w.rid, order.id, "serve", w.ownerId);
    await collectPayment(w.rid, order.id, "UPI", w.ownerId, "UTR123456");
    await transitionOrder(w.rid, order.id, "complete", w.ownerId); // COMPLETED also tries to deduct — must be a no-op
    expect([await stock(w.ids.milk), await stock(w.ids.beans), await stock(w.ids.sugar)]).toEqual([600, 470, 280]);
    const ledger = await w.T.inventoryTransactions.list();
    expect(ledger.filter((t) => t.type === "ORDER_DEDUCTION")).toHaveLength(3);
    expect(ledger.map((t) => t.id)).toContain(deductionTxId(order.id, w.ids.milk));
  });

  it("refuses to deduct below zero unless negative stock is allowed", async () => {
    await w.T.ingredients.update(w.ids.milk, { currentStock: 100 });
    const { order } = await qr(w);
    await transitionOrder(w.rid, order.id, "confirm", w.ownerId);
    await expect(transitionOrder(w.rid, order.id, "start", w.ownerId)).rejects.toBeInstanceOf(OrderError);
    expect(await stock(w.ids.milk)).toBe(100);
    expect((await w.T.orders.get(order.id))!.status).toBe("CONFIRMED"); // transaction rolled back as a whole
  });

  it("payments are recorded once and the bill is created", async () => {
    const { order } = await qr(w);
    const paid = await collectPayment(w.rid, order.id, "CASH", w.ownerId);
    expect(paid.paymentStatus).toBe("SUCCESS");
    await expect(collectPayment(w.rid, order.id, "CASH", w.ownerId)).rejects.toBeInstanceOf(OrderError);
    expect(await w.T.payments.list()).toHaveLength(1);
    expect(await w.T.bills.get(order.id)).toBeTruthy();
  });

  it("cancelling voids the usage record, reverses the balance and frees the table", async () => {
    const { order } = await qr(w);
    expect((await w.T.tables.get(w.tableId))!.status).toBe("OCCUPIED");
    await transitionOrder(w.rid, order.id, "cancel", w.ownerId);
    expect((await w.T.usage.get(order.id))!.status).toBe("VOID");
    expect(await usageBalance(w.rid)).toEqual({ balance: 0, orders: 0 });
    expect((await w.T.tables.get(w.tableId))!.status).toBe("FREE");
  });

  it("PAY_FIRST QR orders wait for payment and cannot be confirmed by staff before it", async () => {
    await setRestaurantSettings(w, { paymentTiming: "PAY_FIRST" });
    const { order } = await qr(w);
    expect(order.status).toBe("PAYMENT_PENDING");
    await expect(transitionOrder(w.rid, order.id, "confirm", w.ownerId)).rejects.toBeInstanceOf(OrderError);
  });
});

describe("loyalty and scratch cards", () => {
  async function completeOrder(phone: string) {
    const { order } = await qr(w, { customer: { name: "Asha", phone }, items: [{ productId: w.ids.sandwich, qty: 1 }] });
    await collectPayment(w.rid, order.id, "CASH", w.ownerId);
    for (const a of ["confirm", "start", "ready", "serve", "complete"] as const) await transitionOrder(w.rid, order.id, a, w.ownerId);
    return order;
  }

  it("unlocks a reward exactly at the milestone and never duplicates it", async () => {
    await w.T.loyalty.saveProgram({ requiredVisits: 2, rewardTitle: "Free coffee", rewardItem: "", isActive: true });
    await completeOrder("9000000001");
    expect(await w.T.loyalty.list()).toHaveLength(0);
    await completeOrder("9000000001");
    const rewards = await w.T.loyalty.list();
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({ status: "UNLOCKED", milestone: 2, title: "Free coffee" });
    expect(rewards[0].id).toMatch(/_2$/);
    await completeOrder("9000000001"); // 3rd visit: no new reward until 4
    expect(await w.T.loyalty.list()).toHaveLength(1);
  });

  it("does nothing when the programme is inactive", async () => {
    await w.T.loyalty.saveProgram({ requiredVisits: 1, rewardTitle: "x", rewardItem: "", isActive: false });
    await completeOrder("9000000002");
    expect(await w.T.loyalty.list()).toHaveLength(0);
  });

  it("issues one scratch card per completed order from an active campaign", async () => {
    const now = new Date();
    await w.T.scratchCampaigns.create("camp1", { name: "Launch", startsAt: null, endsAt: null, rewards: [{ label: "10% off", probability: 100 }], usageLimit: 0, usedCount: 0, isActive: true, createdAt: now, updatedAt: now });
    const order = await completeOrder("9000000003");
    const card = await w.T.scratchCards.get(order.id);
    expect(card).toMatchObject({ orderId: order.id, campaignId: "camp1", status: "ISSUED", reward: "" }); // reward is NOT chosen until the server reveals it
    expect(await w.T.scratchCards.list()).toHaveLength(1);
  });
});
