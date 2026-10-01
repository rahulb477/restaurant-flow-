import { describe, it, expect } from "vitest";
import {
  priceLine,
  validateCoupon,
  calculateTotals,
  calculatePlatformFee,
  canTransition,
  initialOrderStatus,
  checkGeofence,
  computeDeductions,
  evaluateVisit,
  pickScratchReward,
  buildUpiUri,
  canPaymentTransition,
  formatOrderId,
  toMinor,
  defaultSettings,
  type ProductLike,
  type AddonLike,
  type VariantGroupLike,
  type CouponLike,
} from "@/lib/calculations";
import { can, modulesFor } from "@/lib/permissions";

const coffee: ProductLike = {
  id: "p1",
  name: "Coffee",
  price: toMinor(100),
  categoryId: "c1",
  isActive: true,
  availability: "AVAILABLE",
  variantGroupIds: ["g1"],
  addonIds: ["a1"],
};
const groups = new Map<string, VariantGroupLike>([
  [
    "g1",
    {
      id: "g1",
      name: "Size",
      selectionType: "SINGLE",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      isActive: true,
      options: [
        { id: "s", name: "Small", priceAdjustment: 0, isAvailable: true },
        { id: "l", name: "Large", priceAdjustment: toMinor(30), isAvailable: true },
      ],
    },
  ],
]);
const addons = new Map<string, AddonLike>([["a1", { id: "a1", name: "Extra Cheese", price: toMinor(20), isActive: true, isAvailable: true }]]);
const coupon10: CouponLike = {
  id: "k1",
  code: "SAVE10",
  discountType: "PERCENTAGE",
  discountValue: 10,
  maxDiscount: 0,
  minOrderValue: 0,
  usageLimit: 0,
  usageCount: 0,
  perCustomerLimit: 0,
  validFrom: null,
  validUntil: null,
  applicableProducts: [],
  applicableCategories: [],
  isActive: true,
};

describe("order calculation", () => {
  it("coffee 100 + cheese 20, 10% coupon, fee 1 => 109", () => {
    const line = priceLine(coffee, groups, addons, { qty: 1, variants: { g1: ["s"] }, addonIds: ["a1"] });
    expect(line.lineTotal).toBe(12000);
    const c = validateCoupon(coupon10, { lines: [line], subtotal: line.lineTotal, customerRedemptions: 0 });
    expect(c).toEqual({ ok: true, discount: 1200 });
    const totals = calculateTotals({ subtotal: line.lineTotal, couponDiscount: 1200, tax: defaultSettings().tax, customerFee: 100 });
    expect(totals.total).toBe(10900);
  });
  it("variant pricing applies per unit and quantity", () => {
    const l = priceLine(coffee, groups, addons, { qty: 2, variants: { g1: ["l"] } });
    expect(l.unitPrice).toBe(13000);
    expect(l.lineTotal).toBe(26000);
  });
  it("rejects missing required variant, unavailable product and bad addon", () => {
    expect(() => priceLine(coffee, groups, addons, { qty: 1 })).toThrow(/Select Size/);
    expect(() => priceLine({ ...coffee, availability: "OUT_OF_STOCK" }, groups, addons, { qty: 1, variants: { g1: ["s"] } })).toThrow(/unavailable/);
    expect(() => priceLine(coffee, groups, addons, { qty: 1, variants: { g1: ["s"] }, addonIds: ["zzz"] })).toThrow();
  });
  it("tax exclusive and inclusive", () => {
    const ex = calculateTotals({ subtotal: 10000, couponDiscount: 0, tax: { enabled: true, name: "GST", ratePct: 5, mode: "EXCLUSIVE" }, customerFee: 0 });
    expect(ex.total).toBe(10500);
    const inc = calculateTotals({ subtotal: 10500, couponDiscount: 0, tax: { enabled: true, name: "GST", ratePct: 5, mode: "INCLUSIVE" }, customerFee: 0 });
    expect(inc.total).toBe(10500);
    expect(inc.tax).toBe(500);
  });
});

describe("coupons", () => {
  const ctx = { lines: [{ productId: "p1", categoryId: "c1", lineTotal: 10000 }], subtotal: 10000, customerRedemptions: 0 };
  it("validates expiry, limits, minimums, restrictions", () => {
    expect(validateCoupon(null, ctx).ok).toBe(false);
    expect(validateCoupon({ ...coupon10, isActive: false }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...coupon10, validUntil: new Date(Date.now() - 1000) }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...coupon10, usageLimit: 1, usageCount: 1 }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...coupon10, perCustomerLimit: 1 }, { ...ctx, customerRedemptions: 1 }).ok).toBe(false);
    expect(validateCoupon({ ...coupon10, minOrderValue: 20000 }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...coupon10, applicableProducts: ["other"] }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...coupon10, applicableCategories: ["c1"] }, ctx)).toEqual({ ok: true, discount: 1000 });
  });
  it("caps fixed discounts and maxDiscount", () => {
    expect(validateCoupon({ ...coupon10, discountType: "FIXED", discountValue: 99999 }, ctx)).toEqual({ ok: true, discount: 10000 });
    expect(validateCoupon({ ...coupon10, discountValue: 50, maxDiscount: 300 }, ctx)).toEqual({ ok: true, discount: 300 });
  });
});

