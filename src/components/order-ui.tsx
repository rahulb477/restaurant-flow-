"use client";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/calculations";
import { StatusBadge, cx } from "./ui";

 
export type OrderRow = Record<string, any> & { id: string; displayId: string; status: string; paymentStatus: string; items: LineRow[]; total: number };
export type LineRow = { lineId: string; name: string; qty: number; unitPrice: number; lineTotal: number; notes: string; custom: boolean; variants: { optionName: string; groupName: string; priceAdjustment: number }[]; addons: { name: string; price: number }[] };

export const TIMELINE = ["Order Received", "Confirmed", "Preparing", "Ready", "Completed"] as const;
export function timelineIndex(status: string) {
  return { PLACED: 0, PAYMENT_PENDING: 0, PAYMENT_COMPLETED: 0, DRAFT: 0, CONFIRMED: 1, PREPARING: 2, READY: 3, SERVED: 3, COMPLETED: 4 }[status] ?? 0;
}

export function Timeline({ status }: { status: string }) {
  if (status === "CANCELLED") return <p className="rounded-lg bg-bad/10 p-3 text-center text-sm text-bad">This order was cancelled</p>;
  const idx = timelineIndex(status);
  return (
    <ol className="flex items-start" aria-label="Order progress">
      {TIMELINE.map((t, i) => (
        <li key={t} className="relative flex flex-1 flex-col items-center text-center" aria-current={i === idx ? "step" : undefined}>
          {i > 0 && <span className={cx("absolute right-1/2 top-3 h-0.5 w-full", i <= idx ? "bg-accent" : "bg-line")} />}
          <span className={cx("relative z-10 grid size-6 place-items-center rounded-full text-[10px] font-bold transition", i <= idx ? "bg-accent text-accent-fg" : "bg-surface2 text-muted", i === idx && "anim-pulse")}>{i < idx ? "✓" : i + 1}</span>
          <span className={cx("mt-1.5 px-0.5 text-[10px] leading-tight", i <= idx ? "text-white" : "text-muted")}>{t}</span>
        </li>
      ))}
    </ol>
  );
}

export function ItemLines({ items, currency, showPrices = true }: { items: LineRow[]; currency: string; showPrices?: boolean }) {
  return (
    <ul className="space-y-2.5">
      {items.map((l) => (
        <li key={l.lineId} className="text-sm">
          <div className="flex justify-between gap-3"><span><b className="tabular-nums">{l.qty}×</b> {l.name}{l.custom && <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted">custom</span>}</span>{showPrices && <span className="tabular-nums text-muted">{formatMoney(l.lineTotal, currency)}</span>}</div>
          {(l.variants.length > 0 || l.addons.length > 0) && <p className="pl-5 text-xs text-muted">{[...l.variants.map((v) => `${v.groupName}: ${v.optionName}`), ...l.addons.map((a) => `+ ${a.name}`)].join(" · ")}</p>}
          {l.notes && <p className="pl-5 text-xs text-warn">“{l.notes}”</p>}
        </li>
      ))}
    </ul>
  );
}

export function Totals({ o, currency }: { o: OrderRow; currency: string }) {
  const m = (n: number) => formatMoney(n, currency);
  const row = (l: string, v: ReactNode, bold = false) => <div className={cx("flex justify-between", bold ? "text-base font-semibold" : "text-muted")}><dt>{l}</dt><dd className="tabular-nums">{v}</dd></div>;
  return (
    <dl className="space-y-1 text-sm">
      {row("Subtotal", m(o.subtotal))}
      {o.discount > 0 && row(`Discount${o.couponCode ? ` (${o.couponCode})` : ""}`, `-${m(o.discount)}`)}
      {o.manualDiscount > 0 && row("Manual discount", `-${m(o.manualDiscount)}`)}
      {o.tax > 0 && row(o.taxLabel || "Tax", m(o.tax))}
      {o.platformFee > 0 && row("Platform fee", m(o.platformFee))}
      {row("Total", m(o.total), true)}
    </dl>
  );
}

export const PaymentBadge = ({ s }: { s: string }) => <StatusBadge status={s} />;
