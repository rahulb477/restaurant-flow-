import type { Order, Restaurant } from "@/lib/repositories";
import { formatMoney } from "@/lib/calculations";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Branded invoice HTML used for e-mail delivery (and mirrored by the printable bill page). */
export function invoiceHtml(o: Order, r: Restaurant, footer: string) {
  const m = (n: number) => esc(formatMoney(n, r.currency));
  const rows = o.items
    .map((l) => {
      const extras = [...l.variants.map((v) => v.optionName), ...l.addons.map((a) => `+ ${a.name}`)].join(", ");
      return `<tr><td style="padding:6px 0">${esc(l.name)} × ${l.qty}${extras ? `<br><small style="color:#777">${esc(extras)}</small>` : ""}</td><td style="text-align:right">${m(l.lineTotal)}</td></tr>`;
    })
    .join("");
  const line = (label: string, v: number, neg = false) => (v ? `<tr><td style="color:#666">${label}</td><td style="text-align:right">${neg ? "-" : ""}${m(v)}</td></tr>` : "");
  const logo = r.logoUrl ? `<img src="${esc(r.logoUrl)}" alt="" style="height:48px;margin-bottom:8px;border-radius:8px"><br>` : "";
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111;border-top:4px solid ${esc(r.accent || "#f59e0b")}">
${logo}<h2 style="margin:0">${esc(r.name)}</h2>
<p style="margin:4px 0 16px;color:#666;font-size:13px">${esc([r.address, r.city, r.state, r.pincode].filter(Boolean).join(", "))}<br>${esc(r.phone)}</p>
<p style="font-size:13px"><b>Invoice ${esc(o.displayId)}</b><br>${o.createdAt.toLocaleString("en-IN", { timeZone: r.timezone })}${o.tableName ? `<br>Table ${esc(o.tableName)}` : ""}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #ddd;border-bottom:1px solid #ddd">${rows}</table>
<table style="width:100%;font-size:14px;margin-top:8px">
<tr><td style="color:#666">Subtotal</td><td style="text-align:right">${m(o.subtotal)}</td></tr>
${line("Discount", o.discount + o.manualDiscount, true)}${line(esc(o.taxLabel || "Tax"), o.tax)}${line("Platform fee", o.platformFee)}
<tr><td><b>Total</b></td><td style="text-align:right"><b>${m(o.total)}</b></td></tr>
<tr><td style="color:#666">Payment</td><td style="text-align:right">${esc(o.paymentMethod || "—")} · ${esc(o.paymentStatus)}</td></tr></table>
<p style="text-align:center;color:#777;font-size:12px;margin-top:20px">${esc(footer)}</p></div>`;
}
