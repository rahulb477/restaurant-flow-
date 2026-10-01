/**
 * Pure, side-effect-free business rules. Everything money-related is in MINOR units (paise/cents).
 * These functions are the single source of truth used by server services and unit tests.
 */

/* ------------------------------ money ------------------------------ */
export const toMinor = (major: number) => Math.round((Number.isFinite(major) ? major : 0) * 100);
export const toMajor = (minor: number) => minor / 100;
export function formatMoney(minor: number, currency = "INR", locale?: string) {
  const loc = locale ?? (currency === "INR" ? "en-IN" : "en-US");
  return new Intl.NumberFormat(loc, { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

/* ---------------------------- settings ----------------------------- */
export type PaymentTiming = "PAY_FIRST" | "PAY_AT_END";
export type FeeMode = "CUSTOMER_BASED" | "STORE_BASED";
export type Settings = {
  paymentTiming: PaymentTiming;
  customerOrdering: boolean;
  tableOrdering: boolean;
  payments: { cash: boolean; upi: boolean; online: boolean; upiId: string; upiName: string };
  fees: { mode: FeeMode; amountMinor: number; thresholdMinor: number; blockOnThreshold: boolean };
  tax: { enabled: boolean; name: string; ratePct: number; mode: "EXCLUSIVE" | "INCLUSIVE" };
  geofence: { enabled: boolean; latitude: number | null; longitude: number | null; radiusMeters: number };
  googleReviewUrl: string;
  whatsapp: string;
  orderPrefix: string;
  inventoryDeductOn: "CONFIRMED" | "PREPARING" | "COMPLETED";
  allowNegativeStock: boolean;
  invoiceFooter: string;
};

export function defaultSettings(d: { feeMinor?: number; thresholdMinor?: number; prefix?: string } = {}): Settings {
  return {
    paymentTiming: "PAY_AT_END",
    customerOrdering: true,
    tableOrdering: true,
    payments: { cash: true, upi: true, online: false, upiId: "", upiName: "" },
    fees: { mode: "CUSTOMER_BASED", amountMinor: d.feeMinor ?? 100, thresholdMinor: d.thresholdMinor ?? 50000, blockOnThreshold: false },
    tax: { enabled: false, name: "GST", ratePct: 5, mode: "EXCLUSIVE" },
    geofence: { enabled: false, latitude: null, longitude: null, radiusMeters: 100 },
    googleReviewUrl: "",
    whatsapp: "",
    orderPrefix: d.prefix ?? "CP",
    inventoryDeductOn: "PREPARING",
    allowNegativeStock: false,
    invoiceFooter: "Thank you for visiting!",
  };
}

type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T)) ?? base;
  const out: Dict = { ...(base as Dict) };
  for (const k of Object.keys(over)) {
    out[k] = isObj((base as Dict)[k]) ? deepMerge((base as Dict)[k], over[k]) : over[k] === undefined ? (base as Dict)[k] : over[k];
  }
  return out as T;
}
export const mergeSettings = (raw: unknown, defaults: Settings = defaultSettings()): Settings => deepMerge(defaults, raw);

/* ----------------------------- errors ------------------------------ */
export class OrderError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "ORDER_INVALID", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ----------------------------- pricing ----------------------------- */
export type ProductLike = {
  id: string;
  name: string;
  price: number;
  categoryId: string | null;
  isActive: boolean;
  availability: string;
  variantGroupIds: string[];
  addonIds: string[];
};
export type VariantGroupLike = {
  id: string;
  name: string;
  selectionType: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  isActive: boolean;
  options: { id: string; name: string; priceAdjustment: number; isAvailable: boolean }[];
};
export type AddonLike = { id: string; name: string; price: number; isActive: boolean; isAvailable: boolean };
export type Selection = { variants?: Record<string, string[]>; addonIds?: string[]; qty: number; notes?: string };

export type PricedLine = {
  productId: string;
  name: string;
  categoryId: string | null;
  qty: number;
  unitPrice: number;
  variants: { groupId: string; groupName: string; optionId: string; optionName: string; priceAdjustment: number }[];
  addons: { addonId: string; name: string; price: number }[];
  notes: string;
  lineTotal: number;
};

