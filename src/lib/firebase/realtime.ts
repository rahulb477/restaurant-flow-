"use client";
import {
  collection, doc, limit as fsLimit, onSnapshot, orderBy, query, Timestamp, where, type DocumentData, type Query, type QuerySnapshot, type Unsubscribe,
} from "firebase/firestore";
import { getClientDb } from "./client";

/**
 * Framework-free Firestore listeners (client SDK). Every function returns an unsubscribe function — callers (the
 * hooks in src/lib/client/realtime.ts) MUST call it on unmount. Visibility is enforced by firestore.rules, not here.
 * Timestamps are converted to ISO strings so documents have the same JSON shape the REST endpoints return.
 */
export type Live<T> = { id: string } & T;
type Err = (e: Error) => void;

function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  return v;
}
const shape = <T,>(id: string, d: DocumentData) => ({ ...(plain(d) as object), id }) as Live<T>;
const rows = <T,>(s: QuerySnapshot<DocumentData>) => s.docs.map((d) => shape<T>(d.id, d.data()));
const tenant = (rid: string, sub: string) => collection(getClientDb(), "restaurants", rid, sub);

function watch<T>(q: Query<DocumentData>, cb: (rows: Live<T>[]) => void, onError: Err): Unsubscribe {
  return onSnapshot(q, (s) => cb(rows<T>(s)), (e) => onError(e));
}

/** Staff order board / orders page: newest 200 orders. */
export const subscribeOrders = <T,>(rid: string, cb: (r: Live<T>[]) => void, onError: Err) => watch<T>(query(tenant(rid, "orders"), orderBy("createdAt", "desc"), fsLimit(200)), cb, onError);

/**
 * Kitchen display. Kitchens read `kitchenTickets` (items + notes only — no prices, no customer contact data).
 * Two listeners are merged: every active ticket, plus anything touched in the last 2 hours (the "Completed" column).
 */
export function subscribeKitchenTickets<T extends { orderId: string }>(rid: string, cb: (r: Live<T & { id: string }>[]) => void, onError: Err): Unsubscribe {
  const col = tenant(rid, "kitchenTickets");
  let a = new Map<string, Live<T>>();
  let b = new Map<string, Live<T>>();
  const emit = () => {
    const m = new Map([...b, ...a]);
    cb(Array.from(m.values()).map((t) => ({ ...t, id: t.orderId })));
  };
  const u1 = onSnapshot(query(col, where("active", "==", true), fsLimit(200)), (s) => { a = new Map(rows<T>(s).map((r) => [r.id, r])); emit(); }, (e) => onError(e));
  const since = Timestamp.fromMillis(Date.now() - 2 * 3600_000);
  const u2 = onSnapshot(query(col, where("updatedAt", ">=", since), fsLimit(200)), (s) => { b = new Map(rows<T>(s).map((r) => [r.id, r])); emit(); }, (e) => onError(e));
  return () => { u1(); u2(); };
}

/** Customer tracking: one unguessable-token document containing only customer-safe fields. */
export function subscribePublicOrder<T>(token: string, cb: (r: Live<T> | null) => void, onError: Err): Unsubscribe {
  return onSnapshot(doc(getClientDb(), "publicOrders", token), (s) => cb(s.exists() ? shape<T>(s.id, s.data()) : null), (e) => onError(e));
}

export const subscribeTables = <T,>(rid: string, cb: (r: Live<T>[]) => void, onError: Err) => watch<T>(query(tenant(rid, "tables"), fsLimit(500)), cb, onError);

/** Payment documents for one order (cashier / manager / owner only). */
export const subscribePayments = <T,>(rid: string, orderId: string, cb: (r: Live<T>[]) => void, onError: Err) => watch<T>(query(tenant(rid, "payments"), where("orderId", "==", orderId), fsLimit(20)), cb, onError);

/** Inventory alerts: active ingredients at or below their threshold (evaluated client-side from the live stock). */
export function subscribeLowStock<T extends { currentStock: number; lowStockThreshold: number; isActive: boolean }>(rid: string, cb: (r: Live<T>[]) => void, onError: Err) {
  return watch<T>(query(tenant(rid, "ingredients"), fsLimit(1000)), (all) => cb(all.filter((i) => i.isActive && i.currentStock <= i.lowStockThreshold)), onError);
}

export const subscribeNotifications = <T,>(rid: string, cb: (r: Live<T>[]) => void, onError: Err) => watch<T>(query(tenant(rid, "notifications"), orderBy("createdAt", "desc"), fsLimit(30)), cb, onError);
