import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { settlements, usageLedger } from "@/db/schema";
import { api, ApiError, readJson } from "@/lib/server/http";
import { serverEnv, integrations } from "@/config/env";

/** Platform-operator endpoint to confirm/fail a settlement. Protected by PLATFORM_ADMIN_SECRET. */
export const POST = api<{ id: string }>(async (req, { id }) => {
  if (!integrations.admin()) throw new ApiError("Not found", 404);
  const given = Buffer.from(req.headers.get("x-admin-secret") ?? "");
  const want = Buffer.from(serverEnv.PLATFORM_ADMIN_SECRET!);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new ApiError("Forbidden", 403, "FORBIDDEN");
  const { status } = z.object({ status: z.enum(["PAID", "FAILED"]) }).parse(await readJson(req));
  return db.transaction(async (tx) => {
    const [s] = await tx.update(settlements).set({ status, updatedAt: new Date() }).where(and(eq(settlements.id, id), inArray(settlements.status, ["PENDING", "PROCESSING"]))).returning();
    if (!s) throw new ApiError("Settlement not found or already finalised", 409);
    if (status === "FAILED") await tx.update(usageLedger).set({ status: "CHARGED", settlementId: null }).where(eq(usageLedger.settlementId, id));
    return { settlement: s };
  });
});
