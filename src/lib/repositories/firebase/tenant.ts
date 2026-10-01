import type { Firestore } from "firebase-admin/firestore";
import { ROOT, decode, encode, safeId } from "@/lib/firebase/firestore";
import { FirestoreCollection, type ListOptions } from "./base";
import type * as I from "../interfaces";
import type {
  ActivityLog, Counters, Customer, DiningTable, Ingredient, InventoryTransaction, LoyaltyProgram, Member, Notification, Order, Product, Restaurant, StaffInvitation, Tx, UsageRecord,
  Coupon, CouponRedemption, LoyaltyReward, Settlement,
} from "../types";

const tenantPath = (rid: string, name: string) => `${ROOT.restaurants}/${rid}/${name}`;

export class FirebaseMembershipRepository extends FirestoreCollection<Member> implements I.MembershipRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "members"));
  }
  listAll() {
    return this.list({ limit: 500 });
  }
}

export class FirebaseStaffRepository extends FirestoreCollection<StaffInvitation> implements I.StaffRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "staff"));
  }
  async listPending(now: Date) {
    const rows = await this.list({ where: [["status", "==", "PENDING"]], limit: 200 });
    return rows.filter((r) => r.expiresAt > now).sort((a, b) => +b.createdAt - +a.createdAt);
  }
  async revokePendingForEmail(email: string) {
    const rows = await this.list({ where: [["email", "==", email]] });
    await Promise.all(rows.filter((r) => r.status === "PENDING").map((r) => this.update(r.id, { status: "REVOKED" })));
  }
}

export class FirebaseCategoryRepository extends FirestoreCollection<import("../types").Category> implements I.CategoryRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "categories"));
  }
}

async function batched(db: Firestore, ops: ((b: FirebaseFirestore.WriteBatch) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
}

export class FirebaseProductRepository extends FirestoreCollection<Product> implements I.ProductRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "products"));
  }
  listAll(limit = 1000) {
    return this.list({ limit });
  }
  private async patchWhere(pred: (p: Product) => boolean, patch: (p: Product) => Partial<Product>) {
    const rows = (await this.listAll()).filter(pred);
    await batched(this.db, rows.map((p) => (b) => b.update(this.ref(p.id), encode(patch(p)))));
  }
  removeVariantGroupRef(groupId: string) {
    return this.patchWhere((p) => p.variantGroupIds.includes(groupId), (p) => ({ variantGroupIds: p.variantGroupIds.filter((g) => g !== groupId) }));
  }
  removeAddonRef(addonId: string) {
    return this.patchWhere((p) => p.addonIds.includes(addonId), (p) => ({ addonIds: p.addonIds.filter((a) => a !== addonId) }));
  }
  clearCategory(categoryId: string) {
    return this.patchWhere((p) => p.categoryId === categoryId, () => ({ categoryId: null }));
  }
}

export class FirebaseVariantRepository extends FirestoreCollection<import("../types").VariantGroup> implements I.VariantRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "variantGroups"));
  }
}
export class FirebaseAddonRepository extends FirestoreCollection<import("../types").Addon> implements I.AddonRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "addons"));
  }
}
export class FirebaseIngredientRepository extends FirestoreCollection<Ingredient> implements I.IngredientRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "ingredients"));
  }
}
export class FirebaseRecipeRepository extends FirestoreCollection<import("../types").Recipe> implements I.RecipeRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "recipes"));
  }
}

/** Append-only history: exposes create/read only. Firestore rules additionally forbid client writes. */
export class FirebaseInventoryTransactionRepository implements I.InventoryTransactionRepository {
  private c: FirestoreCollection<InventoryTransaction>;
  constructor(db: Firestore, rid: string) {
    this.c = new FirestoreCollection(db, tenantPath(rid, "inventoryTransactions"));
  }
  create(id: string | null, data: Omit<InventoryTransaction, "id">, tx?: Tx) {
    return this.c.create(id, data, tx);
  }
  get(id: string, tx?: Tx) {
    return this.c.get(id, tx);
  }
  getMany(ids: string[], tx?: Tx) {
    return this.c.getMany(ids, tx);
  }
  list(opts?: ListOptions) {
    return this.c.list(opts);
  }
  count(opts?: { where?: ListOptions["where"] }) {
    return this.c.count(opts);
  }
  col() {
    return this.c.col();
  }
  ref(id: string) {
    return this.c.ref(id);
  }
}

