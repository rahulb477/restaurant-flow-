import { beforeEach, describe, expect, it } from "vitest";
import { createOrder, usageBalance } from "@/lib/server/services/orders";
import { createSettlement, finalizeSettlement, planSettlement, submitSettlementReference } from "@/lib/server/services/usage";
import { createWorld, type World } from "./helpers/seed";

let w: World;
beforeEach(async () => {
  w = await createWorld();
});
const qr = () => createOrder({ restaurantId: w.rid, source: "QR", tableToken: w.tableToken, items: [{ productId: w.ids.sandwich, qty: 1 }], idempotencyKey: `k-${Math.random()}` });

describe("usage settlement", () => {
  it("planSettlement is null for zero balance", () => {
    expect(planSettlement({ usageBalance: 0, usageOrders: 0 })).toBeNull();
    expect(planSettlement({ usageBalance: 300, usageOrders: 3 })).toEqual({ amount: 300, orderCount: 3 });
  });

  it("refuses to settle an empty balance", async () => {
    await expect(createSettlement(w.rid)).rejects.toMatchObject({ code: "NOTHING_TO_SETTLE" });
  });

  it("closes the balance into one settlement and marks every ledger row SETTLED", async () => {
    await qr(); await qr(); await qr();
    expect(await usageBalance(w.rid)).toEqual({ balance: 300, orders: 3 });
    const s = await createSettlement(w.rid);
    expect(s).toMatchObject({ amount: 300, orderCount: 3, status: "PENDING" });
    expect(await usageBalance(w.rid)).toEqual({ balance: 0, orders: 0 });
    const ledger = await w.T.usage.list();
    expect(ledger.every((r) => r.status === "SETTLED" && r.settlementId === s.id)).toBe(true);
    await expect(createSettlement(w.rid)).rejects.toMatchObject({ code: "NOTHING_TO_SETTLE" }); // no double settlement
  });

  it("concurrent settle requests produce exactly one settlement", async () => {
    await qr(); await qr();
    const res = await Promise.allSettled([createSettlement(w.rid), createSettlement(w.rid)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await w.T.settlements.list()).toHaveLength(1);
  });

  it("new orders after settlement start a fresh balance", async () => {
    await qr();
    await createSettlement(w.rid);
    await qr();
    expect(await usageBalance(w.rid)).toEqual({ balance: 100, orders: 1 });
  });

  it("PAID is final; FAILED returns the amount and re-opens the ledger rows", async () => {
    await qr(); await qr();
    const s = await createSettlement(w.rid);
    await submitSettlementReference(w.rid, s.id, "UTR9988776655");
    const failed = await finalizeSettlement(w.rid, s.id, "FAILED");
    expect(failed.status).toBe("FAILED");
    expect(await usageBalance(w.rid)).toEqual({ balance: 200, orders: 2 });
    expect((await w.T.usage.list()).every((r) => r.status === "CHARGED" && r.settlementId === null)).toBe(true);
    await expect(finalizeSettlement(w.rid, s.id, "PAID")).rejects.toThrow(); // FAILED is terminal
    const s2 = await createSettlement(w.rid);
    await finalizeSettlement(w.rid, s2.id, "PAID");
    await expect(finalizeSettlement(w.rid, s2.id, "FAILED")).rejects.toThrow();
  });

  it("every ledger record references exactly one order", async () => {
    const a = await qr(); const b = await qr();
    const ledger = await w.T.usage.list();
    expect(ledger.map((r) => r.orderId).sort()).toEqual([a.order.id, b.order.id].sort());
    expect(ledger.every((r) => r.id === r.orderId)).toBe(true);
  });
});
