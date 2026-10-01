"use client";
import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { Badge, Button, PageHeader, PriceDisplay, StatusBadge, Tabs } from "@/components/ui";
import { CrudManager, type CField, type Row } from "@/components/crud";
import { RoleGate, useShell } from "@/components/shell";

const TABS = [["products", "Products"], ["categories", "Categories"], ["variants", "Variants"], ["addons", "Add-ons"]] as const;
type Tab = (typeof TABS)[number][0];

export default function Page() {
  return <RoleGate module="menu"><Suspense fallback={null}><Menu /></Suspense></RoleGate>;
}

const thumb = (r: Row) => (
  <div className="flex items-center gap-3">
    {r.imageUrl ?   <img src={r.imageUrl} alt="" className="size-10 rounded-lg object-cover" /> : <div className="grid size-10 place-items-center rounded-lg bg-surface2 text-lg">🍽️</div>}
    <div><p className="font-medium">{r.name}</p>{r.description && <p className="max-w-xs truncate text-xs text-muted">{r.description}</p>}</div>
  </div>
);
const onoff = (v: boolean) => <Badge className={v ? "bg-ok/15 text-ok" : "bg-white/10 text-muted"}>{v ? "Active" : "Inactive"}</Badge>;

function Menu() {
  const router = useRouter();
  const sp = useSearchParams();
  const { restaurant } = useShell();
  const cur = restaurant.currency;
  const tab = (TABS.find((t) => t[0] === sp.get("tab"))?.[0] ?? "products") as Tab;
  const cats = useApi<{ items: Row[] }>("/api/r/categories?limit=500");
  const catName = useMemo(() => new Map((cats.data?.items ?? []).map((c) => [c.id, c.name])), [cats.data]);

  const productFields: CField[] = [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "categoryId", label: "Category", type: "select", source: { resource: "categories" } },
    { key: "price", label: `Price (${cur})`, type: "money", required: true },
    { key: "availability", label: "Availability", type: "select", options: [["AVAILABLE", "Available"], ["UNAVAILABLE", "Unavailable"], ["OUT_OF_STOCK", "Out of stock"], ["TEMPORARILY_UNAVAILABLE", "Temporarily unavailable"]].map(([value, label]) => ({ value, label })) },
    { key: "description", label: "Description", type: "textarea" },
    { key: "imageUrl", label: "Image", type: "image" },
    { key: "variantGroupIds", label: "Variant groups", type: "multi", source: { resource: "variant-groups" }, hint: "e.g. Size" },
    { key: "addonIds", label: "Add-ons", type: "multi", source: { resource: "addons" } },
    { key: "sortOrder", label: "Sort order", type: "number" },
    { key: "isVeg", label: "Vegetarian", type: "boolean" },
    { key: "isPopular", label: "Popular", type: "boolean" },
    { key: "isRecommended", label: "Recommended", type: "boolean" },
    { key: "isActive", label: "Active", type: "boolean" },
  ];

  return (
    <div>
      <PageHeader title="Menu" subtitle="Categories, products, variants and add-ons shown on your QR menu and POS." actions={<Link href="/dashboard/menu/ai-digitization"><Button variant="secondary"><Sparkles className="size-4" />AI digitization</Button></Link>} />
      <Tabs tabs={TABS.map(([id, label]) => ({ id, label }))} value={tab} onChange={(t) => router.replace(`/dashboard/menu?tab=${t}`)} />
      {tab === "products" && (
        <CrudManager key="p" resource="products" singular="Product" plural="Products" duplicate fields={productFields} defaults={{ name: "", categoryId: "", price: 0, availability: "AVAILABLE", description: "", imageUrl: "", variantGroupIds: [], addonIds: [], sortOrder: 0, isVeg: true, isPopular: false, isRecommended: false, isActive: true }}
          emptyText="Add your first product to build your menu." deleteMessage={(r) => `“${r.name}” and its recipe will be permanently deleted. Past orders keep their history.`}
          columns={[{ key: "name", label: "Product", render: thumb }, { key: "categoryId", label: "Category", render: (r) => catName.get(r.categoryId) ?? "—" }, { key: "price", label: "Price", render: (r) => <PriceDisplay minor={r.price} currency={cur} /> }, { key: "availability", label: "Availability", render: (r) => <StatusBadge status={r.availability} /> }]} />
      )}
      {tab === "categories" && (
        <CrudManager key="c" resource="categories" singular="Category" plural="Categories" onChanged={cats.reload} fields={[{ key: "name", label: "Name", type: "text", required: true }, { key: "imageUrl", label: "Image", type: "image", folder: "menu" }, { key: "sortOrder", label: "Sort order", type: "number", hint: "Lower numbers appear first" }, { key: "isActive", label: "Active", type: "boolean" }]}
          defaults={{ name: "", imageUrl: "", sortOrder: 0, isActive: true }} emptyText="Create categories like Coffee, Snacks or Desserts." deleteMessage={(r) => `Delete “${r.name}”? Its products will become uncategorised.`}
          columns={[{ key: "name", label: "Category", render: thumb }, { key: "sortOrder", label: "Order" }, { key: "isActive", label: "Status", render: (r) => onoff(r.isActive) }]} />
      )}
      {tab === "variants" && (
        <CrudManager key="v" resource="variant-groups" singular="Variant group" plural="Variant groups" fields={[
          { key: "name", label: "Group name", type: "text", required: true, placeholder: "Size" },
          { key: "selectionType", label: "Selection type", type: "select", options: [{ value: "SINGLE", label: "Single choice" }, { value: "MULTIPLE", label: "Multiple choice" }] },
          { key: "required", label: "Required", type: "boolean" }, { key: "minSelections", label: "Min selections", type: "number" }, { key: "maxSelections", label: "Max selections", type: "number", min: 1 },
          { key: "options", label: "Options", type: "options" }, { key: "isActive", label: "Active", type: "boolean" },
        ]} defaults={{ name: "", selectionType: "SINGLE", required: false, minSelections: 0, maxSelections: 1, options: [{ name: "", priceAdjustment: 0, isAvailable: true }], isActive: true }}
          emptyText="Variant groups like Size (Small/Medium/Large) let customers customise products. Assign them on each product."
          columns={[{ key: "name", label: "Group", render: (r) => <span className="font-medium">{r.name}</span> }, { key: "selectionType", label: "Type", render: (r) => (r.selectionType === "SINGLE" ? "Single" : "Multiple") }, { key: "required", label: "Required", render: (r) => (r.required ? "Yes" : "No") }, { key: "options", label: "Options", render: (r) => (r.options as Row[]).map((o) => o.name).join(", ") || "—" }]} />
      )}
      {tab === "addons" && (
        <CrudManager key="a" resource="addons" singular="Add-on" plural="Add-ons" fields={[{ key: "name", label: "Name", type: "text", required: true }, { key: "price", label: `Price (${cur})`, type: "money" }, { key: "sortOrder", label: "Sort order", type: "number" }, { key: "isAvailable", label: "Available", type: "boolean" }, { key: "isActive", label: "Active", type: "boolean" }]}
          defaults={{ name: "", price: 0, sortOrder: 0, isAvailable: true, isActive: true }} emptyText="Reusable extras like Extra Cheese or Butter. Assign them to products."
          columns={[{ key: "name", label: "Add-on", render: (r) => <span className="font-medium">{r.name}</span> }, { key: "price", label: "Price", render: (r) => <PriceDisplay minor={r.price} currency={cur} /> }, { key: "isAvailable", label: "Availability", render: (r) => <StatusBadge status={r.isAvailable ? "AVAILABLE" : "UNAVAILABLE"} /> }, { key: "isActive", label: "Status", render: (r) => onoff(r.isActive) }]} />
      )}
    </div>
  );
}
