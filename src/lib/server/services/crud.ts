import crypto from "node:crypto";
import { z } from "zod";
import { tenantRepos, type TenantRepositories } from "@/lib/repositories";
import type { Crud } from "@/lib/repositories/interfaces";
import type { AppModule } from "@/lib/permissions";
import { slugify } from "@/lib/calculations";
import { ApiError } from "../http";
import type { Ctx } from "../auth";
import { logActivity } from "../audit";

type Row = Record<string, unknown> & { id?: string };
type Repo = Crud<Row & { id: string }>;
type Def = {
  repo: (T: TenantRepositories) => unknown;
  module: AppModule | AppModule[];
  entity: string;
  create: z.ZodType<Row>;
  update?: z.ZodType<Row>;
  searchCols?: string[];
  order?: string;
  /** Stable document id derived from the payload (e.g. coupon code) instead of an auto id. */
  idOf?: (v: Row) => string;
  prepareCreate?: (v: Row) => Row;
  prepareUpdate?: (v: Row, existing: Row) => Row;
  /** Cross-reference checks: every referenced id must exist inside THIS tenant. */
  validate?: (T: TenantRepositories, v: Row) => Promise<void>;
  afterCreate?: (ctx: Ctx, T: TenantRepositories, row: Row) => Promise<void>;
  afterDelete?: (ctx: Ctx, T: TenantRepositories, row: Row) => Promise<void>;
  softDelete?: boolean;
  actionFor?: (before: Row, after: Row) => string | null;
};

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");
const money = z.number().int().min(0).max(100_000_000);
const optId = z.union([id, z.literal(""), z.null()]).transform((v) => (v ? v : null));
const date = z.union([z.string(), z.null()]).transform((v) => (v ? new Date(v) : null)).refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid date");
const nameStr = z.string().trim().min(1, "Name is required").max(120);

const optionSchema = z.object({ id: z.string().optional(), name: nameStr, priceAdjustment: z.number().int().min(-100_000_00).max(100_000_00).default(0), isAvailable: z.boolean().default(true), sortOrder: z.number().int().default(0) });

async function mustExist(repo: Repo, ids: string[], label: string) {
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return;
  const found = await repo.getMany(uniq);
  if (found.length !== uniq.length) throw new ApiError(`One of the selected ${label} does not exist.`, 400, "VALIDATION");
}