export function priceLine(
  product: ProductLike,
  groups: Map<string, VariantGroupLike>,
  addons: Map<string, AddonLike>,
  sel: Selection,
): PricedLine {
  if (!product.isActive || product.availability !== "AVAILABLE") {
    throw new OrderError(`${product.name} is currently unavailable`, "PRODUCT_UNAVAILABLE", 409);
  }
  const qty = Math.floor(sel.qty);
  if (!(qty >= 1 && qty <= 99)) throw new OrderError(`Invalid quantity for ${product.name}`);
  const variants: PricedLine["variants"] = [];
  for (const gid of product.variantGroupIds) {
    const g = groups.get(gid);
    if (!g || !g.isActive) continue;
    const chosen = Array.from(new Set(sel.variants?.[gid] ?? []));
    const min = g.required ? Math.max(1, g.minSelections) : g.minSelections;
    const max = g.selectionType === "SINGLE" ? 1 : Math.max(g.maxSelections, 1);
    if (chosen.length < min) throw new OrderError(`Select ${g.name} for ${product.name}`, "VARIANT_REQUIRED");
    if (chosen.length > max) throw new OrderError(`Too many ${g.name} options for ${product.name}`, "VARIANT_MAX");
    for (const oid of chosen) {
      const o = g.options.find((x) => x.id === oid);
      if (!o || !o.isAvailable) throw new OrderError(`${g.name} option unavailable for ${product.name}`, "VARIANT_UNAVAILABLE");
      variants.push({ groupId: g.id, groupName: g.name, optionId: o.id, optionName: o.name, priceAdjustment: o.priceAdjustment });
    }
  }
  for (const gid of Object.keys(sel.variants ?? {})) {
    if (!product.variantGroupIds.includes(gid) && (sel.variants?.[gid] ?? []).length) {
      throw new OrderError(`Invalid option for ${product.name}`, "VARIANT_INVALID");
    }
  }
  const addonLines: PricedLine["addons"] = [];
  for (const aid of Array.from(new Set(sel.addonIds ?? []))) {
    const a = addons.get(aid);
    if (!a || !product.addonIds.includes(aid) || !a.isActive || !a.isAvailable) {
      throw new OrderError(`Add-on unavailable for ${product.name}`, "ADDON_UNAVAILABLE");
    }
    addonLines.push({ addonId: a.id, name: a.name, price: a.price });
  }
  const unit = product.price + variants.reduce((s, v) => s + v.priceAdjustment, 0) + addonLines.reduce((s, a) => s + a.price, 0);
  return {
    productId: product.id,
    name: product.name,
    categoryId: product.categoryId,
    qty,
    unitPrice: unit,
    variants,
    addons: addonLines,
    notes: (sel.notes ?? "").slice(0, 300),
    lineTotal: unit * qty,
  };
}

/* ---------------------------- platform fee ---------------------------- */
export function calculatePlatformFee(opts: { mode: FeeMode; amountMinor: number; eligible: boolean }) {
  if (!opts.eligible || opts.amountMinor <= 0) return { customerFee: 0, storeFee: 0, ledgerAmount: 0 };
  return opts.mode === "CUSTOMER_BASED"
    ? { customerFee: opts.amountMinor, storeFee: 0, ledgerAmount: opts.amountMinor }
    : { customerFee: 0, storeFee: opts.amountMinor, ledgerAmount: opts.amountMinor };
}

/* ------------------------------- coupons ------------------------------ */
export type CouponLike = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  maxDiscount: number;
  minOrderValue: number;
  usageLimit: number;
  usageCount: number;
  perCustomerLimit: number;
  validFrom: Date | null;
  validUntil: Date | null;
  applicableProducts: string[];
  applicableCategories: string[];
  isActive: boolean;
};
export type CouponResult = { ok: true; discount: number } | { ok: false; reason: string };

export function validateCoupon(
  coupon: CouponLike | null | undefined,
  ctx: { lines: { productId: string | null; categoryId: string | null; lineTotal: number }[]; subtotal: number; customerRedemptions: number; now?: Date },
): CouponResult {
  const now = ctx.now ?? new Date();
  if (!coupon) return { ok: false, reason: "Coupon code not found" };
  if (!coupon.isActive) return { ok: false, reason: "This coupon is not active" };
  if (coupon.validFrom && now < coupon.validFrom) return { ok: false, reason: "This coupon is not valid yet" };
  if (coupon.validUntil && now > coupon.validUntil) return { ok: false, reason: "This coupon has expired" };
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) return { ok: false, reason: "This coupon has reached its usage limit" };
  if (coupon.perCustomerLimit > 0 && ctx.customerRedemptions >= coupon.perCustomerLimit) {
    return { ok: false, reason: "You have already used this coupon the maximum number of times" };
  }
  if (ctx.subtotal < coupon.minOrderValue) return { ok: false, reason: "Order total is below the minimum for this coupon" };
  const restricted = coupon.applicableProducts.length > 0 || coupon.applicableCategories.length > 0;
  const base = restricted
    ? ctx.lines
        .filter(
          (l) =>
            (l.productId && coupon.applicableProducts.includes(l.productId)) || (l.categoryId && coupon.applicableCategories.includes(l.categoryId)),
        )
        .reduce((s, l) => s + l.lineTotal, 0)
    : ctx.subtotal;
  if (base <= 0) return { ok: false, reason: "This coupon does not apply to the items in your cart" };
  let discount = coupon.discountType === "PERCENTAGE" ? Math.round((base * Math.min(coupon.discountValue, 100)) / 100) : coupon.discountValue;
  if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.max(0, Math.min(discount, base));
  return { ok: true, discount };
}

