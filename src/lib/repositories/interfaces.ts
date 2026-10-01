/**
 * Repository interfaces — the ONLY persistence API that services, API routes and UI-facing code may use.
 * Firebase implementations live in ./firebase. Methods that accept `tx` participate in a Firestore
 * transaction (all reads must happen before writes inside a transaction).
 */
import type {
  ActivityLog, Addon, Bill, Category, Counters, Coupon, CouponRedemption, Customer, DiningTable, Ingredient, InventoryTransaction, LoyaltyProgram,
  LoyaltyReward, Member, Notification, Order, Payment, Product, Recipe, Restaurant, Review, ScratchCampaign, ScratchCard, Settlement, StaffInvitation,
  Tx, UsageRecord, UserProfile, VariantGroup,
} from "./types";
import type { ListOptions } from "./firebase/base";

export type { ListOptions };

export interface Crud<T extends { id: string }> {
  get(id: string, tx?: Tx): Promise<T | null>;
  getMany(ids: string[], tx?: Tx): Promise<T[]>;
  list(opts?: ListOptions, tx?: Tx): Promise<T[]>;
  count(opts?: Pick<ListOptions, "where">): Promise<number>;
  create(id: string | null, data: Omit<T, "id">, tx?: Tx): Promise<T>;
  set(id: string, data: Omit<T, "id">, tx?: Tx): Promise<void>;
  update(id: string, patch: Partial<Omit<T, "id">>, tx?: Tx): Promise<void>;
  remove(id: string, tx?: Tx): Promise<void>;
  newId(): string;
}

/* ---------------------------- global (non-tenant) ---------------------------- */
export interface RestaurantRepository {
  get(id: string, tx?: Tx): Promise<Restaurant | null>;
  /** Atomically reserves the slug, creates the restaurant, the OWNER membership, counters and links the user. */
  createWithOwner(input: { slug: string; owner: { id: string; email: string; name: string }; data: Omit<Restaurant, "id" | "slug" | "ownerId" | "createdAt" | "updatedAt"> }): Promise<Restaurant>;
  update(id: string, patch: Partial<Omit<Restaurant, "id" | "ownerId" | "slug" | "createdAt">>, tx?: Tx): Promise<void>;
  slugExists(slug: string): Promise<boolean>;
}

export interface UserRepository {
  get(uid: string): Promise<UserProfile | null>;
  /** Creates the profile if missing; never stores credentials. */
  ensure(uid: string, email: string, name: string): Promise<UserProfile>;
  addRestaurant(uid: string, restaurantId: string, tx?: Tx): Promise<void>;
}

/** Public, unauthenticated resolution of unguessable identifiers (server side only). */
export interface PublicLookupRepository {
  resolveSlug(slug: string): Promise<string | null>;
  resolveQrToken(token: string): Promise<{ restaurantId: string; tableId: string } | null>;
  resolveOrderToken(token: string): Promise<{ restaurantId: string; orderId: string } | null>;
}

