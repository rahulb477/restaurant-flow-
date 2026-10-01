import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { restaurants, categories, products, variantGroups, addons, diningTables, orders, customers, loyaltyPrograms, loyaltyRewards, scratchIssuances, scratchCampaigns, reviews } from "@/db/schema";
import { api, ApiError, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { createOrder } from "@/lib/server/services/orders";
import { customerRestaurant } from "@/lib/server/services/restaurant";
import { aiProvider } from "@/lib/server/providers";
import { notify } from "@/lib/server/audit";
import { pickScratchReward } from "@/lib/calculations";
import { randomToken } from "@/lib/server/auth";

type P = { action: string };

async function bySlug(slug: string) {
  const r = (await db.select().from(restaurants).where(eq(restaurants.slug, slug)).limit(1))[0];
  if (!r) throw new ApiError("Restaurant not found.", 404, "NOT_FOUND");
  return r;
}
async function byToken(token: string) {
  const o = (await db.select().from(orders).where(eq(orders.publicToken, token)).limit(1))[0];
  if (!o) throw new ApiError("Order not found.", 404, "NOT_FOUND");
  return o;
}

const itemSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().min(1).max(99),
  variants: z.record(z.string(), z.array(z.string())).optional(),
  addonIds: z.array(z.string()).optional(),
  notes: z.string().max(300).optional(),
});
const customerSchema = z.object({ name: z.string().max(80).optional(), phone: z.string().max(20).optional(), email: z.union([z.string().email(), z.literal("")]).optional() });
const locSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional();

function publicOrder(o: typeof orders.$inferSelect) {
  return {
    id: o.id, displayId: o.displayId, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, tableName: o.tableName, items: o.items,
    subtotal: o.subtotal, discount: o.discount, tax: o.tax, taxLabel: o.taxLabel, platformFee: o.platformFee, total: o.total, couponCode: o.couponCode, customerNotes: o.customerNotes,
    createdAt: o.createdAt, paymentTiming: o.paymentTiming, customerName: o.customerName,
  };
}