export class FirebaseTableRepository extends FirestoreCollection<DiningTable> implements I.TableRepository {
  constructor(
    db: Firestore,
    private rid: string,
  ) {
    super(db, tenantPath(rid, "tables"));
  }
  private qr(token: string) {
    return this.db.collection(ROOT.qrTokens).doc(token);
  }
  async createWithQr(_rid: string, data: Omit<DiningTable, "id">) {
    const ref = this.col().doc();
    const b = this.db.batch();
    b.create(ref, encode(data));
    b.create(this.qr(data.qrToken), { restaurantId: this.rid, tableId: ref.id, createdAt: new Date() });
    await b.commit();
    return { ...data, id: ref.id };
  }
  async rotateQr(_rid: string, id: string, newToken: string) {
    const cur = await this.get(id);
    if (!cur) throw new Error("Table not found");
    const b = this.db.batch();
    b.delete(this.qr(cur.qrToken));
    b.create(this.qr(newToken), { restaurantId: this.rid, tableId: id, createdAt: new Date() });
    b.update(this.ref(id), encode({ qrToken: newToken, updatedAt: new Date() }));
    await b.commit();
    return { ...cur, qrToken: newToken };
  }
  async deleteWithQr(id: string) {
    const cur = await this.get(id);
    if (!cur) return;
    const b = this.db.batch();
    b.delete(this.ref(id));
    b.delete(this.qr(cur.qrToken));
    await b.commit();
  }
  async getByQrToken(token: string) {
    const s = await this.qr(token).get();
    if (!s.exists || s.data()!.restaurantId !== this.rid) return null; // a token only ever resolves inside its own tenant
    return this.get(s.data()!.tableId as string);
  }
}

export class FirebaseCustomerRepository extends FirestoreCollection<Customer> implements I.CustomerRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "customers"));
  }
}

/* ------------------------------ orders + projections ------------------------------ */
const KITCHEN_ACTIVE = ["CONFIRMED", "PREPARING", "READY"];

/** Customer-safe projection readable by anyone holding the (unguessable) token. No contact details, no internal notes. */
export function publicOrderProjection(o: Order) {
  return {
    restaurantId: o.restaurantId,
    orderId: o.id,
    displayId: o.displayId,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    tableName: o.tableName,
    items: o.items,
    subtotal: o.subtotal,
    discount: o.discount + o.manualDiscount,
    tax: o.tax,
    taxLabel: o.taxLabel,
    platformFee: o.platformFee,
    total: o.total,
    couponCode: o.couponCode,
    customerNotes: o.customerNotes,
    paymentTiming: o.paymentTiming,
    customerName: o.customerName,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Kitchen projection: items + notes only (no prices, no customer contact details). */
export function kitchenTicketProjection(o: Order) {
  return {
    orderId: o.id,
    displayId: o.displayId,
    status: o.status,
    active: KITCHEN_ACTIVE.includes(o.status),
    tableName: o.tableName,
    source: o.source,
    items: o.items.map((l) => ({ lineId: l.lineId, productId: l.productId, name: l.name, custom: l.custom, qty: l.qty, notes: l.notes, variants: l.variants.map((v) => ({ groupName: v.groupName, optionName: v.optionName })), addons: l.addons.map((a) => ({ name: a.name })) })),
    customerNotes: o.customerNotes,
    staffNotes: o.staffNotes,
    kitchenNotes: o.kitchenNotes,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export class FirebaseOrderRepository extends FirestoreCollection<Order> implements I.OrderRepository {
  constructor(
    db: Firestore,
    private rid: string,
  ) {
    super(db, tenantPath(rid, "orders"));
  }
  private tickets() {
    return this.db.collection(tenantPath(this.rid, "kitchenTickets"));
  }
  private pub(token: string) {
    return this.db.collection(ROOT.publicOrders).doc(token);
  }

  async save(order: Order, tx?: Tx) {
    const orderDoc = encode(order);
    const pub = publicOrderProjection(order);
    const ticket = kitchenTicketProjection(order);
    if (tx) {
      tx.set(this.ref(order.id), orderDoc);
      tx.set(this.pub(order.publicToken), pub);
      tx.set(this.tickets().doc(order.id), ticket);
      return;
    }
    const b = this.db.batch();
    b.set(this.ref(order.id), orderDoc);
    b.set(this.pub(order.publicToken), pub);
    b.set(this.tickets().doc(order.id), ticket);
    await b.commit();
  }
  async create(id: string | null, data: Omit<Order, "id">, tx?: Tx) {
    const order = { ...data, id: id ?? this.newId() } as Order;
    await this.save(order, tx);
    return order;
  }
  async set(id: string, data: Omit<Order, "id">, tx?: Tx) {
    await this.save({ ...data, id } as Order, tx);
  }
  async update(id: string, patch: Partial<Omit<Order, "id">>, tx?: Tx) {
    const cur = await this.get(id, tx);
    if (!cur) throw new Error("Order not found");
    await this.save({ ...cur, ...patch, updatedAt: new Date() } as Order, tx);
  }
  listRecent(limit: number) {
    return this.list({ orderBy: [["createdAt", "desc"]], limit });
  }
  listCreatedBetween(from: Date, to: Date, limit = 10000) {
    return this.list({ where: [["createdAt", ">=", from], ["createdAt", "<=", to]], orderBy: [["createdAt", "asc"]], limit });
  }
  listForTable(tableId: string, tx?: Tx) {
    return this.list({ where: [["tableId", "==", tableId]], limit: 500 }, tx);
  }
}

export class FirebasePaymentRepository extends FirestoreCollection<import("../types").Payment> implements I.PaymentRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "payments"));
  }
}
export class FirebaseBillRepository extends FirestoreCollection<import("../types").Bill> implements I.BillRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "bills"));
  }
}

