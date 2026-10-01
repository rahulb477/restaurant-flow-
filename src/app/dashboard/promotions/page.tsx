"use client";
import { Badge, PageHeader, PriceDisplay } from "@/components/ui";
import { CrudManager, type CField } from "@/components/crud";
import { RoleGate, useShell } from "@/components/shell";

export default function Page() {
  return <RoleGate module="promotions"><Promotions /></RoleGate>;
}

function Promotions() {
  const { restaurant } = useShell();
  const cur = restaurant.currency;
  const fields: CField[] = [
    { key: "code", label: "Code", type: "text", required: true, createOnly: true, placeholder: "WELCOME10", hint: "Letters and numbers only. Can’t be changed later." },
    { key: "name", label: "Name", type: "text" },
    { key: "discountType", label: "Discount type", type: "select", options: [{ value: "PERCENTAGE", label: "Percentage (%)" }, { value: "FIXED", label: `Fixed amount (${cur})` }] },
    { key: "discountValue", label: "Discount value", type: "number", step: 0.01, required: true, hint: "% for percentage, currency amount for fixed" },
    { key: "maxDiscount", label: `Max discount (${cur})`, type: "money", hint: "0 = no cap" },
    { key: "minOrderValue", label: `Minimum order (${cur})`, type: "money" },
    { key: "usageLimit", label: "Total usage limit", type: "number", hint: "0 = unlimited" },
    { key: "perCustomerLimit", label: "Per-customer limit", type: "number", hint: "0 = unlimited. Needs a customer phone/email." },
    { key: "validFrom", label: "Valid from", type: "datetime" },
    { key: "validUntil", label: "Valid until", type: "datetime" },
    { key: "applicableProducts", label: "Only for products", type: "multi", source: { resource: "products" }, hint: "Leave empty to apply to everything" },
    { key: "applicableCategories", label: "Only for categories", type: "multi", source: { resource: "categories" } },
    { key: "isActive", label: "Active", type: "boolean" },
  ];
  return (
    <div>
      <PageHeader title="Coupons & offers" subtitle="Discounts are always re-validated and recalculated on the server at checkout." />
      <CrudManager resource="coupons" singular="Coupon" plural="Coupons" fields={fields}
        defaults={{ code: "", name: "", discountType: "PERCENTAGE", discountValue: 10, maxDiscount: 0, minOrderValue: 0, usageLimit: 0, perCustomerLimit: 0, validFrom: "", validUntil: "", applicableProducts: [], applicableCategories: [], isActive: true }}
        mapIn={(f, row) => (row.discountType === "FIXED" ? { ...f, discountValue: row.discountValue / 100 } : f)}
        mapOut={(p, f) => (f.discountType === "FIXED" ? { ...p, discountValue: Math.round((Number(f.discountValue) || 0) * 100) } : { ...p, discountValue: Math.round(Number(f.discountValue) || 0) })}
        emptyText="Create a coupon like WELCOME10 to bring customers back." deleteMessage={(r) => `Delete coupon ${r.code}? Existing orders keep their discount.`}
        columns={[
          { key: "code", label: "Code", render: (r) => <div><p className="font-mono font-semibold">{r.code}</p><p className="text-xs text-muted">{r.name}</p></div> },
          { key: "discountValue", label: "Discount", render: (r) => (r.discountType === "PERCENTAGE" ? <span>{r.discountValue}%{r.maxDiscount > 0 && <span className="text-muted"> up to <PriceDisplay minor={r.maxDiscount} currency={cur} /></span>}</span> : <PriceDisplay minor={r.discountValue} currency={cur} />) },
          { key: "usageCount", label: "Used", render: (r) => `${r.usageCount}${r.usageLimit ? ` / ${r.usageLimit}` : ""}` },
          { key: "validUntil", label: "Valid until", render: (r) => (r.validUntil ? new Date(r.validUntil).toLocaleDateString() : "No expiry") },
          { key: "isActive", label: "Status", render: (r) => <Badge className={r.isActive ? "bg-ok/15 text-ok" : "bg-white/10 text-muted"}>{r.isActive ? "Active" : "Inactive"}</Badge> },
        ]} />
    </div>
  );
}
