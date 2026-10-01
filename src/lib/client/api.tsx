"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiClientError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = "NETWORK") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const emit = (ok: boolean) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("cp-network", { detail: { ok } }));
};

export async function apiFetch<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      cache: "no-store",
    });
  } catch {
    emit(false);
    throw new ApiClientError("Network problem. Check your connection and try again.");
  }
  emit(true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard")) {
      window.location.href = "/login?expired=1";
    }
    throw new ApiClientError((data as { error?: string }).error ?? "Something went wrong.", res.status, (data as { code?: string }).code ?? "ERROR");
  }
  return data as T;
}

export const post = <T = unknown,>(url: string, json?: unknown) => apiFetch<T>(url, { method: "POST", json: json ?? {} });
export const patch = <T = unknown,>(url: string, json: unknown) => apiFetch<T>(url, { method: "PATCH", json });
export const put = <T = unknown,>(url: string, json: unknown) => apiFetch<T>(url, { method: "PUT", json });
export const del = <T = unknown,>(url: string) => apiFetch<T>(url, { method: "DELETE" });

/** Fetch + optional polling (paused when the tab is hidden). Cleans up on unmount. */
export function useApi<T>(url: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const alive = useRef(true);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const my = ++seq.current;
      if (!silent) setLoading(true);
      try {
        const d = await apiFetch<T>(url);
        if (alive.current && my === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (alive.current && my === seq.current) setError((e as Error).message);
      } finally {
        if (alive.current && my === seq.current) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount / url change
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!opts.poll || !url) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, opts.poll);
    const onVis = () => document.visibilityState === "visible" && load(true);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [opts.poll, url, load]);

  return { data, error, loading, reload: () => load(true), setData };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
