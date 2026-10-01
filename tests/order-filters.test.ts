import { describe, expect, it } from "vitest";
import { filterOrders, matchesFilter, matchesSearch } from "@/lib/order-filters";

const o = (over: Partial<Parameters<typeof matchesFilter>[0]> = {}) => ({ status: "PLACED", paymentStatus: "PENDING", displayId: "#0001", tableName: "T1", customerName: "Asha", customerPhone: "9999900000", createdAt: "2026-01-01T10:00:00Z", ...over });

describe("order list filters", () => {
  it("maps status groups", () => {
    expect(matchesFilter(o(), "new")).toBe(true);
    expect(matchesFilter(o({ status: "SERVED" }), "completed")).toBe(true);
    expect(matchesFilter(o({ status: "CANCELLED" }), "new")).toBe(false);
    expect(matchesFilter(o({ status: "READY" }), "ready")).toBe(true);
    expect(matchesFilter(o({ status: "READY" }), "bogus")).toBe(false);
  });
  it("payment_pending includes unpaid open orders but not closed ones", () => {
    expect(matchesFilter(o({ status: "PAYMENT_PENDING" }), "payment_pending")).toBe(true);
    expect(matchesFilter(o({ status: "CONFIRMED" }), "payment_pending")).toBe(true);
    expect(matchesFilter(o({ status: "CANCELLED" }), "payment_pending")).toBe(false);
    expect(matchesFilter(o({ status: "CONFIRMED", paymentStatus: "SUCCESS" }), "payment_pending")).toBe(false);
  });
  it("searches id, table, name and phone case-insensitively", () => {
    for (const q of ["0001", "t1", "ASHA", "99999", "  "]) expect(matchesSearch(o(), q)).toBe(true);
    expect(matchesSearch(o({ customerName: null }), "zzz")).toBe(false);
  });
  it("sorts newest first and supports billsOnly", () => {
    const rows = [o({ displayId: "A", createdAt: "2026-01-01T00:00:00Z", paymentStatus: "SUCCESS" }), o({ displayId: "B", createdAt: "2026-02-01T00:00:00Z" }), o({ displayId: "C", createdAt: "2026-03-01T00:00:00Z", paymentStatus: "REFUNDED" })];
    expect(filterOrders(rows, {}).map((r) => r.displayId)).toEqual(["C", "B", "A"]);
    expect(filterOrders(rows, { billsOnly: true }).map((r) => r.displayId)).toEqual(["C", "A"]);
  });
});
