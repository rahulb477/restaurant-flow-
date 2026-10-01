import crypto from "node:crypto";
import { z } from "zod";
import { api, ApiError, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { repos, tenantRepos, type Order } from "@/lib/repositories";
import { createOrder, resolveSettings } from "@/lib/server/services/orders";
import { startOnlinePayment } from "@/lib/server/services/payments";
import { customerRestaurant } from "@/lib/server/services/restaurant";
import { aiProvider } from "@/lib/server/providers";
import { notify } from "@/lib/server/audit";
import { pickScratchReward } from "@/lib/calculations";
import { randomToken } from "@/lib/server/auth";
import { publicEnv } from "@/config/env";

type P = { action: string };

async function bySlug(slug: string) {
  const R = repos();
  const rid = await R.lookup.resolveSlug(slug);
  const r = rid ? await R.restaurants.get(rid) : null;
  if (!r) throw new ApiError("Restaurant not found.", 404, "NOT_FOUND");
  return r;
}
/** The unguessable public order token is the customer's only credential. It resolves to exactly one order. */
async function byToken(token: string) {
  const hit = await repos().lookup.resolveOrderToken(token);
  const o = hit ? await tenantRepos(hit.restaurantId).orders.get(hit.orderId) : null;
  if (!o) throw new ApiError("Order not found.", 404, "NOT_FOUND");
  return o;
}

const itemSchema = z.object({
  productId: z.string().min(1).max(128),
  qty: z.number().int().min(1).max(99),
  variants: z.record(z.string(), z.array(z.string())).optional(),
  addonIds: z.array(z.string()).optional(),
  notes: z.string().max(300).optional(),
});
const customerSchema = z.object({ name: z.string().max(80).optional(), phone: z.string().max(20).optional(), email: z.union([z.string().email(), z.literal("")]).optional() });
const locSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional();

function publicOrder(o: Order) {
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
    const T = tenantRepos(r.id);
    let table: { name: string } | null = null;
    const tt = u.searchParams.get("table");
    if (tt) {
      const t = await T.tables.getByQrToken(tt);
      if (!t || !t.isActive) throw new ApiError("This QR code is no longer valid. Please ask staff for help.", 404, "QR_INVALID");
      table = { name: t.name };
    }
    const [cats, prods, groups, ads] = await Promise.all([T.categories.list({ limit: 500 }), T.products.listAll(1000), T.variantGroups.list({ limit: 500 }), T.addons.list({ limit: 500 })]);
    const bySort = <X extends { sortOrder: number }>(a: X, b: X) => a.sortOrder - b.sortOrder;
    return {
      restaurant: customerRestaurant(r),
      table,
      categories: cats.filter((c) => c.isActive).sort(bySort).map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      products: prods.filter((p) => p.isActive).sort(bySort).map((p) => ({ id: p.id, categoryId: p.categoryId, name: p.name, description: p.description, imageUrl: p.imageUrl, price: p.price, availability: p.availability, isPopular: p.isPopular, isRecommended: p.isRecommended, isVeg: p.isVeg, variantGroupIds: p.variantGroupIds, addonIds: p.addonIds })),
      variantGroups: groups.filter((g) => g.isActive).map((g) => ({ id: g.id, name: g.name, selectionType: g.selectionType, required: g.required, minSelections: g.minSelections, maxSelections: g.maxSelections, options: g.options.filter((o) => o.isAvailable) })),
      addons: ads.filter((a) => a.isActive && a.isAvailable).sort(bySort).map((a) => ({ id: a.id, name: a.name, price: a.price })),
    };
  }
  if (action === "order") {
    const o = await byToken(u.searchParams.get("token") ?? "");
    const R = repos();
    const T = tenantRepos(o.restaurantId);
    const r = await R.restaurants.get(o.restaurantId);
    if (!r) throw new ApiError("Order not found.", 404, "NOT_FOUND");
    const cr = customerRestaurant(r);
    const pay = resolveSettings(r.settings).payments;
    let loyalty: unknown = null;
    if (o.customerId) {
      const prog = await T.loyalty.getProgram();
      if (prog?.isActive) {
        const [c, rewards] = await Promise.all([T.customers.get(o.customerId), T.loyalty.list({ where: [["customerId", "==", o.customerId]], limit: 200 })]);
        const required = Math.max(1, prog.requiredVisits);
        const v = c?.visits ?? 0;
        loyalty = { visits: v % required === 0 && v > 0 ? required : v % required, required, rewardTitle: prog.rewardTitle, rewards: rewards.map((x) => ({ id: x.id, title: x.title, status: x.status, code: x.status === "CLAIMED" ? x.code : "" })) };
      }
    }
    const [scratch, review] = await Promise.all([T.scratchCards.get(o.id), T.reviews.get(o.id)]);
    return {
      order: publicOrder(o),
      restaurant: cr,
      upi: o.paymentStatus !== "SUCCESS" && pay.upi && pay.upiId ? { upiId: pay.upiId, name: pay.upiName || r.name } : null,
      onlinePay: o.paymentStatus !== "SUCCESS" && o.status !== "CANCELLED" && pay.online && !!(await import("@/lib/server/providers")).getPaymentProvider(),
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
        .object({  slug: z.string().min(1).max(80), tableToken: z.string().max(80).nullable().optional(), items: z.array(itemSchema).min(1).max(60), couponCode: z.string().max(30).optional(), customer: customerSchema.optional(), notes: z.string().max(500).optional(), idempotencyKey: z.string().min(8).max(80).optional(), location: locSchema })
        .parse(b);
      if (!quote && !v.idempotencyKey) throw new ApiError("Missing idempotency key", 400, "VALIDATION");
      const r = await bySlug(v.slug);
      const { order, existing } = await createOrder({ restaurantId: r.id, source: "QR", tableToken: v.tableToken, items: v.items, couponCode: v.couponCode, customer: v.customer, notes: v.notes, idempotencyKey: v.idempotencyKey, location: v.location, dryRun: quote });
      if (quote) return { subtotal: order.subtotal, discount: order.discount, tax: order.tax, taxLabel: order.taxLabel, platformFee: order.platformFee, total: order.total, couponCode: order.couponCode };
      return { token: order.publicToken, displayId: order.displayId, existing };
    }
    case "pay": {
      rateLimit(`pay:${ip}`, 10, 600_000);
      const v = z.object({ token: z.string().min(8).max(80) }).parse(b);
      const o = await byToken(v.token);
      const base = publicEnv.appUrl || new URL(req.url).origin;
      const r = await startOnlinePayment({ restaurantId: o.restaurantId, orderId: o.id, returnUrl: `${base}/track/${o.publicToken}` });
      return { url: r.url };
    }
    case "review-draft": {
      rateLimit(`rdraft:${ip}`, 10, 600_000);
      const v = z.object({ token: z.string(), rating: z.number().int().min(1).max(5) }).parse(b);
      const o = await byToken(v.token);
      if (o.status !== "COMPLETED") throw new ApiError("You can review once your order is completed.", 409, "NOT_COMPLETED");
      const r = await repos().restaurants.get(o.restaurantId);
      const text = await aiProvider.generateReview({ restaurantName: r?.name ?? "", rating: v.rating, items: o.items.map((i) => i.name) });
      return { text };
    }
    case "review": {
      rateLimit(`review:${ip}`, 10, 600_000);
      const v = z.object({ token: z.string(), rating: z.number().int().min(1).max(5), text: z.string().max(1000).default("") }).parse(b);
      const o = await byToken(v.token);
      if (o.status !== "COMPLETED") throw new ApiError("You can review once your order is completed.", 409, "NOT_COMPLETED");
      await tenantRepos(o.restaurantId).reviews.set(o.id, { orderId: o.id, rating: v.rating, text: v.text, createdAt: new Date() });
      return { ok: true };
    }
    case "loyalty-claim": {
      rateLimit(`lclaim:${ip}`, 15, 600_000);
      const v = z.object({ token: z.string(), rewardId: z.string().min(1).max(200) }).parse(b);
      const o = await byToken(v.token);
      if (!o.customerId) throw new ApiError("No loyalty account on this order.", 400);
      const R = repos();
      const T = R.tenant(o.restaurantId);
      return R.transaction(async (tx) => {
        const rw = await T.loyalty.get(v.rewardId, tx);
        if (!rw || rw.customerId !== o.customerId) throw new ApiError("Reward not found.", 404, "NOT_FOUND");
        if (rw.status !== "UNLOCKED") throw new ApiError("This reward was already claimed.", 409, "ALREADY_CLAIMED");
        const code = `LR-${randomToken(3).toUpperCase()}`;
        await T.loyalty.update(rw.id, { status: "CLAIMED", code, claimedAt: new Date() }, tx);
        return { code, title: rw.title };
      });
    }
    case "scratch-reveal": {
      rateLimit(`sreveal:${ip}`, 15, 600_000);
      const v = z.object({ token: z.string() }).parse(b);
      const o = await byToken(v.token);
      const R = repos();
      const T = R.tenant(o.restaurantId);
      return R.transaction(async (tx) => {
        const card = await T.scratchCards.get(o.id, tx);
        if (!card) throw new ApiError("No scratch card for this order.", 404, "NOT_FOUND");
        if (card.status !== "ISSUED") return { reward: card.reward, status: card.status };
        const camp = await T.scratchCampaigns.get(card.campaignId, tx);
        let reward: string | null = null;
        const withinLimit = camp && (camp.usageLimit === 0 || camp.usedCount < camp.usageLimit);
        if (camp && withinLimit) {
          // reward selection is server-side and unpredictable; the client only learns the outcome
          reward = pickScratchReward(camp.rewards, crypto.randomInt(0, 1_000_000) / 1_000_000);
          await T.scratchCampaigns.update(camp.id, { usedCount: camp.usedCount + 1 }, tx);
        }
        await T.scratchCards.update(card.id, { status: "REVEALED", reward: reward ?? "" }, tx);
        if (reward) await notify(o.restaurantId, "COUPON_CREATED", "Scratch card won", `${reward} · ${o.displayId}`, `scratch:${card.id}`, tx);
        return { reward: reward ?? "", status: "REVEALED" };
      });
    }
    case "scratch-claim": {
      rateLimit(`sclaim:${ip}`, 15, 600_000);
      const v = z.object({ token: z.string() }).parse(b);
      const o = await byToken(v.token);
      const R = repos();
      const T = R.tenant(o.restaurantId);
      return R.transaction(async (tx) => {
        const card = await T.scratchCards.get(o.id, tx);
        if (!card || card.status !== "REVEALED" || !card.reward) throw new ApiError("Nothing to claim or already claimed.", 409, "ALREADY_CLAIMED");
        const code = `SC-${randomToken(3).toUpperCase()}`;
        await T.scratchCards.update(card.id, { status: "CLAIMED", code }, tx);
        return { code, reward: card.reward };
      });
    }
    default:
      throw new ApiError("Not found", 404);
  }
});