const defs: Record<string, Def> = {
  categories: {
    repo: (T) => T.categories,
    module: "menu",
    entity: "category",
    create: z.object({ name: nameStr, imageUrl: z.string().max(500).default(""), sortOrder: z.number().int().default(0), isActive: z.boolean().default(true) }),
    searchCols: ["name"],
    order: "sortOrder",
    afterDelete: async (_ctx, T, row) => {
      await T.products.clearCategory(row.id as string);
    },
  },
  products: {
    repo: (T) => T.products,
    module: ["menu", "inventory"],
    entity: "product",
    create: z.object({
      name: nameStr,
      categoryId: optId.default(null),
      description: z.string().max(600).default(""),
      imageUrl: z.string().max(500).default(""),
      price: money,
      availability: z.enum(["AVAILABLE", "UNAVAILABLE", "OUT_OF_STOCK", "TEMPORARILY_UNAVAILABLE"]).default("AVAILABLE"),
      isPopular: z.boolean().default(false),
      isRecommended: z.boolean().default(false),
      isVeg: z.boolean().default(true),
      variantGroupIds: z.array(id).default([]),
      addonIds: z.array(id).default([]),
      sortOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }),
    searchCols: ["name", "description"],
    order: "sortOrder",
    prepareCreate: (v) => ({ ...v, slug: slugify(String(v.name)) }),
    prepareUpdate: (v) => (v.name ? { ...v, slug: slugify(String(v.name)) } : v),
    afterDelete: async (_ctx, T, row) => {
      await T.recipes.remove(row.id as string);
    },
    validate: async (T, v) => {
      if (v.categoryId) await mustExist(T.categories as unknown as Repo, [v.categoryId as string], "categories");
      await mustExist(T.variantGroups as unknown as Repo, (v.variantGroupIds as string[] | undefined) ?? [], "variant groups");
      await mustExist(T.addons as unknown as Repo, (v.addonIds as string[] | undefined) ?? [], "add-ons");
    },
    actionFor: (b, a) => (b.price !== a.price ? "product.price_changed" : b.availability !== a.availability ? "product.availability_changed" : null),
  },
  "variant-groups": {
    repo: (T) => T.variantGroups,
    module: "menu",
    entity: "variantGroup",
    create: z
      .object({
        name: nameStr,
        selectionType: z.enum(["SINGLE", "MULTIPLE"]).default("SINGLE"),
        required: z.boolean().default(false),
        minSelections: z.number().int().min(0).default(0),
        maxSelections: z.number().int().min(1).default(1),
        options: z.array(optionSchema).max(40).default([]),
        isActive: z.boolean().default(true),
      })
      .refine((v) => v.minSelections <= v.maxSelections, "Minimum selections cannot exceed maximum"),
    update: z.object({ name: nameStr, selectionType: z.enum(["SINGLE", "MULTIPLE"]), required: z.boolean(), minSelections: z.number().int().min(0), maxSelections: z.number().int().min(1), options: z.array(optionSchema).max(40), isActive: z.boolean() }).partial(),
    searchCols: ["name"],
    prepareCreate: (v) => ({ ...v, options: (v.options as z.infer<typeof optionSchema>[]).map((o, i) => ({ ...o, id: o.id || crypto.randomUUID(), sortOrder: i })) }),
    prepareUpdate: (v) => (v.options ? { ...v, options: (v.options as z.infer<typeof optionSchema>[]).map((o, i) => ({ ...o, id: o.id || crypto.randomUUID(), sortOrder: i })) } : v),
    afterDelete: async (_ctx, T, row) => {
      await T.products.removeVariantGroupRef(row.id as string);
    },
  },
  addons: {
    repo: (T) => T.addons,
    module: "menu",
    entity: "addon",
    create: z.object({ name: nameStr, price: money, isAvailable: z.boolean().default(true), isActive: z.boolean().default(true), sortOrder: z.number().int().default(0) }),
    searchCols: ["name"],
    order: "sortOrder",
    afterDelete: async (_ctx, T, row) => {
      await T.products.removeAddonRef(row.id as string);
    },
  },
  ingredients: {
    repo: (T) => T.ingredients,
    module: ["inventory", "menu"],
    entity: "ingredient",
    create: z.object({ name: nameStr, unit: z.string().trim().min(1).max(12).default("g"), currentStock: z.number().min(0).max(1e9).default(0), lowStockThreshold: z.number().min(0).max(1e9).default(0), costPerUnit: money.default(0), isActive: z.boolean().default(true) }),
    update: z.object({ name: nameStr, unit: z.string().trim().min(1).max(12), lowStockThreshold: z.number().min(0).max(1e9), costPerUnit: money, isActive: z.boolean() }).partial(), // stock only via /inventory/adjust
    searchCols: ["name"],
    softDelete: true,
    afterCreate: async (ctx, T, row) => {
      if (Number(row.currentStock) > 0) {
        await T.inventoryTransactions.create(null, { ingredientId: row.id as string, orderId: null, type: "RESTOCK", quantityBefore: 0, quantityUsed: -Number(row.currentStock), quantityAfter: Number(row.currentStock), note: "Opening stock", actorId: ctx.user.id, createdAt: new Date() });
      }
    },
  },
  tables: {
    repo: (T) => T.tables,
    module: "tables",
    entity: "table",
    create: z.object({ name: nameStr.max(30), number: z.number().int().min(0).max(9999).default(0), status: z.enum(["FREE", "OCCUPIED", "RESERVED"]).default("FREE"), isActive: z.boolean().default(true) }),
    update: z.object({ name: nameStr.max(30), number: z.number().int().min(0).max(9999), status: z.enum(["FREE", "OCCUPIED", "RESERVED"]), isActive: z.boolean(), regenerateQr: z.boolean() }).partial(),
    searchCols: ["name"],
    order: "number",
    prepareCreate: (v) => ({ ...v, qrToken: crypto.randomBytes(12).toString("base64url") }),
    prepareUpdate: (v) => {
      const { regenerateQr, ...rest } = v;
      return regenerateQr ? { ...rest, qrToken: crypto.randomBytes(12).toString("base64url") } : rest;
    },
    actionFor: (b, a) => (b.qrToken !== a.qrToken ? "table.qr_regenerated" : null),
  },
  coupons: {
    repo: (T) => T.coupons,
    module: ["promotions"],
    entity: "coupon",
    idOf: (v) => v.code as string,
    create: z
      .object({
        code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/, "Code must be 3-24 letters/numbers"),
        name: z.string().trim().max(80).default(""),
        discountType: z.enum(["PERCENTAGE", "FIXED"]),
        discountValue: z.number().int().min(1),
        maxDiscount: money.default(0),
        minOrderValue: money.default(0),
        usageLimit: z.number().int().min(0).default(0),
        perCustomerLimit: z.number().int().min(0).default(0),
        validFrom: date.default(null),
        validUntil: date.default(null),
        applicableProducts: z.array(id).default([]),
        applicableCategories: z.array(id).default([]),
        isActive: z.boolean().default(true),
      })
      .refine((v) => v.discountType !== "PERCENTAGE" || v.discountValue <= 100, "Percentage cannot exceed 100"),
    update: z
      .object({ name: z.string().trim().max(80), discountType: z.enum(["PERCENTAGE", "FIXED"]), discountValue: z.number().int().min(1), maxDiscount: money, minOrderValue: money, usageLimit: z.number().int().min(0), perCustomerLimit: z.number().int().min(0), validFrom: date, validUntil: date, applicableProducts: z.array(id), applicableCategories: z.array(id), isActive: z.boolean() })
      .partial(),
    searchCols: ["code", "name"],
  },
  "scratch-campaigns": {
    repo: (T) => T.scratchCampaigns,
    module: "scratch",
    entity: "scratchCampaign",
    create: z
      .object({
        name: nameStr,
        startsAt: date.default(null),
        endsAt: date.default(null),
        rewards: z.array(z.object({ label: z.string().trim().min(1).max(80), probability: z.number().min(0).max(100) })).min(1, "Add at least one reward").max(12),
        usageLimit: z.number().int().min(0).default(0),
        isActive: z.boolean().default(true),
      })
      .refine((v) => v.rewards.reduce((s, r) => s + r.probability, 0) <= 100, "Reward probabilities cannot add up to more than 100%"),
    update: z.object({ name: nameStr, startsAt: date, endsAt: date, rewards: z.array(z.object({ label: z.string().trim().min(1).max(80), probability: z.number().min(0).max(100) })).min(1).max(12), usageLimit: z.number().int().min(0), isActive: z.boolean() }).partial().refine((v) => !v.rewards || v.rewards.reduce((s, r) => s + r.probability, 0) <= 100, "Reward probabilities cannot add up to more than 100%"),
  },
};

