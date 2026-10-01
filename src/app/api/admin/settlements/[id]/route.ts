import crypto from "node:crypto";
import { z } from "zod";
import { api, ApiError, readJson } from "@/lib/server/http";
import { serverEnv, integrations } from "@/config/env";
import { finalizeSettlement } from "@/lib/server/services/usage";

/**
 * Platform-operator endpoint to confirm/fail a settlement. Protected by PLATFORM_ADMIN_SECRET (never sent to
 * browsers). Settlements are tenant-scoped, so the body names the restaurant as well as the status.
 */
export const POST = api<{ id: string }>(async (req, { id }) => {
  if (!integrations.admin()) throw new ApiError("Not found", 404);
  const given = Buffer.from(req.headers.get("x-admin-secret") ?? "");
  const want = Buffer.from(serverEnv.PLATFORM_ADMIN_SECRET!);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new ApiError("Forbidden", 403, "FORBIDDEN");
  const { status, restaurantId } = z.object({ status: z.enum(["PAID", "FAILED"]), restaurantId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).parse(await readJson(req));
  return { settlement: await finalizeSettlement(restaurantId, id, status) };
});
