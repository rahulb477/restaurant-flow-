"use client";
import { QRCodeSVG } from "qrcode.react";
import { buildUpiUri, formatMoney } from "@/lib/calculations";

/** Dynamic UPI QR for the exact order amount. Showing it never marks a payment successful. */
export function UpiQr({ upiId, name, amountMinor, orderRef, currency = "INR", size = 200 }: { upiId: string; name: string; amountMinor: number; orderRef: string; currency?: string; size?: number }) {
  const uri = buildUpiUri({ upiId, name, amountMinor, ref: orderRef, note: orderRef, currency });
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="rounded-xl bg-white p-3"><QRCodeSVG value={uri} size={size} level="M" /></div>
      <p className="text-2xl font-semibold tabular-nums">{formatMoney(amountMinor, currency)}</p>
      <p className="text-xs text-muted">Pay to {name} · {upiId}</p>
      <a href={uri} className="rounded-lg border border-line px-4 py-2 text-sm text-accent md:hidden">Open UPI app</a>
    </div>
  );
}
