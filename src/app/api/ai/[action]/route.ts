import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { api, ApiError, readJson, rateLimit } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { digitizer } from "@/lib/server/providers";
import { serverEnv } from "@/config/env";
import { logActivity } from "@/lib/server/audit";
import { slugify } from "@/lib/calculations";

const TYPES = ["image/png", "image/jpeg", "image/webp"];

export const GET = api<{ action: string }>(async () => {
  await requireCtx("menu");
  return { configured: digitizer.isConfigured(), maxUploadMb: serverEnv.MAX_UPLOAD_MB };
});

export const POST = api<{ action: string }>(async (req, { action }) => {
  const ctx = await requireCtx("menu");
  if (action === "digitize") {
    rateLimit(`digitize:${ctx.user.id}`, 10, 3600_000);
    if (!digitizer.isConfigured()) throw new ApiError("AI menu digitization is not configured on this server. Add AI_API_KEY and AI_MODEL to enable it.", 503, "AI_NOT_CONFIGURED");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ApiError("Upload a menu image first.", 400);
    if (!TYPES.includes(file.type)) throw new ApiError("Only PNG, JPG, JPEG or WEBP images are supported.", 415);
    if (file.size > serverEnv.MAX_UPLOAD_MB * 1024 * 1024) throw new ApiError(`Image is too large. The maximum is ${serverEnv.MAX_UPLOAD_MB} MB.`, 413);
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    return { menu: await digitizer.digitizeMenu(base64, file.type) };
  }
  if (action === "import") {
    const v = z
      .object({
        categories: z.array(z.object({ name: z.string().trim().min(1).max(80), items: z.array(z.object({ name: z.string().trim().min(1).max(120), price: z.number().min(0).max(1_000_000), description: z.string().max(300).optional() })).max(300) })).max(60),
      })
      .parse(await readJson(req));
    const result = await db.transaction(async (tx) => {
      const existing = await tx.select().from(categories).where(eq(categories.restaurantId, ctx.restaurantId));
      const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
      let nc = 0, np = 0, order = existing.length;
      for (const c of v.categories) {
        let cid = byName.get(c.name.toLowerCase());
        if (!cid) {
          cid = (await tx.insert(categories).values({ restaurantId: ctx.restaurantId, name: c.name, sortOrder: order++ }).returning({ id: categories.id }))[0].id;
          byName.set(c.name.toLowerCase(), cid);
          nc++;
        }
        const have = await tx.select({ n: products.name }).from(products).where(and(eq(products.restaurantId, ctx.restaurantId), eq(products.categoryId, cid), inArray(products.name, c.items.map((i) => i.name))));
        const skip = new Set(have.map((h) => h.n.toLowerCase()));
        const rows = c.items.filter((i) => !skip.has(i.name.toLowerCase())).map((i, idx) => ({ restaurantId: ctx.restaurantId, categoryId: cid!, name: i.name, slug: slugify(i.name), description: i.description ?? "", price: Math.round(i.price * 100), sortOrder: idx }));
        if (rows.length) await tx.insert(products).values(rows);
        np += rows.length;
      }
      await logActivity(ctx, "menu.ai_imported", "menu", ctx.restaurantId, null, { categories: nc, products: np }, tx);
      return { categories: nc, products: np };
    });
    return result;
  }
  throw new ApiError("Not found", 404);
});
