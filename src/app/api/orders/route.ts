import { z } from "zod";
import { api, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { createOrder } from "@/lib/server/services/orders";

/**
 * Staff order creation (POS). Listing is done with Firestore realtime listeners in the browser
 * (see src/lib/firebase/realtime.ts); every price/total here is recomputed server-side.
 */
const item = z.object({
  productId: z.string().min(1).max(128).optional(),
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
      tableId: z.string().min(1).max(128).nullable().optional(),
      couponCode: z.string().max(30).optional(),
      customer: z.object({ name: z.string().max(80).optional(), phone: z.string().max(20).optional(), email: z.union([z.string().email(), z.literal("")]).optional() }).optional(),
      notes: z.string().max(500).optional(),
      manualDiscount: z.number().int().min(0).max(100_000_000).optional(),
      payment: z.object({ method: z.enum(["CASH", "UPI"]), reference: z.string().max(80).optional() }).nullable().optional(),
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
    // discretionary discounts are a privileged action: plain STAFF cannot grant them
    manualDiscount: ctx.role === "STAFF" ? 0 : b.manualDiscount,
    payment: b.payment,
    idempotencyKey: b.idempotencyKey,
    createdBy: ctx.user.id,
  });
  return { order: { ...order, publicToken: "" }, existing };
});
