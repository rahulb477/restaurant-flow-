/**
 * Where "Cloud Functions" logic lives.
 *
 * This product does NOT deploy Firebase Cloud Functions. Everything that must be trusted — order totals, usage
 * and platform-fee records, inventory deduction, loyalty / scratch rewards, payment webhooks, staff invitations —
 * runs in Next.js API routes with the Firebase Admin SDK (src/lib/server/**), and Firestore rules deny clients
 * write access to those collections. Keeping a single server runtime avoids two deployables with duplicated
 * business logic. Should the owner later want Functions (e.g. scheduled jobs), `src/lib/server/services/*` are
 * framework-free and can be imported from a Functions entry point.
 *
 * This file is the typed client entry point for those trusted operations.
 */
export type TrustedEndpoint =
  | "/api/orders"
  | `/api/orders/${string}`
  | "/api/public/order"
  | "/api/public/quote"
  | "/api/public/pay"
  | "/api/dash/usage-settle"
  | "/api/dash/usage-submit"
  | "/api/dash/inventory-adjust";

export async function callTrusted<T>(endpoint: TrustedEndpoint, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const res = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}
