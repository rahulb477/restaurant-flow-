"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Download, Eye, Printer, RefreshCw } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { patch } from "@/lib/client/api";
import { useTablesLive } from "@/lib/client/realtime";
import { Button, ConfirmDialog, Modal, PageHeader, StatusBadge, useToast, Badge } from "@/components/ui";
import { CrudManager, type Row } from "@/components/crud";
import { RoleGate, useShell } from "@/components/shell";

export default function Page() {
  return <RoleGate module="tables"><Tables /></RoleGate>;
}

const qrUrl = (slug: string, token: string) => `${window.location.origin}/order/${slug}/table/${token}`;

function Tables() {
  const { restaurant } = useShell();
  const toast = useToast();
  const liveTables = useTablesLive<{ status: string; isActive: boolean }>(restaurant.id);
  const liveStatus = new Map((liveTables.data ?? []).map((t) => [t.id, t.status]));
  const counts = { free: 0, occupied: 0 };
  for (const t of liveTables.data ?? []) if (t.isActive) (t.status === "OCCUPIED" ? counts.occupied++ : counts.free++);
  const [qr, setQr] = useState<Row | null>(null);
  const [regen, setRegen] = useState<{ row: Row; done: () => void } | null>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const url = qr ? qrUrl(restaurant.slug, qr.qrToken) : "";

  function download() {
    const c = canvasWrap.current?.querySelector("canvas");
    if (!c || !qr) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${restaurant.slug}-table-${qr.name}.png`;
    a.click();
  }
  return (
    <div>
      <PageHeader title="Tables & QR" subtitle="Every table gets its own secure QR code that opens your menu." />
      {liveTables.data && <p className="mb-3 flex items-center gap-2 text-xs text-muted"><span className="size-2 animate-pulse rounded-full bg-ok" />Live · {counts.occupied} occupied · {counts.free} free</p>}
      <CrudManager resource="tables" singular="Table" plural="Tables" fields={[{ key: "name", label: "Name", type: "text", required: true, placeholder: "T1" }, { key: "number", label: "Number", type: "number" }, { key: "status", label: "Status", type: "select", options: [{ value: "FREE", label: "Free" }, { value: "OCCUPIED", label: "Occupied" }, { value: "RESERVED", label: "Reserved" }], editOnly: true }, { key: "isActive", label: "Active (QR works)", type: "boolean" }]}
        defaults={{ name: "", number: 0, status: "FREE", isActive: true }} emptyText="Create a table to generate its QR code." deleteMessage={(r) => `Delete table “${r.name}”? Its printed QR code will stop working.`}
        toolbar={<><Link href="/dashboard/tables/print"><Button variant="secondary"><Download className="size-4" />Download all</Button></Link><Link href="/dashboard/tables/print?print=1"><Button variant="secondary"><Printer className="size-4" />Print all</Button></Link></>}
        columns={[{ key: "name", label: "Table", render: (r) => <span className="font-medium">{r.name}</span> }, { key: "number", label: "No." }, { key: "status", label: "Status", render: (r) => <StatusBadge status={liveStatus.get(r.id) ?? r.status} /> }, { key: "isActive", label: "QR", render: (r) => <Badge className={r.isActive ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad"}>{r.isActive ? "Active" : "Disabled"}</Badge> }]}
        extraActions={(r, reload) => (<><Button size="sm" variant="secondary" onClick={() => setQr(r)}><Eye className="size-3.5" />QR</Button><Button size="sm" variant="ghost" aria-label={`Regenerate QR for ${r.name}`} onClick={() => setRegen({ row: r, done: reload })}><RefreshCw className="size-4" /></Button></>)}
      />
      <Modal open={!!qr} onClose={() => setQr(null)} title={qr ? `Table ${qr.name} · QR code` : ""} footer={<><Button variant="secondary" onClick={download}><Download className="size-4" />Download PNG</Button><Button onClick={() => window.print()}><Printer className="size-4" />Print</Button></>}>
        {qr && (
          <div className="print-area flex flex-col items-center gap-3 text-center">
            <p className="font-display text-xl font-semibold">{restaurant.name}</p>
            <div ref={canvasWrap} className="rounded-xl bg-white p-4"><QRCodeCanvas value={url} size={240} level="M" marginSize={1} /></div>
            <p className="text-2xl font-semibold">Table {qr.name}</p>
            <p className="text-sm text-muted">Scan to Order</p>
            <p className="break-all text-[11px] text-muted">{url}</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!regen} onClose={() => setRegen(null)} danger title="Regenerate QR code?" confirmLabel="Regenerate" message={regen ? `The old printed QR for table “${regen.row.name}” will stop working immediately. You’ll need to print the new one.` : ""} onConfirm={async () => { if (!regen) return; try { await patch(`/api/r/tables/${regen.row.id}`, { regenerateQr: true }); toast.success("QR regenerated"); regen.done(); } catch (e) { toast.error((e as Error).message); } setRegen(null); }} />
    </div>
  );
}
