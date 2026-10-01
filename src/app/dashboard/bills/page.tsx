"use client";
import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useApi, useDebounced } from "@/lib/client/api";
import { Button, DataTable, EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, PriceDisplay, SearchInput, StatusBadge } from "@/components/ui";
import type { OrderRow } from "@/components/order-ui";
import { RoleGate, useShell } from "@/components/shell";

export default function Page() {
  return <RoleGate module="bills"><Bills /></RoleGate>;
}

function Bills() {
  const { restaurant } = useShell();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useApi<{ items: OrderRow[]; total: number }>(`/api/orders?bills=1&limit=25&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return (
    <div>
      <PageHeader title="Bills" subtitle="Invoices for every paid order. View, print, download or email." />
      <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder="Search by order, table or customer…" className="mb-5 max-w-md" />
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <ListSkeleton /> : !data?.items.length ? <EmptyState title="No bills yet" text="Once an order is paid, its invoice appears here." /> : (
        <>
          <DataTable
            columns={[
              { key: "displayId", label: "Invoice", render: (o) => <span className="font-medium">{o.displayId}</span> },
              { key: "createdAt", label: "Date", render: (o) => new Date(o.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) },
              { key: "tableName", label: "Table", render: (o) => o.tableName || "—" },
              { key: "customerName", label: "Customer", render: (o) => o.customerName || o.customerPhone || "—" },
              { key: "paymentMethod", label: "Method" },
              { key: "paymentStatus", label: "Payment", render: (o) => <StatusBadge status={o.paymentStatus} /> },
              { key: "total", label: "Total", render: (o) => <PriceDisplay minor={o.total} currency={restaurant.currency} /> },
            ]}
            rows={data.items}
            actions={(o) => <Link href={`/dashboard/bills/${o.id}`}><Button size="sm" variant="secondary"><Eye className="size-4" />View</Button></Link>}
          />
          <Pagination total={data.total} limit={25} offset={offset} onChange={setOffset} />
        </>
      )}
    </div>
  );
}
