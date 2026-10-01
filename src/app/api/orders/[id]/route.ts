import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, restaurants, bills } from "@/db/schema";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { transitionOrder, collectPayment, resolveSettings } from "@/lib/server/services/orders";
import { logActivity } from "@/lib/server/audit";
import { emailProvider } from "@/lib/server/providers";
import { invoiceHtml } from "@/lib/server/services/invoice";
import type { OrderAction } from "@/lib/calculations";

type P = { id: string };

export const GET = api<P>(async (_req, { id }) => {
  const ctx = await requireCtx(["orders", "bills", "pos", "kds"]);
  const o = (await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.restaurantId, ctx.restaurantId))).limit(1))[0];
  if (!o) throw new ApiError("Order not found", 404, "NOT_FOUND");
  const bill = (await db.select().from(bills).where(eq(bills.orderId, id)).limit(1))[0] ?? null;
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
  let result;
  if (b.staffNotes !== undefined || b.kitchenNotes !== undefined) {
    await db.update(orders).set({ ...(b.staffNotes !== undefined ? { staffNotes: b.staffNotes } : {}), ...(b.kitchenNotes !== undefined ? { kitchenNotes: b.kitchenNotes } : {}), updatedAt: new Date() }).where(and(eq(orders.id, id), eq(orders.restaurantId, ctx.restaurantId)));
  }
  if (b.payment) result = await collectPayment(ctx.restaurantId, id, b.payment.method, ctx.user.id, b.payment.reference);
  if (b.action) result = await transitionOrder(ctx.restaurantId, id, b.action as OrderAction, ctx.user.id);
  if (!result) result = (await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.restaurantId, ctx.restaurantId))).limit(1))[0];
  if (b.action === "cancel") await logActivity(ctx, "order.cancelled", "order", id, null, { displayId: result.displayId });
  return { order: { ...result, publicToken: "" } };
});

export const POST = api<P>(async (req, { id }) => {
  const ctx = await requireCtx(["bills", "orders"]);
  const { email } = z.object({ email: z.string().trim().email("Enter a valid email address") }).parse(await readJson(req));
  const o = (await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.restaurantId, ctx.restaurantId))).limit(1))[0];
  if (!o) throw new ApiError("Order not found", 404, "NOT_FOUND");
  const r = (await db.select().from(restaurants).where(eq(restaurants.id, ctx.restaurantId)).limit(1))[0];
  await emailProvider.sendInvoice(email, `Your receipt from ${r.name} (${o.displayId})`, invoiceHtml(o, r, resolveSettings(r.settings).invoiceFooter));
  // only reached if the provider succeeded
  await db.insert(bills).values({ restaurantId: ctx.restaurantId, orderId: id, emailedTo: email, emailedAt: new Date() }).onConflictDoUpdate({ target: bills.orderId, set: { emailedTo: email, emailedAt: new Date() } });
  return { ok: true };
});
