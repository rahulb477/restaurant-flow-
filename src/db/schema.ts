import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const rid = () => uuid("restaurant_id").notNull();

/* ---------- identity ---------- */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: created(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: created(),
});

export const authTokens = pgTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(), // VERIFY | RESET
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/* ---------- tenancy ---------- */
export const restaurants = pgTable(
  "restaurants",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    ownerId: uuid("owner_id").notNull(),
    name: text("name").notNull(),
    businessType: text("business_type").notNull().default("CAFE"),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    country: text("country").notNull().default("India"),
    pincode: text("pincode").notNull().default(""),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    logoUrl: text("logo_url").notNull().default(""),
    accent: text("accent").notNull().default("#f59e0b"),
    currency: text("currency").notNull().default("INR"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    settings: jsonb("settings").notNull().default({}),
    onboardingStep: integer("onboarding_step").notNull().default(1),
    onboardingDone: boolean("onboarding_done").notNull().default(false),
    orderSeq: integer("order_seq").notNull().default(0),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("restaurants_owner_idx").on(t.ownerId)],
);

export const members = pgTable(
  "members",
  {
    id: id(),
    restaurantId: rid(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(), // OWNER MANAGER CASHIER KITCHEN STAFF
    status: text("status").notNull().default("ACTIVE"), // ACTIVE DISABLED
    createdAt: created(),
  },
  (t) => [uniqueIndex("members_unique").on(t.restaurantId, t.userId), index("members_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    restaurantId: rid(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("PENDING"), // PENDING ACCEPTED REVOKED
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index("invitations_rest_idx").on(t.restaurantId)],
);

/* ---------- menu ---------- */
export const categories = pgTable(
  "categories",
  {
    id: id(),
    restaurantId: rid(),
    name: text("name").notNull(),
    imageUrl: text("image_url").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("categories_rest_idx").on(t.restaurantId, t.sortOrder)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    restaurantId: rid(),
    categoryId: uuid("category_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull().default(""),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    price: integer("price").notNull().default(0), // minor units
    availability: text("availability").notNull().default("AVAILABLE"), // AVAILABLE UNAVAILABLE OUT_OF_STOCK TEMPORARILY_UNAVAILABLE
    isPopular: boolean("is_popular").notNull().default(false),
    isRecommended: boolean("is_recommended").notNull().default(false),
    isVeg: boolean("is_veg").notNull().default(true),
    variantGroupIds: jsonb("variant_group_ids").$type<string[]>().notNull().default([]),
    addonIds: jsonb("addon_ids").$type<string[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("products_rest_cat_idx").on(t.restaurantId, t.categoryId)],
);

export type VariantOption = { id: string; name: string; priceAdjustment: number; isAvailable: boolean; sortOrder: number };
export const variantGroups = pgTable(
  "variant_groups",
  {
    id: id(),
    restaurantId: rid(),
    name: text("name").notNull(),
    selectionType: text("selection_type").notNull().default("SINGLE"), // SINGLE MULTIPLE
    required: boolean("required").notNull().default(false),
    minSelections: integer("min_selections").notNull().default(0),
    maxSelections: integer("max_selections").notNull().default(1),
    options: jsonb("options").$type<VariantOption[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("vg_rest_idx").on(t.restaurantId)],
);

export const addons = pgTable(
  "addons",
  {
    id: id(),
    restaurantId: rid(),
    name: text("name").notNull(),
    price: integer("price").notNull().default(0),
    isAvailable: boolean("is_available").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("addons_rest_idx").on(t.restaurantId)],
);

/* ---------- inventory ---------- */
export const ingredients = pgTable(
  "ingredients",
  {
    id: id(),
    restaurantId: rid(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("g"),
    currentStock: doublePrecision("current_stock").notNull().default(0),
    lowStockThreshold: doublePrecision("low_stock_threshold").notNull().default(0),
    costPerUnit: integer("cost_per_unit").notNull().default(0), // minor units
    isActive: boolean("is_active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("ingredients_rest_idx").on(t.restaurantId)],
);

export type RecipeItem = { ingredientId: string; quantity: number };
export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    restaurantId: rid(),
    productId: uuid("product_id").notNull(),
    items: jsonb("items").$type<RecipeItem[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("recipes_product_unique").on(t.restaurantId, t.productId)],
);

export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: id(),
    restaurantId: rid(),
    ingredientId: uuid("ingredient_id").notNull(),
    orderId: uuid("order_id"),
    type: text("type").notNull(), // ORDER_DEDUCTION ADJUSTMENT RESTOCK WASTE
    quantityBefore: doublePrecision("quantity_before").notNull(),
    quantityUsed: doublePrecision("quantity_used").notNull(), // signed: positive = consumed
    quantityAfter: doublePrecision("quantity_after").notNull(),
    note: text("note").notNull().default(""),
    actorId: uuid("actor_id"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("inv_tx_idem").on(t.orderId, t.ingredientId, t.type),
    index("inv_tx_rest_idx").on(t.restaurantId, t.createdAt),
  ],
);

/* ---------- tables ---------- */
export const diningTables = pgTable(
  "dining_tables",
  {
    id: id(),
    restaurantId: rid(),
    name: text("name").notNull(),
    number: integer("number").notNull().default(0),
    qrToken: text("qr_token").notNull().unique(),
    status: text("status").notNull().default("FREE"), // FREE OCCUPIED RESERVED
    isActive: boolean("is_active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("tables_rest_idx").on(t.restaurantId)],
);

/* ---------- customers ---------- */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    restaurantId: rid(),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    name: text("name").notNull().default(""),
    orders: integer("orders").notNull().default(0),
    totalSpend: integer("total_spend").notNull().default(0),
    visits: integer("visits").notNull().default(0),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex("customers_key").on(t.restaurantId, t.phone, t.email)],
);

/* ---------- orders ---------- */
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

export const orders = pgTable(
  "orders",
  {
    id: id(),
    restaurantId: rid(),
    displayId: text("display_id").notNull(),
    publicToken: text("public_token").notNull().unique(),
    idempotencyKey: text("idempotency_key"),
    source: text("source").notNull().default("QR"), // QR POS STAFF MANUAL ADMIN
    status: text("status").notNull().default("PLACED"),
    paymentStatus: text("payment_status").notNull().default("PENDING"),
    paymentMethod: text("payment_method").notNull().default(""),
    tableId: uuid("table_id"),
    tableName: text("table_name").notNull().default(""),
    customerId: uuid("customer_id"),
    customerName: text("customer_name").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    customerEmail: text("customer_email").notNull().default(""),
    items: jsonb("items").$type<OrderLine[]>().notNull().default([]),
    customerNotes: text("customer_notes").notNull().default(""),
    staffNotes: text("staff_notes").notNull().default(""),
    kitchenNotes: text("kitchen_notes").notNull().default(""),
    couponId: uuid("coupon_id"),
    couponCode: text("coupon_code").notNull().default(""),
    subtotal: integer("subtotal").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    manualDiscount: integer("manual_discount").notNull().default(0),
    tax: integer("tax").notNull().default(0),
    taxLabel: text("tax_label").notNull().default(""),
    platformFee: integer("platform_fee").notNull().default(0), // charged to customer
    total: integer("total").notNull().default(0),
    paymentTiming: text("payment_timing").notNull().default("PAY_AT_END"),
    inventoryProcessed: boolean("inventory_processed").notNull().default(false),
    loyaltyProcessed: boolean("loyalty_processed").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: created(),
    updatedAt: updated(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("orders_rest_status_idx").on(t.restaurantId, t.status, t.createdAt),
    index("orders_rest_date_idx").on(t.restaurantId, t.createdAt),
    uniqueIndex("orders_idem").on(t.restaurantId, t.idempotencyKey),
    uniqueIndex("orders_display").on(t.restaurantId, t.displayId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    restaurantId: rid(),
    orderId: uuid("order_id").notNull(),
    method: text("method").notNull(), // CASH UPI ONLINE
    status: text("status").notNull().default("PENDING"),
    amount: integer("amount").notNull(),
    reference: text("reference").notNull().default(""),
    recordedBy: uuid("recorded_by"),
    createdAt: created(),
  },
  (t) => [index("payments_rest_idx").on(t.restaurantId, t.createdAt), index("payments_order_idx").on(t.orderId)],
);

export const bills = pgTable(
  "bills",
  {
    id: id(),
    restaurantId: rid(),
    orderId: uuid("order_id").notNull(),
    emailedTo: text("emailed_to").notNull().default(""),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex("bills_order_unique").on(t.orderId)],
);

/* ---------- promotions ---------- */
export const coupons = pgTable(
  "coupons",
  {
    id: id(),
    restaurantId: rid(),
    code: text("code").notNull(),
    name: text("name").notNull().default(""),
    discountType: text("discount_type").notNull().default("PERCENTAGE"), // PERCENTAGE FIXED
    discountValue: integer("discount_value").notNull().default(0), // percent or minor units
    maxDiscount: integer("max_discount").notNull().default(0), // 0 = none
    minOrderValue: integer("min_order_value").notNull().default(0),
    usageLimit: integer("usage_limit").notNull().default(0), // 0 = unlimited
    usageCount: integer("usage_count").notNull().default(0),
    perCustomerLimit: integer("per_customer_limit").notNull().default(0),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    applicableProducts: jsonb("applicable_products").$type<string[]>().notNull().default([]),
    applicableCategories: jsonb("applicable_categories").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("coupons_code_unique").on(t.restaurantId, t.code)],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: id(),
    restaurantId: rid(),
    couponId: uuid("coupon_id").notNull(),
    orderId: uuid("order_id").notNull(),
    customerKey: text("customer_key").notNull().default(""),
    createdAt: created(),
  },
  (t) => [uniqueIndex("redemption_order_unique").on(t.couponId, t.orderId), index("redemption_cust_idx").on(t.couponId, t.customerKey)],
);

/* ---------- loyalty / scratch ---------- */
export const loyaltyPrograms = pgTable("loyalty_programs", {
  restaurantId: uuid("restaurant_id").primaryKey(),
  requiredVisits: integer("required_visits").notNull().default(5),
  rewardTitle: text("reward_title").notNull().default("Free coffee"),
  rewardItem: text("reward_item").notNull().default(""),
  isActive: boolean("is_active").notNull().default(false),
  updatedAt: updated(),
});

export const loyaltyRewards = pgTable(
  "loyalty_rewards",
  {
    id: id(),
    restaurantId: rid(),
    customerId: uuid("customer_id").notNull(),
    milestone: integer("milestone").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("UNLOCKED"), // UNLOCKED CLAIMED
    code: text("code").notNull().default(""),
    createdAt: created(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("loyalty_milestone_unique").on(t.customerId, t.milestone)],
);

export type ScratchReward = { label: string; probability: number };
export const scratchCampaigns = pgTable("scratch_campaigns", {
  id: id(),
  restaurantId: rid(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  rewards: jsonb("rewards").$type<ScratchReward[]>().notNull().default([]),
  usageLimit: integer("usage_limit").notNull().default(0),
  usedCount: integer("used_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
});

export const scratchIssuances = pgTable(
  "scratch_issuances",
  {
    id: id(),
    restaurantId: rid(),
    campaignId: uuid("campaign_id").notNull(),
    orderId: uuid("order_id").notNull(),
    status: text("status").notNull().default("ISSUED"), // ISSUED REVEALED CLAIMED
    reward: text("reward").notNull().default(""),
    code: text("code").notNull().default(""),
    createdAt: created(),
  },
  (t) => [uniqueIndex("scratch_order_unique").on(t.orderId)],
);

/* ---------- usage / billing ---------- */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: id(),
    restaurantId: rid(),
    orderId: uuid("order_id").notNull(),
    orderDisplayId: text("order_display_id").notNull().default(""),
    amount: integer("amount").notNull(),
    mode: text("mode").notNull(), // CUSTOMER_BASED STORE_BASED
    status: text("status").notNull().default("CHARGED"), // CHARGED VOID SETTLED
    settlementId: uuid("settlement_id"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("usage_order_unique").on(t.orderId), index("usage_rest_idx").on(t.restaurantId, t.createdAt)],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    restaurantId: rid(),
    amount: integer("amount").notNull(),
    orderCount: integer("order_count").notNull(),
    status: text("status").notNull().default("PENDING"), // PENDING PROCESSING PAID FAILED
    reference: text("reference").notNull().default(""),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("settle_rest_idx").on(t.restaurantId, t.createdAt)],
);

/* ---------- misc ---------- */
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    restaurantId: rid(),
    orderId: uuid("order_id").notNull(),
    rating: integer("rating").notNull(),
    text: text("text").notNull().default(""),
    createdAt: created(),
  },
  (t) => [uniqueIndex("reviews_order_unique").on(t.orderId)],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: id(),
    restaurantId: rid(),
    actorId: uuid("actor_id"),
    actorName: text("actor_name").notNull().default(""),
    actorRole: text("actor_role").notNull().default(""),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull().default(""),
    entityId: text("entity_id").notNull().default(""),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: created(),
  },
  (t) => [index("activity_rest_idx").on(t.restaurantId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    restaurantId: rid(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    dedupeKey: text("dedupe_key"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: created(),
  },
  (t) => [uniqueIndex("notif_dedupe").on(t.restaurantId, t.dedupeKey), index("notif_rest_idx").on(t.restaurantId, t.createdAt)],
);

export const files = pgTable("files", {
  id: id(),
  restaurantId: rid(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: created(),
});