export const GET = api<P>(async (req, { action }) => {
  const u = new URL(req.url);
  if (action === "menu") {
    const slug = u.searchParams.get("slug") ?? "";
    const r = await bySlug(slug);
    let table: { name: string } | null = null;
    const tt = u.searchParams.get("table");
    if (tt) {
      const t = (await db.select().from(diningTables).where(and(eq(diningTables.restaurantId, r.id), eq(diningTables.qrToken, tt))).limit(1))[0];
      if (!t || !t.isActive) throw new ApiError("This QR code is no longer valid. Please ask staff for help.", 404, "QR_INVALID");
      table = { name: t.name };
    }
    const [cats, prods, groups, ads] = await Promise.all([
      db.select().from(categories).where(and(eq(categories.restaurantId, r.id), eq(categories.isActive, true))).orderBy(asc(categories.sortOrder)),
      db.select().from(products).where(and(eq(products.restaurantId, r.id), eq(products.isActive, true))).orderBy(asc(products.sortOrder)),
      db.select().from(variantGroups).where(and(eq(variantGroups.restaurantId, r.id), eq(variantGroups.isActive, true))),
      db.select().from(addons).where(and(eq(addons.restaurantId, r.id), eq(addons.isActive, true))).orderBy(asc(addons.sortOrder)),
    ]);
    return {
      restaurant: customerRestaurant(r),
      table,
      categories: cats.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      products: prods.map((p) => ({ id: p.id, categoryId: p.categoryId, name: p.name, description: p.description, imageUrl: p.imageUrl, price: p.price, availability: p.availability, isPopular: p.isPopular, isRecommended: p.isRecommended, isVeg: p.isVeg, variantGroupIds: p.variantGroupIds, addonIds: p.addonIds })),
      variantGroups: groups.map((g) => ({ id: g.id, name: g.name, selectionType: g.selectionType, required: g.required, minSelections: g.minSelections, maxSelections: g.maxSelections, options: g.options.filter((o) => o.isAvailable) })),
      addons: ads.filter((a) => a.isAvailable).map((a) => ({ id: a.id, name: a.name, price: a.price })),
    };
  }
  if (action === "order") {
    const o = await byToken(u.searchParams.get("token") ?? "");
    const r = (await db.select().from(restaurants).where(eq(restaurants.id, o.restaurantId)).limit(1))[0];
    const cr = customerRestaurant(r);
    const upi = (await import("@/lib/server/services/orders")).resolveSettings(r.settings).payments;
    let loyalty: unknown = null;
    if (o.customerId) {
      const prog = (await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.restaurantId, o.restaurantId)).limit(1))[0];
      if (prog?.isActive) {
        const c = (await db.select().from(customers).where(eq(customers.id, o.customerId)).limit(1))[0];
        const rewards = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.customerId, o.customerId));
        const req = Math.max(1, prog.requiredVisits);
        const v = c?.visits ?? 0;
        loyalty = { visits: v % req === 0 && v > 0 ? req : v % req, required: req, rewardTitle: prog.rewardTitle, rewards: rewards.map((x) => ({ id: x.id, title: x.title, status: x.status, code: x.status === "CLAIMED" ? x.code : "" })) };
      }
    }
    const scratch = (await db.select().from(scratchIssuances).where(eq(scratchIssuances.orderId, o.id)).limit(1))[0];
    const review = (await db.select().from(reviews).where(eq(reviews.orderId, o.id)).limit(1))[0];
    return {
      order: publicOrder(o),
      restaurant: cr,
      upi: o.paymentStatus !== "SUCCESS" && upi.upi && upi.upiId ? { upiId: upi.upiId, name: upi.upiName || r.name } : null,
      loyalty,
      scratch: scratch ? { status: scratch.status, reward: scratch.reward, code: scratch.status === "CLAIMED" ? scratch.code : "" } : null,
      review: review ? { rating: review.rating, text: review.text } : null,
    };
  }
  throw new ApiError("Not found", 404);
});

