import { repos, tenantRepos, type Settlement } from "@/lib/repositories";
import { ApiError } from "../http";

/**
 * Usage billing. Balance lives in the server-owned `system/counters` document (clients cannot write it, see
 * firestore.rules) and is changed only inside Firestore transactions together with the ledger record, which
 * always references exactly one order (document id === orderId).
 */

export type SettlementPlan = { amount: number; orderCount: number };

/** Pure helper: what should be settled for a given counters snapshot (null → nothing to settle). */
export function planSettlement(c: { usageBalance: number; usageOrders: number }): SettlementPlan | null {
  return c.usageBalance > 0 ? { amount: c.usageBalance, orderCount: c.usageOrders } : null;
}

async function markLedger(restaurantId: string, from: "CHARGED" | "SETTLED", settlementId: string, cutoff: Date) {
  const T = tenantRepos(restaurantId);
  for (let guard = 0; guard < 50; guard++) {
    const rows = from === "CHARGED" ? await T.usage.listCharged(cutoff, 400) : await T.usage.listForSettlement(settlementId, 400);
    const todo = rows.filter((r) => (from === "CHARGED" ? r.status === "CHARGED" : r.status === "SETTLED"));
    if (!todo.length) break;
    await Promise.all(todo.map((r) => T.usage.update(r.id, from === "CHARGED" ? { status: "SETTLED", settlementId } : { status: "CHARGED", settlementId: null })));
  }
}

/** Closes the current balance into a PENDING settlement and zeroes the counters, atomically. */
export async function createSettlement(restaurantId: string): Promise<Settlement> {
  const R = repos();
  const T = R.tenant(restaurantId);
  const settlement = await R.transaction(async (tx) => {
    const c = await T.usage.getCounters(tx);
    const plan = planSettlement(c);
    if (!plan) throw new ApiError("There is no outstanding balance to settle.", 409, "NOTHING_TO_SETTLE");
    const now = new Date();
    const s = await T.settlements.create(null, { amount: plan.amount, orderCount: plan.orderCount, status: "PENDING", reference: "", cutoff: now, createdAt: now, updatedAt: now }, tx);
    T.usage.setCounters({ ...c, usageBalance: 0, usageOrders: 0 }, tx);
    return s;
  });
  await markLedger(restaurantId, "CHARGED", settlement.id, settlement.cutoff);
  return settlement;
}

export async function submitSettlementReference(restaurantId: string, settlementId: string, reference: string): Promise<Settlement> {
  const R = repos();
  const T = R.tenant(restaurantId);
  return R.transaction(async (tx) => {
    const s = await T.settlements.get(settlementId, tx);
    if (!s || !["PENDING", "FAILED"].includes(s.status)) throw new ApiError("This settlement cannot be updated.", 409);
    const next = { ...s, status: "PROCESSING" as const, reference, updatedAt: new Date() };
    await T.settlements.update(settlementId, { status: next.status, reference, updatedAt: next.updatedAt }, tx);
    return next;
  });
}

/** Platform-operator decision. A FAILED settlement gives the amount back to the restaurant's balance. */
export async function finalizeSettlement(restaurantId: string, settlementId: string, status: "PAID" | "FAILED"): Promise<Settlement> {
  const R = repos();
  const T = R.tenant(restaurantId);
  const s = await R.transaction(async (tx) => {
    const cur = await T.settlements.get(settlementId, tx);
    if (!cur || !["PENDING", "PROCESSING"].includes(cur.status)) throw new ApiError("Settlement not found or already finalised", 409);
    const counters = status === "FAILED" ? await T.usage.getCounters(tx) : null;
    const now = new Date();
    await T.settlements.update(settlementId, { status, updatedAt: now }, tx);
    if (counters) T.usage.setCounters({ ...counters, usageBalance: counters.usageBalance + cur.amount, usageOrders: counters.usageOrders + cur.orderCount }, tx);
    return { ...cur, status, updatedAt: now };
  });
  if (status === "FAILED") await markLedger(restaurantId, "SETTLED", settlementId, s.cutoff);
  return s;
}
