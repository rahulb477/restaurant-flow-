import { z } from "zod";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { repos, tenantRepos } from "@/lib/repositories";
import { transitionOrder, collectPayment, resolveSettings } from "@/lib/server/services/orders";
import { startOnlinePayment } from "@/lib/server/services/payments";
import { logActivity } from "@/lib/server/audit";
import { emailProvider } from "@/lib/server/providers";
import { invoiceHtml } from "@/lib/server/services/invoice";
import { publicEnv } from "@/config/env";
import type { OrderAction } from "@/lib/calculations";

type P = { id: string };

export const GET = api<P>(async (_req, { id }) => {
  const ctx = await requireCtx(["orders", "bills", "pos", "kds"]);
  const T = tenantRepos(ctx.restaurantId);
  const o = await T.orders.get(id);
  if (!o) throw new ApiError("Order not found", 404, "NOT_FOUND");
  const bill = await T.bills.get(id);
  return { order: { ...o, publicToken: "" }, bill };
});

const body = z.object({
  action: z.enum(["confirm", "start", "ready", "serve", "complete", "cancel"]).optional(),
  payment: z.object({ method: z.enum(["CASH", "UPI", "ONLINE"]), reference: z.string().max(80).optional() }).optional(),
  staffNotes: z.string().max(500).optional(),
  kitchenNotes: z.string().max(500).optional(),
});

export const PATCH = api<P>(async (req, { id }) => {
  const b = body.parse(await readJson(req));
  const kitchenAction = b.action && ["start", "ready", "serve"].includes(b.action);
  const ctx = await requireCtx(b.payment ? ["orders", "bills", "pos"] : kitchenAction ? ["kds", "orders"] : ["orders"]);
  const T = tenantRepos(ctx.restaurantId);
  let result;
  let paymentUrl: string | undefined;
  if (b.staffNotes !== undefined || b.kitchenNotes !== undefined) {
    await T.orders.update(id, { ...(b.staffNotes !== undefined ? { staffNotes: b.staffNotes } : {}), ...(b.kitchenNotes !== undefined ? { kitchenNotes: b.kitchenNotes } : {}) });
  }
  if (b.payment) {
    if (b.payment.method === "ONLINE") {
      // Online payments are completed by the provider webhook, never by the caller.
      const base = publicEnv.appUrl || new URL(req.url).origin;
      const o = await T.orders.get(id);
      if (!o) throw new ApiError("Order not found", 404, "NOT_FOUND");
      paymentUrl = (await startOnlinePayment({ restaurantId: ctx.restaurantId, orderId: id, returnUrl: `${base}/track/${o.publicToken}` })).url;
    } else {
      result = await collectPayment(ctx.restaurantId, id, b.payment.method, ctx.user.id, b.payment.reference);
      await logActivity(ctx, "payment.recorded", "order", id, null, { method: b.payment.method, displayId: result.displayId });
    }
  }
  if (b.action) result = await transitionOrder(ctx.restaurantId, id, b.action as OrderAction, ctx.user.id);
  if (!result) result = await T.orders.get(id);
  if (!result) throw new ApiError("Order not found", 404, "NOT_FOUND");
  if (b.action === "cancel") await logActivity(ctx, "order.cancelled", "order", id, null, { displayId: result.displayId });
  return { order: { ...result, publicToken: "" }, paymentUrl };
});

export const POST = api<P>(async (req, { id }) => {
  const ctx = await requireCtx(["bills", "orders"]);
  const { email } = z.object({ email: z.string().trim().email("Enter a valid email address") }).parse(await readJson(req));
  const T = tenantRepos(ctx.restaurantId);
  const o = await T.orders.get(id);
  if (!o) throw new ApiError("Order not found", 404, "NOT_FOUND");
  const r = await repos().restaurants.get(ctx.restaurantId);
  if (!r) throw new ApiError("Restaurant not found", 404, "NOT_FOUND");
  await emailProvider.sendInvoice(email, `Your receipt from ${r.name} (${o.displayId})`, invoiceHtml(o, r, resolveSettings(r.settings).invoiceFooter));
  // only reached if the provider succeeded
  const bill = await T.bills.get(id);
  if (bill) await T.bills.update(id, { emailedTo: email, emailedAt: new Date() });
  else await T.bills.set(id, { orderId: id, emailedTo: email, emailedAt: new Date(), createdAt: new Date() });
  return { ok: true };
});
