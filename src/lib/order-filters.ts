/** Pure, client-side views over the live order list (Firestore has no substring search or OR queries). */
export type FilterableOrder = {
  status: string;
  paymentStatus: string;
  displayId: string;
  tableName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  createdAt?: string | Date;
};

export const STATUS_FILTERS: Record<string, string[]> = {
  new: ["PLACED", "PAYMENT_COMPLETED"],
  confirmed: ["CONFIRMED"],
  preparing: ["PREPARING"],
  ready: ["READY"],
  completed: ["COMPLETED", "SERVED"],
  cancelled: ["CANCELLED"],
};

export function matchesFilter(o: FilterableOrder, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "payment_pending") return o.status === "PAYMENT_PENDING" || (o.paymentStatus === "PENDING" && !["CANCELLED", "COMPLETED"].includes(o.status));
  return (STATUS_FILTERS[filter] ?? []).includes(o.status);
}

export function matchesSearch(o: FilterableOrder, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [o.displayId, o.tableName, o.customerName, o.customerPhone].some((v) => (v ?? "").toLowerCase().includes(s));
}

export function filterOrders<T extends FilterableOrder>(orders: T[], opts: { filter?: string; q?: string; billsOnly?: boolean }): T[] {
  return orders
    .filter((o) => matchesFilter(o, opts.filter ?? "all") && matchesSearch(o, opts.q ?? ""))
    .filter((o) => !opts.billsOnly || ["SUCCESS", "REFUNDED"].includes(o.paymentStatus))
    .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0));
}