export const RESOURCE_NAMES = Object.keys(defs);
export function getDef(name: string): Def {
  const d = Object.prototype.hasOwnProperty.call(defs, name) ? defs[name] : undefined;
  if (!d) throw new ApiError("Unknown resource", 404, "NOT_FOUND");
  return d;
}

const repoOf = (d: Def, ctx: Ctx) => d.repo(tenantRepos(ctx.restaurantId)) as Repo;
const byName = (a: Row, b: Row) => String(a.name ?? a.code ?? "").localeCompare(String(b.name ?? b.code ?? ""));
const time = (v: unknown) => (v instanceof Date ? v.getTime() : 0);

export async function listResource(ctx: Ctx, name: string, q: { search?: string; limit?: number; offset?: number }) {
  const d = getDef(name);
  let rows = (await repoOf(d, ctx).list({ limit: 1000 })) as Row[];
  if (q.search && d.searchCols?.length) {
    const s = q.search.toLowerCase();
    rows = rows.filter((r) => d.searchCols!.some((c) => String(r[c] ?? "").toLowerCase().includes(s)));
  }
  rows.sort((a, b) => (d.order ? Number(a[d.order] ?? 0) - Number(b[d.order] ?? 0) || byName(a, b) : time(b.createdAt) - time(a.createdAt) || byName(a, b)));
  const limit = Math.min(q.limit ?? 300, 500);
  return { items: rows.slice(q.offset ?? 0, (q.offset ?? 0) + limit), total: rows.length };
}