describe("platform fee & usage", () => {
  it("customer-based charges customer, store-based does not", () => {
    expect(calculatePlatformFee({ mode: "CUSTOMER_BASED", amountMinor: 100, eligible: true })).toEqual({ customerFee: 100, storeFee: 0, ledgerAmount: 100 });
    expect(calculatePlatformFee({ mode: "STORE_BASED", amountMinor: 100, eligible: true })).toEqual({ customerFee: 0, storeFee: 100, ledgerAmount: 100 });
    expect(calculatePlatformFee({ mode: "STORE_BASED", amountMinor: 100, eligible: false }).ledgerAmount).toBe(0);
  });
});

describe("state machines", () => {
  it("allows valid and blocks invalid order transitions", () => {
    expect(canTransition("PLACED", "CONFIRMED")).toBe(true);
    expect(canTransition("PLACED", "READY")).toBe(false);
    expect(canTransition("COMPLETED", "PREPARING")).toBe(false);
    expect(canTransition("CANCELLED", "PLACED")).toBe(false);
    expect(canTransition("PREPARING", "READY")).toBe(true);
  });
  it("payment timing drives initial status", () => {
    expect(initialOrderStatus("QR", "PAY_FIRST")).toBe("PAYMENT_PENDING");
    expect(initialOrderStatus("QR", "PAY_AT_END")).toBe("PLACED");
    expect(initialOrderStatus("POS", "PAY_FIRST")).toBe("CONFIRMED");
  });
  it("payment states", () => {
    expect(canPaymentTransition("PENDING", "SUCCESS")).toBe(true);
    expect(canPaymentTransition("SUCCESS", "PENDING")).toBe(false);
    expect(canPaymentTransition("SUCCESS", "REFUNDED")).toBe(true);
  });
});

describe("geofence", () => {
  const cfg = { enabled: true, latitude: 28.6139, longitude: 77.209, radiusMeters: 100 };
  it("allows inside, blocks outside and missing location", () => {
    expect(checkGeofence(cfg, { lat: 28.6140, lng: 77.2091 }).allowed).toBe(true);
    expect(checkGeofence(cfg, { lat: 28.7, lng: 77.3 }).allowed).toBe(false);
    expect(checkGeofence(cfg, null).allowed).toBe(false);
    expect(checkGeofence({ ...cfg, enabled: false }, null).allowed).toBe(true);
  });
});

describe("inventory", () => {
  it("2 coffees deduct 400ml milk, 30g coffee, 20g sugar", () => {
    const recipes = new Map([["p1", [{ ingredientId: "milk", quantity: 200 }, { ingredientId: "coffee", quantity: 15 }, { ingredientId: "sugar", quantity: 10 }]]]);
    const d = computeDeductions([{ productId: "p1", qty: 2 }, { productId: null, qty: 5 }], recipes);
    expect(1000 - (d.get("milk") ?? 0)).toBe(600);
    expect(100 - (d.get("coffee") ?? 0)).toBe(70);
    expect(100 - (d.get("sugar") ?? 0)).toBe(80);
  });
  it("idempotent ledger keys: a replayed event is skipped", () => {
    const seen = new Set<string>();
    let stock = 1000;
    const apply = (orderId: string, ing: string, qty: number) => {
      const key = `${orderId}:${ing}:ORDER_DEDUCTION`;
      if (seen.has(key)) return;
      seen.add(key);
      stock -= qty;
    };
    apply("o1", "milk", 400);
    apply("o1", "milk", 400);
    expect(stock).toBe(600);
  });
});

describe("loyalty, scratch, upi, ids", () => {
  it("unlocks reward exactly at milestone", () => {
    expect(evaluateVisit(3, 5).unlockMilestone).toBeNull();
    expect(evaluateVisit(4, 5)).toMatchObject({ visits: 5, unlockMilestone: 5 });
    expect(evaluateVisit(9, 5).unlockMilestone).toBe(10);
  });
  it("scratch selection respects probabilities", () => {
    const r = [{ label: "Free cookie", probability: 20 }, { label: "10% off", probability: 30 }];
    expect(pickScratchReward(r, 0.1)).toBe("Free cookie");
    expect(pickScratchReward(r, 0.3)).toBe("10% off");
    expect(pickScratchReward(r, 0.9)).toBeNull();
  });
  it("builds exact-amount UPI uri", () => {
    const u = buildUpiUri({ upiId: "cafe@upi", name: "Demo Cafe", amountMinor: 10900, ref: "CP-000001" });
    expect(u).toContain("pa=cafe%40upi");
    expect(u).toContain("am=109.00");
    expect(u).toContain("cu=INR");
  });
  it("formats order ids", () => expect(formatOrderId("CP", 12)).toBe("CP-000012"));
});

describe("authorization matrix", () => {
  it("enforces roles", () => {
    expect(can("OWNER", "settings")).toBe(true);
    expect(can("MANAGER", "staff")).toBe(false);
    expect(can("KITCHEN", "pos")).toBe(false);
    expect(can("KITCHEN", "kds")).toBe(true);
    expect(can("CASHIER", "bills")).toBe(true);
    expect(can("STAFF", "bills")).toBe(false);
    expect(can(undefined, "pos")).toBe(false);
    expect(modulesFor("NOPE")).toEqual([]);
  });
});