export class FirebaseCouponRepository extends FirestoreCollection<Coupon> implements I.CouponRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "coupons"));
  }
  private redemptions(couponId: string) {
    return this.ref(couponId).collection("redemptions");
  }
  async countRedemptionsForCustomer(couponId: string, customerKey: string, tx?: Tx) {
    if (!customerKey) return 0;
    const q = this.redemptions(couponId).where("customerKey", "==", customerKey);
    const snap = tx ? await tx.get(q) : await q.get();
    return snap.size;
  }
  async getRedemption(couponId: string, orderId: string, tx?: Tx): Promise<CouponRedemption | null> {
    const ref = this.redemptions(couponId).doc(orderId);
    const s = tx ? await tx.get(ref) : await ref.get();
    return s.exists ? decode<CouponRedemption>(s.id, s.data()) : null;
  }
  addRedemption(couponId: string, orderId: string, customerKey: string, tx: Tx) {
    tx.create(this.redemptions(couponId).doc(orderId), { couponId, orderId, customerKey, createdAt: new Date() });
  }
  removeRedemption(couponId: string, orderId: string, tx: Tx) {
    tx.delete(this.redemptions(couponId).doc(orderId));
  }
}

export class FirebaseLoyaltyRepository extends FirestoreCollection<LoyaltyReward> implements I.LoyaltyRepository {
  constructor(
    db: Firestore,
    private rid: string,
  ) {
    super(db, tenantPath(rid, "loyalty"));
  }
  private restRef() {
    return this.db.collection(ROOT.restaurants).doc(this.rid);
  }
  rewardId(customerId: string, milestone: number) {
    return `${customerId}_${milestone}`;
  }
  async getProgram() {
    const s = await this.restRef().get();
    return ((s.data() as Partial<Restaurant> | undefined)?.loyaltyProgram ?? null) as LoyaltyProgram | null;
  }
  async getProgramTx(tx: Tx) {
    const s = await tx.get(this.restRef());
    return ((s.data() as Partial<Restaurant> | undefined)?.loyaltyProgram ?? null) as LoyaltyProgram | null;
  }
  async saveProgram(p: LoyaltyProgram) {
    await this.restRef().update({ loyaltyProgram: p, updatedAt: new Date() });
    return p;
  }
}

export class FirebaseScratchCampaignRepository extends FirestoreCollection<import("../types").ScratchCampaign> implements I.ScratchCampaignRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "scratchCampaigns"));
  }
}
export class FirebaseScratchCardRepository extends FirestoreCollection<import("../types").ScratchCard> implements I.ScratchCardRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "scratchCards"));
  }
}

