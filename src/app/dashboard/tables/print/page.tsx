"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { Button, EmptyState, ListSkeleton } from "@/components/ui";
import type { Row } from "@/components/crud";
import { RoleGate, useShell } from "@/components/shell";

export default function Page() {
  return <RoleGate module="tables"><Suspense fallback={null}><Sheet /></Suspense></RoleGate>;
}

function Sheet() {
  const { restaurant } = useShell();
  const sp = useSearchParams();
  const { data, loading } = useApi<{ items: Row[] }>("/api/r/tables?limit=500");
  const auto = sp.get("print") === "1";
  useEffect(() => { if (auto && data?.items.length) setTimeout(() => window.print(), 600); }, [auto, data]);
  if (loading) return <ListSkeleton />;
  const tables = (data?.items ?? []).filter((t) => t.isActive);
  if (!tables.length) return <EmptyState title="No active tables" text="Create tables first to print their QR codes." />;
  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between"><div><h1 className="font-display text-2xl font-semibold">QR print sheet</h1><p className="text-sm text-muted">Use “Save as PDF” in the print dialog to download all QR codes.</p></div><Button onClick={() => window.print()}><Printer className="size-4" />Print / Save PDF</Button></div>
      <div className="grid grid-cols-2 gap-6 print:gap-4">
        {tables.map((t) => (
          <div key={t.id} className="print-area flex break-inside-avoid flex-col items-center gap-2 rounded-2xl border border-line bg-white p-6 text-center text-black">
            {restaurant.logoUrl &&   <img src={restaurant.logoUrl} alt="" className="size-14 rounded object-cover" />}
            <p className="text-lg font-bold">{restaurant.name}</p>
            <QRCodeSVG value={`${window.location.origin}/order/${restaurant.slug}/table/${t.qrToken}`} size={200} level="M" />
            <p className="text-3xl font-extrabold">Table {t.name}</p>
            <p className="text-sm tracking-wide text-neutral-600">Scan to Order</p>
          </div>
        ))}
      </div>
    </div>
  );
}
