import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { categories, products, variantGroups, addons, ingredients, diningTables, coupons, scratchCampaigns, recipes, inventoryTransactions } from "@/db/schema";
import type { AppModule } from "@/lib/permissions";
import { slugify } from "@/lib/calculations";
import { ApiError } from "../http";
import type { Ctx } from "../auth";
import { logActivity } from "../audit";

type Row = Record<string, unknown>;
type Def = {
  table: PgTable & { id: unknown; restaurantId: unknown };
  module: AppModule | AppModule[];
  entity: string;
  create: z.ZodType<Row>;
  update?: z.ZodType<Row>;
  searchCols?: string[];
  order?: string;
  prepareCreate?: (v: Row) => Row;
  prepareUpdate?: (v: Row, existing: Row) => Row;
  afterCreate?: (ctx: Ctx, row: Row) => Promise<void>;
  afterDelete?: (ctx: Ctx, row: Row) => Promise<void>;
  softDelete?: boolean;
  actionFor?: (before: Row, after: Row) => string | null;
};

const id = z.string().uuid();
const money = z.number().int().min(0).max(100_000_000);
const optId = z.union([id, z.literal(""), z.null()]).transform((v) => (v ? v : null));
const date = z.union([z.string(), z.null()]).transform((v) => (v ? new Date(v) : null)).refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid date");
const nameStr = z.string().trim().min(1, "Name is required").max(120);

const optionSchema = z.object({ id: z.string().optional(), name: nameStr, priceAdjustment: z.number().int().min(-100_000_00).max(100_000_00).default(0), isAvailable: z.boolean().default(true), sortOrder: z.number().int().default(0) });