export class FirebaseUsageRepository extends FirestoreCollection<UsageRecord> implements I.UsageRepository {
  private counters;
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "usage"));
    this.counters = db.collection(tenantPath(rid, "system")).doc("counters");
  }
  async getCounters(tx?: Tx): Promise<Counters> {
    const s = tx ? await tx.get(this.counters) : await this.counters.get();
    const d = (s.data() ?? {}) as Partial<Counters>;
    return { orderSeq: d.orderSeq ?? 0, usageBalance: d.usageBalance ?? 0, usageOrders: d.usageOrders ?? 0 };
  }
  setCounters(c: Counters, tx?: Tx) {
    if (tx) {
      tx.set(this.counters, c);
      return;
    }
    return this.counters.set(c).then(() => undefined);
  }
  async listCharged(before: Date, limit: number) {
    const rows = await this.list({ where: [["status", "==", "CHARGED"]], limit: limit * 4 });
    return rows.filter((r) => r.createdAt <= before).slice(0, limit);
  }
  listForSettlement(settlementId: string, limit: number) {
    return this.list({ where: [["settlementId", "==", settlementId]], limit });
  }
}

export class FirebaseSettlementRepository extends FirestoreCollection<Settlement> implements I.SettlementRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "settlements"));
  }
}
export class FirebaseReviewRepository extends FirestoreCollection<import("../types").Review> implements I.ReviewRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "reviews"));
  }
}

export class FirebaseActivityLogRepository implements I.ActivityLogRepository {
  private c: FirestoreCollection<ActivityLog>;
  constructor(db: Firestore, rid: string) {
    this.c = new FirestoreCollection(db, tenantPath(rid, "activityLogs"));
  }
  append(entry: Omit<ActivityLog, "id" | "createdAt">, tx?: Tx) {
    const data = { ...entry, createdAt: new Date() };
    if (tx) {
      tx.create(this.c.col().doc(), encode(data));
      return;
    }
    return this.c.create(null, data).then(() => undefined);
  }
  list(limit: number) {
    return this.c.list({ orderBy: [["createdAt", "desc"]], limit });
  }
}

export class FirebaseNotificationRepository extends FirestoreCollection<Notification> implements I.NotificationRepository {
  constructor(db: Firestore, rid: string) {
    super(db, tenantPath(rid, "notifications"));
  }
  push(key: string, n: { type: string; title: string; body?: string }, tx?: Tx) {
    const data = { type: n.type, title: n.title, body: n.body ?? "", isRead: false, createdAt: new Date() };
    const ref = this.ref(safeId(key));
    if (tx) {
      tx.set(ref, data);
      return;
    }
    return ref.set(data).then(() => undefined);
  }
  async markRead(id?: string) {
    if (id) return this.update(id, { isRead: true });
    const unread = await this.list({ where: [["isRead", "==", false]], limit: 400 });
    const b = this.db.batch();
    unread.forEach((n) => b.update(this.ref(n.id), { isRead: true }));
    await b.commit();
  }
  listRecent(limit: number) {
    return this.list({ orderBy: [["createdAt", "desc"]], limit });
  }
}

export class FirebaseAnalyticsRepository implements I.AnalyticsRepository {
  private orders;
  private customers;
  private loyalty;
  private invTx;
  private ingredients;
  private tables;
  constructor(db: Firestore, rid: string) {
    this.orders = new FirebaseOrderRepository(db, rid);
    this.customers = new FirebaseCustomerRepository(db, rid);
    this.loyalty = new FirebaseLoyaltyRepository(db, rid);
    this.invTx = new FirebaseInventoryTransactionRepository(db, rid);
    this.ingredients = new FirebaseIngredientRepository(db, rid);
    this.tables = new FirebaseTableRepository(db, rid);
  }
  ordersBetween(from: Date, to: Date, limit = 10000) {
    return this.orders.listCreatedBetween(from, to, limit);
  }
  customersCreatedSince(d: Date) {
    return this.customers.count({ where: [["createdAt", ">=", d]] });
  }
  async rewardsSince(d: Date) {
    const rows = await this.loyalty.list({ where: [["createdAt", ">=", d]], limit: 5000 });
    return { unlocked: rows.length, claimed: rows.filter((r) => r.status === "CLAIMED").length };
  }
  inventoryDeductionsSince(d: Date) {
    return this.invTx.list({ where: [["type", "==", "ORDER_DEDUCTION"]], limit: 20000 }).then((rows) => rows.filter((r) => r.createdAt >= d).length);
  }
  async lowStockIngredients() {
    const rows = await this.ingredients.list({ where: [["isActive", "==", true]], limit: 1000 });
    return rows.filter((i) => i.currentStock <= i.lowStockThreshold);
  }
  async tableCounts() {
    const rows = await this.tables.list({ limit: 1000 });
    return { occupied: rows.filter((t) => t.status === "OCCUPIED").length, total: rows.length };
  }
}
