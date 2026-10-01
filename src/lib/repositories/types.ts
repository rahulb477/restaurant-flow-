/**
 * Domain entities persisted in Firestore. Money is integer minor units (paise). Dates are JS Dates
 * (converted from/to Firestore Timestamps by the repositories).
 */
import type { Role } from "@/lib/permissions";

export type { Role };
export type MemberStatus = "ACTIVE" | "DISABLED";

export type UserProfile = { id: string; email: string; name: string; restaurantIds: string[]; createdAt: Date };

export type Restaurant = {
  id: string;
  slug: string;
  ownerId: string;
  name: string;
  businessType: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  logoUrl: string;
  accent: string;
  currency: string;
  timezone: string;
  /** Raw, partial tenant settings (merged with defaults by `resolveSettings`). */
  settings: Record<string, unknown>;
  loyaltyProgram: LoyaltyProgram | null;
  onboardingStep: number;
  onboardingDone: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type LoyaltyProgram = { requiredVisits: number; rewardTitle: string; rewardItem: string; isActive: boolean };

/** restaurants/{rid}/members/{userId} — the source of truth for tenant access. */
export type Member = { id: string; userId: string; restaurantId: string; role: Role; status: MemberStatus; name: string; email: string; createdAt: Date };

/** restaurants/{rid}/staff/{staffId} — staff invitations. The invite token itself is never stored, only its hash. */
export type StaffInvitation = {
  id: string;
  restaurantId: string;
  email: string;
  role: Exclude<Role, "OWNER">;
  tokenHash: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: Date;
  emailedAt: Date | null;
  invitedBy: string;
  createdAt: Date;
};

export type Category = { id: string; name: string; imageUrl: string; sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date };
export type Product = {
  id: string;
  categoryId: string | null;
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
  price: number;
  availability: "AVAILABLE" | "UNAVAILABLE" | "OUT_OF_STOCK" | "TEMPORARILY_UNAVAILABLE";
  isPopular: boolean;
  isRecommended: boolean;
  isVeg: boolean;
  variantGroupIds: string[];
  addonIds: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};
export type VariantOption = { id: string; name: string; priceAdjustment: number; isAvailable: boolean; sortOrder: number };
export type VariantGroup = {
  id: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: VariantOption[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};
export type Addon = { id: string; name: string; price: number; isAvailable: boolean; isActive: boolean; sortOrder: number; createdAt: Date; updatedAt: Date };

export type Ingredient = { id: string; name: string; unit: string; currentStock: number; lowStockThreshold: number; costPerUnit: number; isActive: boolean; createdAt: Date; updatedAt: Date };
export type RecipeItem = { ingredientId: string; quantity: number };
/** Document id === productId, so a product has at most one recipe. */
export type Recipe = { id: string; productId: string; items: RecipeItem[]; notes: string; updatedAt: Date };
/** Append-only. Deterministic id for order deductions: `${orderId}_${ingredientId}_ORDER_DEDUCTION`. */
export type InventoryTransaction = {
  id: string;
  ingredientId: string;
  orderId: string | null;
  type: "ORDER_DEDUCTION" | "ADJUSTMENT" | "RESTOCK" | "WASTE";
  quantityBefore: number;
  quantityUsed: number;
  quantityAfter: number;
  note: string;
  actorId: string | null;
  createdAt: Date;
};

export type DiningTable = { id: string; name: string; number: number; qrToken: string; status: "FREE" | "OCCUPIED" | "RESERVED"; isActive: boolean; createdAt: Date; updatedAt: Date };

export type Customer = { id: string; phone: string; email: string; name: string; orders: number; totalSpend: number; visits: number; lastOrderAt: Date | null; createdAt: Date };

export type OrderLine = {
  lineId: string;
  productId: string | null;
  name: string;
  custom: boolean;
  categoryId: string | null;
  categoryName: string;
  qty: number;
  unitPrice: number;
  variants: { groupId: string; groupName: string; optionId: string; optionName: string; priceAdjustment: number }[];
  addons: { addonId: string; name: string; price: number }[];
  notes: string;
  lineTotal: number;
};

export type Order = {
  id: string;
  restaurantId: string;
  displayId: string;
  publicToken: string;
  idempotencyKey: string | null;
  source: "QR" | "POS" | "STAFF" | "MANUAL" | "ADMIN";
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  tableId: string | null;
  tableName: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  items: OrderLine[];
  customerNotes: string;
  staffNotes: string;
  kitchenNotes: string;
  couponId: string | null;
  couponCode: string;
  subtotal: number;
  discount: number;
  manualDiscount: number;
  tax: number;
  taxLabel: string;
  platformFee: number;
  total: number;
  paymentTiming: string;
  inventoryProcessed: boolean;
  loyaltyProcessed: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type PaymentStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "CANCELLED" | "REFUNDED";
export type Payment = {
  id: string;
  orderId: string;
  method: "CASH" | "UPI" | "ONLINE";
  status: PaymentStatus;
  amount: number;
  reference: string;
  provider: string;
  providerRef: string;
  recordedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Document id === orderId. */
export type Bill = { id: string; orderId: string; emailedTo: string; emailedAt: Date | null; createdAt: Date };

export type Coupon = {
  id: string; // === code
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FIXED";
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
  createdAt: Date;
  updatedAt: Date;
};
/** coupons/{code}/redemptions/{orderId} */
export type CouponRedemption = { id: string; couponId: string; orderId: string; customerKey: string; createdAt: Date };

/** Loyalty reward. Document id `${customerId}_${milestone}` makes a milestone unlock idempotent. */
export type LoyaltyReward = { id: string; customerId: string; milestone: number; title: string; status: "UNLOCKED" | "CLAIMED"; code: string; createdAt: Date; claimedAt: Date | null };

export type ScratchReward = { label: string; probability: number };
export type ScratchCampaign = { id: string; name: string; startsAt: Date | null; endsAt: Date | null; rewards: ScratchReward[]; usageLimit: number; usedCount: number; isActive: boolean; createdAt: Date; updatedAt: Date };
/** Scratch card issued for an order. Document id === orderId (one card per order). */
export type ScratchCard = { id: string; campaignId: string; orderId: string; status: "ISSUED" | "REVEALED" | "CLAIMED"; reward: string; code: string; createdAt: Date };

/** Usage ledger entry. Document id === orderId: every record references exactly one order. */
export type UsageRecord = { id: string; orderId: string; orderDisplayId: string; amount: number; mode: "CUSTOMER_BASED" | "STORE_BASED"; status: "CHARGED" | "VOID" | "SETTLED"; settlementId: string | null; createdAt: Date };
export type Settlement = { id: string; amount: number; orderCount: number; status: "PENDING" | "PROCESSING" | "PAID" | "FAILED"; reference: string; cutoff: Date; createdAt: Date; updatedAt: Date };
/** restaurants/{rid}/system/counters — server-owned counters. */
export type Counters = { orderSeq: number; usageBalance: number; usageOrders: number };

/** Document id === orderId (one review per order). */
export type Review = { id: string; orderId: string; rating: number; text: string; createdAt: Date };

export type ActivityLog = {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
};
export type Notification = { id: string; type: string; title: string; body: string; isRead: boolean; createdAt: Date };

export type Tx = import("firebase-admin/firestore").Transaction;
