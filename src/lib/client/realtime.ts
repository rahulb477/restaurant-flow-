"use client";
import { useEffect, useRef, useState } from "react";
import { ensureClientSignedIn } from "@/lib/firebase/auth";
import { firebaseReady } from "@/lib/firebase/client";
import * as rt from "@/lib/firebase/realtime";

type Sub<T> = (onData: (d: T) => void, onError: (e: Error) => void) => () => void;

/**
 * Generic live-data hook. Waits for the Firebase client sign-in (restored from the server session when needed),
 * subscribes, and ALWAYS unsubscribes on unmount / dependency change. `loading` is true until the first snapshot.
 */
function useLive<T>(subscribe: Sub<T> | null, key: string) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>({ key, data: null, error: null, loading: !!subscribe });
  // keep the latest subscribe closure without re-subscribing on every render
  const latest = useRef<Sub<T> | null>(null);
  useEffect(() => { latest.current = subscribe; });

  useEffect(() => {
    const sub = latest.current;
    if (!sub) return;
    const patch = (p: Partial<{ data: T | null; error: string | null; loading: boolean }>) => setState((s) => ({ ...s, key, ...p }));
    if (!firebaseReady()) { queueMicrotask(() => patch({ error: "Realtime is unavailable: Firebase is not configured.", loading: false })); return; }
    let off: (() => void) | null = null;
    let dead = false;
    ensureClientSignedIn()
      .then((u) => {
        if (dead) return;
        if (!u) return patch({ error: "Live updates need you to be signed in.", loading: false });
        off = sub(
          (d) => { if (!dead) patch({ data: d, error: null, loading: false }); },
          (e) => { if (!dead) patch({ error: e.message.includes("permission") ? "You don’t have permission to see live updates." : e.message, loading: false }); },
        );
      })
      .catch((e: Error) => { if (!dead) patch({ error: e.message, loading: false }); });
    return () => { dead = true; off?.(); };
  }, [key]);

  // data from a previous key (e.g. another restaurant) is never shown
  return state.key === key ? { data: state.data, error: state.error, loading: state.loading } : { data: null, error: null, loading: !!subscribe };
}

export function useOrdersLive<T>(rid: string) { return useLive<rt.Live<T>[]>((a, b) => rt.subscribeOrders<T>(rid, a, b), `orders:${rid}`); }
export function useKitchenLive<T extends { orderId: string }>(rid: string) { return useLive<rt.Live<T>[]>((a, b) => rt.subscribeKitchenTickets<T>(rid, a, b), `kds:${rid}`); }
export function useTablesLive<T>(rid: string) { return useLive<rt.Live<T>[]>((a, b) => rt.subscribeTables<T>(rid, a, b), `tables:${rid}`); }
export function useLowStockLive<T extends { currentStock: number; lowStockThreshold: number; isActive: boolean }>(rid: string) { return useLive<rt.Live<T>[]>((a, b) => rt.subscribeLowStock<T>(rid, a, b), `low:${rid}`); }
export function useNotificationsLive<T>(rid: string) { return useLive<rt.Live<T>[]>((a, b) => rt.subscribeNotifications<T>(rid, a, b), `notif:${rid}`); }
export function usePaymentsLive<T>(rid: string, orderId: string | null) { return useLive<rt.Live<T>[]>(orderId ? (a, b) => rt.subscribePayments<T>(rid, orderId, a, b) : null, `pay:${rid}:${orderId}`); }

/** Customer tracking. Needs no sign-in: access is by the unguessable order token. */
export function usePublicOrderLive<T>(token: string) {
  const [data, setData] = useState<rt.Live<T> | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!firebaseReady()) return;
    const off = rt.subscribePublicOrder<T>(token, (d) => { setData(d); setError(null); }, (e) => setError(e.message));
    return off;
  }, [token]);
  return { data, error };
}
