import { beforeEach, describe, expect, it } from "vitest";
import { createOrder, transitionOrder, collectPayment, usageBalance } from "@/lib/server/services/orders";
import { createResource, deleteResource, listResource, updateResource } from "@/lib/server/services/crud";
import { createSettlement } from "@/lib/server/services/usage";
import { customerRestaurant, publicRestaurant } from "@/lib/server/services/restaurant";
import { scrub } from "@/lib/server/audit";
import { repos } from "@/lib/repositories";
import { GET as publicGet, POST as publicPost } from "@/app/api/public/[action]/route";
import { createWorld, seedRestaurant, type World } from "./helpers/seed";
import type { Ctx } from "@/lib/server/auth";

let a: World, b: World;
beforeEach(async () => {
  a = await createWorld({ slug: "alpha-cafe" });
  b = await seedRestaurant(a.db, { slug: "beta-cafe" });
});

const ctxOf = async (w: World, role: Ctx["role"] = "OWNER"): Promise<Ctx> => ({
  user: { id: w.ownerId, email: `${w.ownerId}@example.com`, name: "O", emailVerified: true },
  restaurant: (await repos().restaurants.get(w.rid))!,
  role,
  restaurantId: w.rid,
});
const qr = (w: World) => createOrder({ restaurantId: w.rid, source: "QR", tableToken: w.tableToken, items: [{ productId: w.ids.sandwich, qty: 1 }], idempotencyKey: `k-${Math.random()}` });
const get = (action: string, qs: string) => publicGet(new Request(`http://x/api/public/${action}?${qs}`), { params: Promise.resolve({ action }) });

describe("tenant isolation", () => {
  it("data lives under restaurants/{rid}/… and never leaks between tenants", async () => {
    await qr(a);
    expect(await b.T.orders.list()).toHaveLength(0);
    expect((await listResource(await ctxOf(b), "products", {})).items.map((p) => p.id as string)).not.toContain(a.ids.coffee);
    expect(a.db.dump(`restaurants/${a.rid}/orders`).length).toBe(1);
    expect(a.db.dump(`restaurants/${b.rid}/orders`).length).toBe(0);
  });

  it("another tenant's document ids resolve to NOT_FOUND for update and delete", async () => {
    const ctxB = await ctxOf(b);
    await expect(updateResource(ctxB, "products", a.ids.coffee, { price: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(deleteResource(ctxB, "products", a.ids.coffee)).rejects.toMatchObject({ status: 404 });
    expect((await a.T.products.get(a.ids.coffee))!.price).toBe(10000);
  });

  it("orders of another tenant cannot be transitioned, paid, or read through the other tenant", async () => {
    const { order } = await qr(a);
    await expect(transitionOrder(b.rid, order.id, "confirm", b.ownerId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(collectPayment(b.rid, order.id, "CASH", b.ownerId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await b.T.orders.get(order.id)).toBeNull();
  });

  it("cannot order another tenant's products or use another tenant's coupon", async () => {
    await expect(createOrder({ restaurantId: b.rid, source: "QR", tableToken: b.tableToken, items: [{ productId: a.ids.sandwich, qty: 1 }], idempotencyKey: "x1" })).rejects.toBeTruthy();
    const now = new Date();
    await a.T.coupons.create("ALPHA10", { code: "ALPHA10", type: "PERCENT", value: 10, minOrder: 0, maxDiscount: null, usageLimit: null, usedCount: 0, startsAt: null, endsAt: null, isActive: true, createdAt: now, updatedAt: now } as never);
    await expect(createOrder({ restaurantId: b.rid, source: "QR", tableToken: b.tableToken, items: [{ productId: b.ids.sandwich, qty: 1 }], couponCode: "ALPHA10", idempotencyKey: "x2" })).rejects.toMatchObject({ code: expect.stringMatching(/COUPON/) });
  });

  it("a QR token scans only for its own restaurant slug", async () => {
    const own = await get("menu", `slug=alpha-cafe&table=${a.tableToken}`);
    expect(own.status).toBe(200);
    const cross = await get("menu", `slug=beta-cafe&table=${a.tableToken}`);
    expect(cross.status).toBe(404);
    const order = await publicPost(new Request("http://x/api/public/order", { method: "POST", headers: { "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify({ slug: "beta-cafe", tableToken: a.tableToken, items: [{ productId: b.ids.sandwich, qty: 1 }], idempotencyKey: "cross-1" }) }), { params: Promise.resolve({ action: "order" }) });
    expect(order.status).toBeGreaterThanOrEqual(400);
    expect(await b.T.orders.list()).toHaveLength(0);
  });

  it("restaurant slugs and QR tokens are globally unique", async () => {
    await expect(seedRestaurant(a.db, { slug: "alpha-cafe" })).rejects.toMatchObject({ code: "SLUG_TAKEN" });
    const dup = { name: "T9", number: 9, qrToken: a.tableToken, status: "FREE", isActive: true } as never;
    await expect(b.T.tables.createWithQr(b.rid, dup)).rejects.toBeTruthy();
    expect(await repos().lookup.resolveQrToken(a.tableToken)).toMatchObject({ restaurantId: a.rid });
  });

  it("usage and settlement are per-tenant", async () => {
    await qr(a); await qr(a);
    expect(await usageBalance(a.rid)).toEqual({ balance: 200, orders: 2 });
    expect(await usageBalance(b.rid)).toEqual({ balance: 0, orders: 0 });
    await expect(createSettlement(b.rid)).rejects.toMatchObject({ code: "NOTHING_TO_SETTLE" });
    expect((await createSettlement(a.rid)).amount).toBe(200);
  });

  it("customer-facing projections hide ownership, coordinates and secrets", async () => {
    await repos().restaurants.update(a.rid, { latitude: 12.97, longitude: 77.59, settings: { payments: { upiId: "shop@upi" } } } as never);
    const r = (await repos().restaurants.get(a.rid))!;
    const c = JSON.stringify(customerRestaurant(r));
    expect(c).not.toMatch(/ownerId|latitude|longitude|12\.97|77\.59/);
    expect(publicRestaurant(r)).not.toHaveProperty("passwordHash");
  });

  it("the public order view exposes no internal ids or other customers' data", async () => {
    const { order } = await qr(a);
    const res = await get("order", `token=${order.publicToken}`);
    const json = JSON.stringify(await res.json());
    expect(json).not.toContain(a.ownerId);
    expect(json).not.toMatch(/idempotencyKey|createdBy|platformFee"?:\s*\{/);
    expect((await get("order", "token=does-not-exist-xyz")).status).toBe(404);
  });

  it("audit logs never contain secret-looking fields", () => {
    const s = scrub({ name: "x", passwordHash: "h", nested: { apiKey: "k", tokenHash: "t", ok: 1 }, list: [{ secret: "s", v: 2 }] });
    expect(JSON.stringify(s)).toBe(JSON.stringify({ name: "x", nested: { ok: 1 }, list: [{ v: 2 }] }));
  });
});
