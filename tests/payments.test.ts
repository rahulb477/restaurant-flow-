import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/config/env";
import { getPaymentProvider } from "@/lib/server/providers";
import { startOnlinePayment, applyPaymentEvent } from "@/lib/server/services/payments";
import { createOrder, collectPayment, transitionOrder } from "@/lib/server/services/orders";
import { POST as webhook } from "@/app/api/payments/webhook/route";
import { createWorld, setRestaurantSettings, type World } from "./helpers/seed";

const ENV = { PAYMENT_PROVIDER: "razorpay", PAYMENT_KEY_ID: "rzp_test_id", PAYMENT_SECRET_KEY: "rzp_secret", PAYMENT_WEBHOOK_SECRET: "whsec_test" };
const saved: Record<string, string | undefined> = {};
let w: World;

beforeEach(async () => {
  for (const k of Object.keys(ENV)) saved[k] = process.env[k];
  Object.assign(process.env, ENV);
  resetServerEnvCache();
  w = await createWorld({ settings: { payments: { online: true } } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "plink_1", short_url: "https://rzp.io/i/abc" }), { status: 200 })));
});
afterEach(() => {
  for (const k of Object.keys(ENV)) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  resetServerEnvCache();
  vi.unstubAllGlobals();
});

const qrOrder = () => createOrder({ restaurantId: w.rid, source: "QR", tableToken: w.tableToken, items: [{ productId: w.ids.sandwich, qty: 1 }], idempotencyKey: `k-${Math.random()}` });
const sign = (body: string) => crypto.createHmac("sha256", ENV.PAYMENT_WEBHOOK_SECRET).update(body).digest("hex");
const paidEvent = (orderId: string, amount: number, ref = "plink_1") => ({ event: "payment_link.paid", payload: { payment_link: { entity: { id: ref, amount, notes: { restaurantId: w.rid, orderId } } } } });

describe("payment provider abstraction", () => {
  it("is selected only by PAYMENT_PROVIDER and only when fully configured", () => {
    expect(getPaymentProvider()?.name).toBe("razorpay");
    delete process.env.PAYMENT_SECRET_KEY;
    resetServerEnvCache();
    expect(getPaymentProvider()).toBeNull();
    process.env.PAYMENT_SECRET_KEY = ENV.PAYMENT_SECRET_KEY;
    process.env.PAYMENT_PROVIDER = "unknown-psp";
    resetServerEnvCache();
    expect(getPaymentProvider()).toBeNull();
  });

  it("verifies webhook signatures over the raw body", () => {
    const p = getPaymentProvider()!;
    const raw = JSON.stringify(paidEvent("o1", 100));
    expect(p.verifyWebhook(raw, sign(raw))).toBe(true);
    expect(p.verifyWebhook(raw + " ", sign(raw))).toBe(false);
    expect(p.verifyWebhook(raw, null)).toBe(false);
    expect(p.verifyWebhook(raw, "00")).toBe(false);
  });
});