/* ------------------------------ totals ------------------------------ */
export function calculateTotals(opts: {
  subtotal: number;
  couponDiscount: number;
  manualDiscount?: number;
  tax: Settings["tax"];
  customerFee: number;
}) {
  const discount = Math.min(opts.couponDiscount, opts.subtotal);
  const manual = Math.max(0, Math.min(opts.manualDiscount ?? 0, opts.subtotal - discount));
  const taxable = opts.subtotal - discount - manual;
  let tax = 0;
  if (opts.tax.enabled && opts.tax.ratePct > 0) {
    tax =
      opts.tax.mode === "EXCLUSIVE"
        ? Math.round((taxable * opts.tax.ratePct) / 100)
        : taxable - Math.round(taxable / (1 + opts.tax.ratePct / 100));
  }
  const addedTax = opts.tax.enabled && opts.tax.mode === "EXCLUSIVE" ? tax : 0;
  return { subtotal: opts.subtotal, discount, manualDiscount: manual, tax, platformFee: opts.customerFee, total: taxable + addedTax + opts.customerFee };
}

/* ---------------------------- order states ---------------------------- */
export const ORDER_STATUSES = [
  "DRAFT",
  "PLACED",
  "PAYMENT_PENDING",
  "PAYMENT_COMPLETED",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["PLACED", "PAYMENT_PENDING", "CANCELLED"],
  PLACED: ["CONFIRMED", "CANCELLED"],
  PAYMENT_PENDING: ["PAYMENT_COMPLETED", "CANCELLED"],
  PAYMENT_COMPLETED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED", "COMPLETED"],
  SERVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};
export const canTransition = (from: string, to: string) => (ORDER_TRANSITIONS[from as OrderStatus] ?? []).includes(to as OrderStatus);

export const PAYMENT_STATUSES = ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED"] as const;
const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING", "SUCCESS", "FAILED", "CANCELLED"],
  PROCESSING: ["SUCCESS", "FAILED", "CANCELLED"],
  FAILED: ["PROCESSING", "SUCCESS", "CANCELLED"],
  SUCCESS: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};
export const canPaymentTransition = (from: string, to: string) => (PAYMENT_TRANSITIONS[from] ?? []).includes(to);

/** Initial order status given timing + source. Staff-created orders skip customer confirmation. */
export function initialOrderStatus(source: string, timing: PaymentTiming): OrderStatus {
  if (source !== "QR") return "CONFIRMED";
  return timing === "PAY_FIRST" ? "PAYMENT_PENDING" : "PLACED";
}

export const ORDER_ACTIONS = {
  confirm: { to: "CONFIRMED" },
  start: { to: "PREPARING" },
  ready: { to: "READY" },
  serve: { to: "SERVED" },
  complete: { to: "COMPLETED" },
  cancel: { to: "CANCELLED" },
} as const;
export type OrderAction = keyof typeof ORDER_ACTIONS;

/* ------------------------------- geofence ------------------------------ */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function checkGeofence(cfg: Settings["geofence"], pos: { lat: number; lng: number } | null | undefined) {
  if (!cfg.enabled) return { allowed: true as const, distance: 0 };
  if (cfg.latitude == null || cfg.longitude == null) return { allowed: true as const, distance: 0 };
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return { allowed: false as const, distance: Infinity, reason: "LOCATION_REQUIRED" };
  const distance = haversineMeters({ lat: cfg.latitude, lng: cfg.longitude }, pos);
  return distance <= cfg.radiusMeters
    ? { allowed: true as const, distance }
    : { allowed: false as const, distance, reason: "OUTSIDE_RADIUS" };
}

/* ------------------------------ inventory ------------------------------ */
export function computeDeductions(
  lines: { productId: string | null; qty: number }[],
  recipes: Map<string, { ingredientId: string; quantity: number }[]>,
) {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.productId) continue;
    for (const r of recipes.get(l.productId) ?? []) out.set(r.ingredientId, (out.get(r.ingredientId) ?? 0) + r.quantity * l.qty);
  }
  return out;
}
export const isLowStock = (stock: number, threshold: number) => stock <= threshold;

/* ------------------------------- loyalty -------------------------------- */
export function evaluateVisit(prevVisits: number, requiredVisits: number) {
  const visits = prevVisits + 1;
  const req = Math.max(1, requiredVisits);
  return { visits, unlockMilestone: visits % req === 0 ? visits : null, progress: visits % req === 0 ? req : visits % req, required: req };
}

/* --------------------------------- scratch ------------------------------ */
export function pickScratchReward(rewards: { label: string; probability: number }[], rand: number) {
  let acc = 0;
  const roll = rand * 100;
  for (const r of rewards) {
    acc += Math.max(0, r.probability);
    if (roll < acc) return r.label;
  }
  return null;
}

/* ---------------------------------- UPI --------------------------------- */
export function buildUpiUri(o: { upiId: string; name: string; amountMinor: number; note?: string; ref?: string; currency?: string }) {
  const p = new URLSearchParams();
  p.set("pa", o.upiId);
  p.set("pn", o.name);
  p.set("am", (o.amountMinor / 100).toFixed(2));
  p.set("cu", o.currency ?? "INR");
  if (o.note) p.set("tn", o.note);
  if (o.ref) p.set("tr", o.ref);
  return `upi://pay?${p.toString().replace(/\+/g, "%20")}`;
}

/* --------------------------------- misc --------------------------------- */
export const formatOrderId = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(6, "0")}`;
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "cafe";
export const normalizePhone = (p: string) => p.replace(/[^\d+]/g, "");
