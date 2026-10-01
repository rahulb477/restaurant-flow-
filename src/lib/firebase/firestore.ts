import type { DocumentData, Firestore, Transaction } from "firebase-admin/firestore";

/**
 * Firestore helpers shared by every repository (server side).
 * Collection layout is documented in DATABASE_SCHEMA.md. Every tenant collection lives under
 * `restaurants/{restaurantId}/...` so a path can never address another tenant's data.
 */

export const TENANT_COLLECTIONS = [
  "members",
  "staff",
  "categories",
  "products",
  "variantGroups",
  "addons",
  "ingredients",
  "recipes",
  "tables",
  "customers",
  "orders",
  "payments",
  "bills",
  "coupons",
  "loyalty",
  "scratchCampaigns",
  "scratchCards",
  "usage",
  "settlements",
  "reviews",
  "activityLogs",
  "inventoryTransactions",
  "notifications",
  "kitchenTickets",
  "system",
] as const;
export type TenantCollection = (typeof TENANT_COLLECTIONS)[number];

/** Top-level, server-written lookup/projection collections. */
export const ROOT = {
  restaurants: "restaurants",
  users: "users",
  /** slug -> restaurantId (uniqueness + public resolution) */
  slugs: "slugs",
  /** qrToken -> { restaurantId, tableId } (stable, public QR resolution) */
  qrTokens: "qrTokens",
  /** publicToken -> customer-safe order projection (get-only for clients, never listable) */
  publicOrders: "publicOrders",
} as const;

type Timestampish = { toDate: () => Date };
const isTimestamp = (v: unknown): v is Timestampish => typeof v === "object" && v !== null && typeof (v as Timestampish).toDate === "function" && !(v instanceof Date);

/** Recursively converts Firestore Timestamps to Dates. */
export function decodeValue(v: unknown): unknown {
  if (isTimestamp(v)) return v.toDate();
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, decodeValue(x)]));
  }
  return v;
}

export function decode<T extends { id: string }>(id: string, data: DocumentData | undefined): T {
  return { ...(decodeValue(data ?? {}) as object), id } as T;
}

/** Drops `id` (stored as the document id) and `undefined` values. */
export function encode<T extends object>(data: T): DocumentData {
  const out: DocumentData = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "id" || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** Firestore ids must not contain "/" and must be < 1500 bytes. */
export const safeId = (s: string) => s.replace(/[/#?[\]\s]/g, "_").slice(0, 200);

export async function runTx<T>(db: Firestore, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.runTransaction(fn, { maxAttempts: 8 });
}
