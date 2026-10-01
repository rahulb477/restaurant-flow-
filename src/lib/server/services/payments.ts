import { repos, type Order } from "@/lib/repositories";
import { OrderError, canPaymentTransition } from "@/lib/calculations";
import { ApiError } from "../http";
import { getPaymentProvider, type ProviderPaymentStatus } from "../providers";
import { resolveSettings } from "./orders";

/**
 * Online payments. The browser can START a payment but can never mark one successful:
 * success is applied only from a signature-verified provider webhook (or server-side status lookup).
 */
export async function startOnlinePayment(opts: { restaurantId: string; orderId: string; returnUrl: string }) {
  const provider = getPaymentProvider();
  if (!provider) throw new ApiError("Online payments are not configured for this server.", 503, "PAYMENT_NOT_CONFIGURED");
  const R = repos();
  const T = R.tenant(opts.restaurantId);
  const [rest, order] = await Promise.all([R.restaurants.get(opts.restaurantId), T.orders.get(opts.orderId)]);
  if (!rest || !order) throw new OrderError("Order not found.", "NOT_FOUND", 404);
  if (!resolveSettings(rest.settings).payments.online) throw new OrderError("Online payments are not enabled for this restaurant.", "METHOD_DISABLED", 400);
  if (order.status === "CANCELLED") throw new OrderError("This order was cancelled.", "ORDER_CANCELLED", 409);
  if (order.paymentStatus === "SUCCESS") throw new OrderError("This order is already paid.", "ALREADY_PAID", 409);

  // amount always comes from the stored order total, never from the client
  const intent = await provider.createPayment({ restaurantId: order.restaurantId, orderId: order.id, displayId: order.displayId, amountMinor: order.total, currency: rest.currency, returnUrl: opts.returnUrl, customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail } });
  const now = new Date();
  await T.payments.create(null, { orderId: order.id, method: "ONLINE", status: "PROCESSING", amount: order.total, reference: "", provider: provider.name, providerRef: intent.providerRef, recordedBy: null, createdAt: now, updatedAt: now });
  if (canPaymentTransition(order.paymentStatus, "PROCESSING")) await T.orders.update(order.id, { paymentStatus: "PROCESSING", paymentMethod: "ONLINE" });
  return { url: intent.action?.url ?? "", providerRef: intent.providerRef };
}

/** Applies a verified provider event. Idempotent: replaying the same webhook changes nothing. */
export async function applyPaymentEvent(ev: { restaurantId: string; orderId: string; providerRef: string; status: ProviderPaymentStatus; amountMinor: number | null }) {
  const R = repos();
  const T = R.tenant(ev.restaurantId);
  return R.transaction(async (tx) => {
    const order = await T.orders.get(ev.orderId, tx);
    if (!order) return { applied: false, reason: "ORDER_NOT_FOUND" };
    const pays = await T.payments.list({ where: [["providerRef", "==", ev.providerRef]] }, tx);
    const pay = pays[0];
    if (!pay || pay.orderId !== order.id) return { applied: false, reason: "PAYMENT_NOT_FOUND" };
    if (pay.status === "SUCCESS" || pay.status === "REFUNDED") return { applied: false, reason: "ALREADY_FINAL" };
    const now = new Date();
    if (ev.status === "SUCCESS") {
      if (ev.amountMinor !== null && ev.amountMinor !== order.total) {
        T.payments.update(pay.id, { status: "FAILED", reference: "AMOUNT_MISMATCH", updatedAt: now }, tx);
        return { applied: false, reason: "AMOUNT_MISMATCH" };
      }
      if (order.status === "CANCELLED") {
        T.payments.update(pay.id, { status: "FAILED", reference: "ORDER_CANCELLED", updatedAt: now }, tx);
        return { applied: false, reason: "ORDER_CANCELLED" };
      }
      if (order.paymentStatus === "SUCCESS") {
        // already settled another way (e.g. cash) — record the extra receipt and alert staff to refund it
        T.payments.update(pay.id, { status: "SUCCESS", reference: "DUPLICATE_PAYMENT_REFUND_REQUIRED", updatedAt: now }, tx);
        T.notifications.push(`order:${order.id}:duplicate-payment`, { type: "PAYMENT_DUPLICATE", title: `Duplicate payment for ${order.displayId}`, body: "The order was already paid. Refund the online payment." }, tx);
        return { applied: false, reason: "DUPLICATE_PAYMENT" };
      }
      const next: Order = { ...order, paymentStatus: "SUCCESS", paymentMethod: "ONLINE", status: order.status === "PAYMENT_PENDING" ? "PAYMENT_COMPLETED" : order.status, updatedAt: now };
      T.payments.update(pay.id, { status: "SUCCESS", updatedAt: now }, tx);
      T.bills.set(order.id, { orderId: order.id, emailedTo: "", emailedAt: null, createdAt: now }, tx);
      T.notifications.push(`order:${order.id}:paid`, { type: "PAYMENT_SUCCESS", title: `Payment received for ${order.displayId}`, body: `ONLINE · ${(order.total / 100).toFixed(2)}` }, tx);
      await T.orders.save(next, tx);
      return { applied: true, reason: "" };
    }
    if (!canPaymentTransition(pay.status, ev.status)) return { applied: false, reason: "INVALID_TRANSITION" };
    T.payments.update(pay.id, { status: ev.status, updatedAt: now }, tx);
    await T.orders.save({ ...order, paymentStatus: ev.status === "CANCELLED" ? "PENDING" : "FAILED", updatedAt: now }, tx);
    return { applied: true, reason: "" };
  });
}