const defs: Record<string, Def> = {
  categories: {
    table: categories as never,
    module: "menu",
    entity: "category",
    create: z.object({ name: nameStr, imageUrl: z.string().max(500).default(""), sortOrder: z.number().int().default(0), isActive: z.boolean().default(true) }),
    searchCols: ["name"],
    order: "sortOrder",
    afterDelete: async (ctx, row) => {
      await db.update(products).set({ categoryId: null }).where(and(eq(products.restaurantId, ctx.restaurantId), eq(products.categoryId, row.id as string)));
    },
  },
  products: {
    table: products as never,
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
    afterDelete: async (ctx, row) => {
      await db.delete(recipes).where(and(eq(recipes.restaurantId, ctx.restaurantId), eq(recipes.productId, row.id as string)));
    },
    actionFor: (b, a) => (b.price !== a.price ? "product.price_changed" : b.availability !== a.availability ? "product.availability_changed" : null),
  },
  "variant-groups": {
    table: variantGroups as never,
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
    afterDelete: async (ctx, row) => {
      await db.execute(
        sql`update products set variant_group_ids = coalesce((select jsonb_agg(e) from jsonb_array_elements_text(variant_group_ids) e where e <> ${row.id as string}), '[]'::jsonb) where restaurant_id = ${ctx.restaurantId}`,
      );
    },
  },
  addons: {
    table: addons as never,
    module: "menu",
    entity: "addon",
    create: z.object({ name: nameStr, price: money, isAvailable: z.boolean().default(true), isActive: z.boolean().default(true), sortOrder: z.number().int().default(0) }),
    searchCols: ["name"],
    order: "sortOrder",
    afterDelete: async (ctx, row) => {
      await db.execute(sql`update products set addon_ids = coalesce((select jsonb_agg(e) from jsonb_array_elements_text(addon_ids) e where e <> ${row.id as string}), '[]'::jsonb) where restaurant_id = ${ctx.restaurantId}`);
    },
  },
  ingredients: {
    table: ingredients as never,
    module: ["inventory", "menu"],
    entity: "ingredient",
    create: z.object({ name: nameStr, unit: z.string().trim().min(1).max(12).default("g"), currentStock: z.number().min(0).max(1e9).default(0), lowStockThreshold: z.number().min(0).max(1e9).default(0), costPerUnit: money.default(0), isActive: z.boolean().default(true) }),
    update: z.object({ name: nameStr, unit: z.string().trim().min(1).max(12), lowStockThreshold: z.number().min(0).max(1e9), costPerUnit: money, isActive: z.boolean() }).partial(), // stock only via /inventory/adjust
    searchCols: ["name"],
    softDelete: true,
    afterCreate: async (ctx, row) => {
      if (Number(row.currentStock) > 0) {
        await db.insert(inventoryTransactions).values({ restaurantId: ctx.restaurantId, ingredientId: row.id as string, type: "RESTOCK", quantityBefore: 0, quantityUsed: -Number(row.currentStock), quantityAfter: Number(row.currentStock), note: "Opening stock", actorId: ctx.user.id });
      }
    },
  },
  tables: {
    table: diningTables as never,
    module: "tables",
    entity: "table",
    create: z.object({ name: nameStr.max(30), number: z.number().int().min(0).max(9999).default(0), status: z.enum(["FREE", "OCCUPIED", "RESERVED"]).default("FREE"), isActive: z.boolean().default(true) }),
    update: z.object({ name: nameStr.max(30), number: z.number().int().min(0).max(9999), status: z.enum(["FREE", "OCCUPIED", "RESERVED"]), isActive: z.boolean(), regenerateQr: z.boolean() }).partial(),
    searchCols: ["name"],
    order: "number",
    prepareCreate: (v) => ({ ...v, qrToken: crypto.randomBytes(12).toString("hex") }),
    prepareUpdate: (v) => {
      const { regenerateQr, ...rest } = v;
      return regenerateQr ? { ...rest, qrToken: crypto.randomBytes(12).toString("hex") } : rest;
    },
    actionFor: (b, a) => (b.qrToken !== a.qrToken ? "table.qr_regenerated" : null),
  },
  coupons: {
    table: coupons as never,
    module: ["promotions"],
    entity: "coupon",
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
    table: scratchCampaigns as never,
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
  const d = defs[name];
  if (!d) throw new ApiError("Unknown resource", 404, "NOT_FOUND");
  return d;
}

const col = (d: Def, name: string) => (d.table as unknown as Record<string, never>)[name];

export async function listResource(ctx: Ctx, name: string, q: { search?: string; limit?: number; offset?: number }) {
  const d = getDef(name);
  const where: SQL[] = [eq(col(d, "restaurantId"), ctx.restaurantId)];
  if (q.search && d.searchCols?.length) {
    const s = `%${q.search.replace(/[%_]/g, "")}%`;
    where.push(or(...d.searchCols.map((c) => ilike(col(d, c), s)))!);
  }
  const orderCol = d.order ? col(d, d.order) : undefined;
  const limit = Math.min(q.limit ?? 300, 500);
  const rows = await db
    .select()
    .from(d.table as PgTable)
    .where(and(...where))
    .orderBy(orderCol ? asc(orderCol) : desc(col(d, "createdAt")), asc(col(d, "name")) as never)
    .limit(limit)
    .offset(q.offset ?? 0);
  const total = (await db.select({ n: sql<number>`count(*)::int` }).from(d.table as PgTable).where(and(...where)))[0].n;
  return { items: rows, total };
}

async function getRow(ctx: Ctx, d: Def, rowId: string) {
  const r = (await db.select().from(d.table as PgTable).where(and(eq(col(d, "id"), rowId), eq(col(d, "restaurantId"), ctx.restaurantId))).limit(1))[0] as Row | undefined;
  if (!r) throw new ApiError("Not found", 404, "NOT_FOUND");
  return r;
}

export async function createResource(ctx: Ctx, name: string, body: unknown) {
  const d = getDef(name);
  let v = d.create.parse(body);
  if (d.prepareCreate) v = d.prepareCreate(v);
  const row = (await db.insert(d.table as PgTable).values({ ...v, restaurantId: ctx.restaurantId } as never).returning())[0] as Row;
  await logActivity(ctx, `${d.entity}.created`, d.entity, String(row.id), null, row);
  if (d.afterCreate) await d.afterCreate(ctx, row);
  return row;
}

export async function updateResource(ctx: Ctx, name: string, rowId: string, body: unknown) {
  const d = getDef(name);
  const before = await getRow(ctx, d, rowId);
  const schema = d.update ?? (d.create as unknown as z.ZodObject).partial?.() ?? d.create;
  let v = schema.parse(body);
  if (d.prepareUpdate) v = d.prepareUpdate(v, before);
  if (!Object.keys(v).length) return before;
  const row = (await db.update(d.table as PgTable).set({ ...v, ...(("updatedAt" in (d.table as object)) ? { updatedAt: new Date() } : {}) } as never).where(and(eq(col(d, "id"), rowId), eq(col(d, "restaurantId"), ctx.restaurantId))).returning())[0] as Row;
  const action = d.actionFor?.(before, row) ?? `${d.entity}.updated`;
  await logActivity(ctx, action, d.entity, rowId, before, row);
  return row;
}

export async function deleteResource(ctx: Ctx, name: string, rowId: string) {
  const d = getDef(name);
  const before = await getRow(ctx, d, rowId);
  if (d.softDelete) {
    await db.update(d.table as PgTable).set({ isActive: false, updatedAt: new Date() } as never).where(and(eq(col(d, "id"), rowId), eq(col(d, "restaurantId"), ctx.restaurantId)));
    await logActivity(ctx, `${d.entity}.deactivated`, d.entity, rowId, before, { ...before, isActive: false });
    return { ok: true, deactivated: true };
  }
  await db.delete(d.table as PgTable).where(and(eq(col(d, "id"), rowId), eq(col(d, "restaurantId"), ctx.restaurantId)));
  if (d.afterDelete) await d.afterDelete(ctx, before);
  await logActivity(ctx, `${d.entity}.deleted`, d.entity, rowId, before, null);
  return { ok: true };
}