export const POST = api<P>(async (req, { action }) => {
  const ip = clientIp(req);
  const b = (await readJson(req)) as Record<string, unknown>;
  switch (action) {
    case "order":
    case "quote": {
      const quote = action === "quote";
      rateLimit(`${action}:${ip}`, quote ? 120 : 20, 600_000);
      const v = z
        .object({ slug: z.string().min(1), tableToken: z.string().nullable().optional(), items: z.array(itemSchema).min(1).max(60), couponCode: z.string().max(30).optional(), customer: customerSchema.optional(), notes: z.string().max(500).optional(), idempotencyKey: z.string().min(8).max(80).optional(), location: locSchema })
        .parse(b);
      if (!quote && !v.idempotencyKey) throw new ApiError("Missing idempotency key", 400, "VALIDATION");
      const r = await bySlug(v.slug);
      const { order, existing } = await createOrder({ restaurantId: r.id, source: "QR", tableToken: v.tableToken, items: v.items, couponCode: v.couponCode, customer: v.customer, notes: v.notes, idempotencyKey: v.idempotencyKey, location: v.location, dryRun: quote });
      if (quote) return { subtotal: order.subtotal, discount: order.discount, tax: order.tax, taxLabel: order.taxLabel, platformFee: order.platformFee, total: order.total, couponCode: order.couponCode };
      return { token: order.publicToken, displayId: order.displayId, existing };
    }
    case "review-draft": {
      rateLimit(`rdraft:${ip}`, 10, 600_000);
      const v = z.object({ token: z.string(), rating: z.number().int().min(1).max(5) }).parse(b);
      const o = await byToken(v.token);
      if (o.status !== "COMPLETED") throw new ApiError("You can review once your order is completed.", 409, "NOT_COMPLETED");
      const r = (await db.select().from(restaurants).where(eq(restaurants.id, o.restaurantId)).limit(1))[0];
      const text = await aiProvider.generateReview({ restaurantName: r.name, rating: v.rating, items: o.items.map((i) => i.name) });
      return { text };
    }
    case "review": {
      rateLimit(`review:${ip}`, 10, 600_000);
      const v = z.object({ token: z.string(), rating: z.number().int().min(1).max(5), text: z.string().max(1000).default("") }).parse(b);
      const o = await byToken(v.token);
      if (o.status !== "COMPLETED") throw new ApiError("You can review once your order is completed.", 409, "NOT_COMPLETED");
      await db.insert(reviews).values({ restaurantId: o.restaurantId, orderId: o.id, rating: v.rating, text: v.text }).onConflictDoUpdate({ target: reviews.orderId, set: { rating: v.rating, text: v.text } });
      return { ok: true };
    }
    case "loyalty-claim": {
      rateLimit(`lclaim:${ip}`, 15, 600_000);
      const v = z.object({ token: z.string(), rewardId: z.string().uuid() }).parse(b);
      const o = await byToken(v.token);
      if (!o.customerId) throw new ApiError("No loyalty account on this order.", 400);
      const code = `LR-${randomToken(3).toUpperCase()}`;
      const upd = await db.update(loyaltyRewards).set({ status: "CLAIMED", code, claimedAt: new Date() }).where(and(eq(loyaltyRewards.id, v.rewardId), eq(loyaltyRewards.customerId, o.customerId), eq(loyaltyRewards.restaurantId, o.restaurantId), eq(loyaltyRewards.status, "UNLOCKED"))).returning();
      if (!upd.length) throw new ApiError("This reward was already claimed.", 409, "ALREADY_CLAIMED");
      return { code, title: upd[0].title };
    }
    case "scratch-reveal": {
      rateLimit(`sreveal:${ip}`, 15, 600_000);
      const v = z.object({ token: z.string() }).parse(b);
      const o = await byToken(v.token);
      return db.transaction(async (tx) => {
        const iss = (await tx.execute(sql`select * from scratch_issuances where order_id = ${o.id} and restaurant_id = ${o.restaurantId} for update`)).rows[0] as { id: string; campaign_id: string; status: string; reward: string } | undefined;
        if (!iss) throw new ApiError("No scratch card for this order.", 404, "NOT_FOUND");
        if (iss.status !== "ISSUED") return { reward: iss.reward, status: iss.status };
        const camp = (await tx.select().from(scratchCampaigns).where(eq(scratchCampaigns.id, iss.campaign_id)).limit(1))[0];
        let reward: string | null = null;
        const withinLimit = camp && (camp.usageLimit === 0 || camp.usedCount < camp.usageLimit);
        if (camp && withinLimit) {
          reward = pickScratchReward(camp.rewards, crypto.randomInt(0, 1_000_000) / 1_000_000);
          await tx.update(scratchCampaigns).set({ usedCount: sql`${scratchCampaigns.usedCount} + 1` }).where(eq(scratchCampaigns.id, camp.id));
        }
        await tx.update(scratchIssuances).set({ status: "REVEALED", reward: reward ?? "" }).where(eq(scratchIssuances.id, iss.id));
        if (reward) await notify(o.restaurantId, "COUPON_CREATED", "Scratch card won", `${reward} · ${o.displayId}`, `scratch:${iss.id}`, tx);
        return { reward: reward ?? "", status: "REVEALED" };
      });
    }
    case "scratch-claim": {
      rateLimit(`sclaim:${ip}`, 15, 600_000);
      const v = z.object({ token: z.string() }).parse(b);
      const o = await byToken(v.token);
      const code = `SC-${randomToken(3).toUpperCase()}`;
      const upd = await db.update(scratchIssuances).set({ status: "CLAIMED", code }).where(and(eq(scratchIssuances.orderId, o.id), eq(scratchIssuances.status, "REVEALED"), sql`${scratchIssuances.reward} <> ''`)).returning();
      if (!upd.length) throw new ApiError("Nothing to claim or already claimed.", 409, "ALREADY_CLAIMED");
      return { code, reward: upd[0].reward };
    }
    default:
      throw new ApiError("Not found", 404);
  }
});