async function getRow(ctx: Ctx, d: Def, rowId: string) {
  const r = await repoOf(d, ctx).get(rowId);
  if (!r) throw new ApiError("Not found", 404, "NOT_FOUND");
  return r as Row;
}

export async function createResource(ctx: Ctx, name: string, body: unknown) {
  const d = getDef(name);
  const T = tenantRepos(ctx.restaurantId);
  let v = d.create.parse(body);
  if (d.prepareCreate) v = d.prepareCreate(v);
  if (d.validate) await d.validate(T, v);
  const now = new Date();
  const data = { ...v, createdAt: now, updatedAt: now };
  let row: Row;
  if (name === "tables") {
    row = (await T.tables.createWithQr(ctx.restaurantId, data as never)) as unknown as Row;
  } else {
    row = (await repoOf(d, ctx).create(d.idOf ? d.idOf(v) : null, data as never)) as Row;
  }
  await logActivity(ctx, `${d.entity}.created`, d.entity, String(row.id), null, row);
  if (d.afterCreate) await d.afterCreate(ctx, T, row);
  return row;
}

export async function updateResource(ctx: Ctx, name: string, rowId: string, body: unknown) {
  const d = getDef(name);
  const T = tenantRepos(ctx.restaurantId);
  const before = await getRow(ctx, d, rowId);
  const schema = d.update ?? (d.create as unknown as z.ZodObject).partial?.() ?? d.create;
  let v = schema.parse(body);
  if (d.prepareUpdate) v = d.prepareUpdate(v, before);
  if (!Object.keys(v).length) return before;
  if (d.validate) await d.validate(T, { ...before, ...v });
  const { id: _ignored, ...patchRaw } = v;
  void _ignored;
  let patch = patchRaw;
  if (name === "tables" && typeof patch.qrToken === "string" && patch.qrToken !== before.qrToken) {
    await T.tables.rotateQr(ctx.restaurantId, rowId, patch.qrToken);
    const { qrToken: _q, ...rest } = patch;
    void _q;
    patch = rest;
  }
  const row = { ...before, ...patchRaw, updatedAt: new Date(), id: rowId } as Row;
  if (Object.keys(patch).length) await repoOf(d, ctx).update(rowId, { ...patch, updatedAt: row.updatedAt } as never);
  const action = d.actionFor?.(before, row) ?? `${d.entity}.updated`;
  await logActivity(ctx, action, d.entity, rowId, before, row);
  return row;
}

export async function deleteResource(ctx: Ctx, name: string, rowId: string) {
  const d = getDef(name);
  const T = tenantRepos(ctx.restaurantId);
  const before = await getRow(ctx, d, rowId);
  if (d.softDelete) {
    await repoOf(d, ctx).update(rowId, { isActive: false, updatedAt: new Date() } as never);
    await logActivity(ctx, `${d.entity}.deactivated`, d.entity, rowId, before, { ...before, isActive: false });
    return { ok: true, deactivated: true };
  }
  if (name === "tables") await T.tables.deleteWithQr(rowId);
  else await repoOf(d, ctx).remove(rowId);
  if (d.afterDelete) await d.afterDelete(ctx, T, before);
  await logActivity(ctx, `${d.entity}.deleted`, d.entity, rowId, before, null);
  return { ok: true };
}