/* ------------------------------- tenant scoped ------------------------------- */
export interface MembershipRepository extends Crud<Member> {
  listAll(): Promise<Member[]>;
}
export interface StaffRepository extends Crud<StaffInvitation> {
  listPending(now: Date): Promise<StaffInvitation[]>;
  revokePendingForEmail(email: string): Promise<void>;
}
export type CategoryRepository = Crud<Category>;
export interface ProductRepository extends Crud<Product> {
  listAll(limit?: number): Promise<Product[]>;
  removeVariantGroupRef(groupId: string): Promise<void>;
  removeAddonRef(addonId: string): Promise<void>;
  clearCategory(categoryId: string): Promise<void>;
}
export type VariantRepository = Crud<VariantGroup>;
export type AddonRepository = Crud<Addon>;
export type IngredientRepository = Crud<Ingredient>;
export type RecipeRepository = Crud<Recipe>;
export interface InventoryTransactionRepository {
  /** Append-only: there is intentionally no update/remove. */
  create(id: string | null, data: Omit<InventoryTransaction, "id">, tx?: Tx): Promise<InventoryTransaction>;
  get(id: string, tx?: Tx): Promise<InventoryTransaction | null>;
  getMany(ids: string[], tx?: Tx): Promise<InventoryTransaction[]>;
  list(opts?: ListOptions): Promise<InventoryTransaction[]>;
  count(opts?: { where?: ListOptions["where"] }): Promise<number>;
  col(): FirebaseFirestore.CollectionReference;
  ref(id: string): FirebaseFirestore.DocumentReference;
}
export interface TableRepository extends Crud<DiningTable> {
  /** Creates the table and registers its public QR token in the global index. */
  createWithQr(restaurantId: string, data: Omit<DiningTable, "id">): Promise<DiningTable>;
  rotateQr(restaurantId: string, id: string, newToken: string): Promise<DiningTable>;
  deleteWithQr(id: string): Promise<void>;
  getByQrToken(token: string): Promise<DiningTable | null>;
}
export type CustomerRepository = Crud<Customer>;
export interface OrderRepository extends Crud<Order> {
  /** Writes the order plus its customer-safe public projection and kitchen ticket. */
  save(order: Order, tx?: Tx): Promise<void>;
  listRecent(limit: number): Promise<Order[]>;
  listCreatedBetween(from: Date, to: Date, limit?: number): Promise<Order[]>;
  listForTable(tableId: string, tx?: Tx): Promise<Order[]>;
}
export type PaymentRepository = Crud<Payment>;
export type BillRepository = Crud<Bill>;
export interface CouponRepository extends Crud<Coupon> {
  countRedemptionsForCustomer(couponId: string, customerKey: string, tx?: Tx): Promise<number>;
  getRedemption(couponId: string, orderId: string, tx?: Tx): Promise<CouponRedemption | null>;
  addRedemption(couponId: string, orderId: string, customerKey: string, tx: Tx): void;
  removeRedemption(couponId: string, orderId: string, tx: Tx): void;
}
export interface LoyaltyRepository extends Crud<LoyaltyReward> {
  getProgram(): Promise<LoyaltyProgram | null>;
  getProgramTx(tx: Tx): Promise<LoyaltyProgram | null>;
  saveProgram(p: LoyaltyProgram): Promise<LoyaltyProgram>;
  rewardId(customerId: string, milestone: number): string;
}
export type ScratchCampaignRepository = Crud<ScratchCampaign>;
export type ScratchCardRepository = Crud<ScratchCard>;
export interface UsageRepository extends Crud<UsageRecord> {
  getCounters(tx?: Tx): Promise<Counters>;
  setCounters(c: Counters, tx?: Tx): void | Promise<void>;
  listCharged(before: Date, limit: number): Promise<UsageRecord[]>;
  listForSettlement(settlementId: string, limit: number): Promise<UsageRecord[]>;
}
export type SettlementRepository = Crud<Settlement>;
export type ReviewRepository = Crud<Review>;
export interface ActivityLogRepository {
  append(entry: Omit<ActivityLog, "id" | "createdAt">, tx?: Tx): void | Promise<void>;
  list(limit: number): Promise<ActivityLog[]>;
}
export interface NotificationRepository extends Crud<Notification> {
  /** Idempotent by key: the same key always addresses the same document. */
  push(key: string, n: { type: string; title: string; body?: string }, tx?: Tx): void | Promise<void>;
  markRead(id?: string): Promise<void>;
  listRecent(limit: number): Promise<Notification[]>;
}
export interface AnalyticsRepository {
  ordersBetween(from: Date, to: Date, limit?: number): Promise<Order[]>;
  customersCreatedSince(d: Date): Promise<number>;
  rewardsSince(d: Date): Promise<{ unlocked: number; claimed: number }>;
  inventoryDeductionsSince(d: Date): Promise<number>;
  lowStockIngredients(): Promise<Ingredient[]>;
  tableCounts(): Promise<{ occupied: number; total: number }>;
}

export interface TenantRepositories {
  restaurantId: string;
  members: MembershipRepository;
  staff: StaffRepository;
  categories: CategoryRepository;
  products: ProductRepository;
  variantGroups: VariantRepository;
  addons: AddonRepository;
  ingredients: IngredientRepository;
  recipes: RecipeRepository;
  inventoryTransactions: InventoryTransactionRepository;
  tables: TableRepository;
  customers: CustomerRepository;
  orders: OrderRepository;
  payments: PaymentRepository;
  bills: BillRepository;
  coupons: CouponRepository;
  loyalty: LoyaltyRepository;
  scratchCampaigns: ScratchCampaignRepository;
  scratchCards: ScratchCardRepository;
  usage: UsageRepository;
  settlements: SettlementRepository;
  reviews: ReviewRepository;
  activityLogs: ActivityLogRepository;
  notifications: NotificationRepository;
  analytics: AnalyticsRepository;
}

export interface Repositories {
  restaurants: RestaurantRepository;
  users: UserRepository;
  lookup: PublicLookupRepository;
  tenant(restaurantId: string): TenantRepositories;
  /** Run `fn` in a Firestore transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