describe("online payment lifecycle", () => {
  it("starts a PROCESSING payment from the STORED order total and returns the provider URL", async () => {
    const { order } = await qrOrder();
    const r = await startOnlinePayment({ restaurantId: w.rid, orderId: order.id, returnUrl: "https://app.test/track/x" });
    expect(r.url).toBe("https://rzp.io/i/abc");
    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(sent.amount).toBe(order.total);
    const [pay] = await w.T.payments.list();
    expect(pay).toMatchObject({ method: "ONLINE", status: "PROCESSING", amount: order.total, providerRef: "plink_1" });
    expect((await w.T.orders.get(order.id))!.paymentStatus).toBe("PROCESSING");
  });

  it("success webhook marks the order paid exactly once, even when replayed", async () => {
    const { order } = await qrOrder();
    await startOnlinePayment({ restaurantId: w.rid, orderId: order.id, returnUrl: "https://app.test/t" });
    const ev = { restaurantId: w.rid, orderId: order.id, providerRef: "plink_1", status: "SUCCESS" as const, amountMinor: order.total };
    await applyPaymentEvent(ev);
    await applyPaymentEvent(ev);
    const o = (await w.T.orders.get(order.id))!;
    expect(o.paymentStatus).toBe("SUCCESS");
    expect(o.paymentMethod).toBe("ONLINE");
    expect(await w.T.payments.list()).toHaveLength(1);
    expect(await w.T.bills.get(order.id)).toBeTruthy();
  });

  it("a wrong amount never marks the order paid", async () => {
    const { order } = await qrOrder();
    await startOnlinePayment({ restaurantId: w.rid, orderId: order.id, returnUrl: "https://app.test/t" });
    await applyPaymentEvent({ restaurantId: w.rid, orderId: order.id, providerRef: "plink_1", status: "SUCCESS", amountMinor: 1 });
    expect((await w.T.orders.get(order.id))!.paymentStatus).not.toBe("SUCCESS");
    expect((await w.T.payments.list())[0].status).toBe("FAILED");
  });

  it("a payment arriving for an order already paid in cash is flagged for refund, not applied twice", async () => {
    const { order } = await qrOrder();
    await startOnlinePayment({ restaurantId: w.rid, orderId: order.id, returnUrl: "https://app.test/t" });
    await collectPayment(w.rid, order.id, "CASH", w.ownerId);
    await applyPaymentEvent({ restaurantId: w.rid, orderId: order.id, providerRef: "plink_1", status: "SUCCESS", amountMinor: order.total });
    const o = (await w.T.orders.get(order.id))!;
    expect(o.paymentMethod).toBe("CASH");
    expect((await w.T.payments.list()).some((p) => p.reference === "DUPLICATE_PAYMENT_REFUND_REQUIRED")).toBe(true);
  });

  it("refuses to start for disabled methods, cancelled and already-paid orders", async () => {
    const { order } = await qrOrder();
    await collectPayment(w.rid, order.id, "UPI", w.ownerId, "UTR000111");
    await expect(startOnlinePayment({ restaurantId: w.rid, orderId: order.id, returnUrl: "x" })).rejects.toMatchObject({ code: "ALREADY_PAID" });
    const b = await qrOrder();
    await transitionOrder(w.rid, b.order.id, "cancel", w.ownerId);
    await expect(startOnlinePayment({ restaurantId: w.rid, orderId: b.order.id, returnUrl: "x" })).rejects.toMatchObject({ code: "ORDER_CANCELLED" });
    await setRestaurantSettings(w, { payments: { online: false } });
    const c = await qrOrder();
    await expect(startOnlinePayment({ restaurantId: w.rid, orderId: c.order.id, returnUrl: "x" })).rejects.toMatchObject({ code: "METHOD_DISABLED" });
  });

  it("UPI is never auto-confirmed: only an explicit staff confirmation marks it paid", async () => {
    const { order } = await qrOrder();
    expect((await w.T.orders.get(order.id))!.paymentStatus).toBe("PENDING");
    expect((await collectPayment(w.rid, order.id, "UPI", w.ownerId, "UTR123456")).paymentStatus).toBe("SUCCESS");
  });
});

describe("webhook endpoint", () => {
  const call = (raw: string, sig: string | null) => webhook(new Request("http://x/api/payments/webhook", { method: "POST", body: raw, headers: sig ? { "x-razorpay-signature": sig } : {} }));

  it("rejects missing/forged signatures with 401 and applies nothing", async () => {
    const { order } = await qrOrder();
    await startOnlinePayment({ restaurantId: w.rid, orderId: order.id, returnUrl: "https://app.test/t" });
    const raw = JSON.stringify(paidEvent(order.id, order.total));
    expect((await call(raw, null)).status).toBe(401);
    expect((await call(raw, "deadbeef")).status).toBe(401);
    expect((await w.T.orders.get(order.id))!.paymentStatus).toBe("PROCESSING");
  });

  it("accepts a correctly signed event", async () => {
    const { order } = await qrOrder();
    await startOnlinePayment({ restaurantId: w.rid, orderId: order.id, returnUrl: "https://app.test/t" });
    const raw = JSON.stringify(paidEvent(order.id, order.total));
    expect((await call(raw, sign(raw))).status).toBe(200);
    expect((await w.T.orders.get(order.id))!.paymentStatus).toBe("SUCCESS");
  });

  it("returns 404 when no provider is configured", async () => {
    delete process.env.PAYMENT_PROVIDER;
    resetServerEnvCache();
    expect((await call("{}", "x")).status).toBe(404);
  });
});
