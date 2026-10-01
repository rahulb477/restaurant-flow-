import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { members, invitations, sessions } from "@/db/schema";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/audit";

type P = { id: string };

async function target(restaurantId: string, id: string, selfUserId: string) {
  const m = (await db.select().from(members).where(and(eq(members.id, id), eq(members.restaurantId, restaurantId))).limit(1))[0];
  if (!m) throw new ApiError("Team member not found", 404, "NOT_FOUND");
  if (m.role === "OWNER") throw new ApiError("The owner account cannot be changed.", 403, "FORBIDDEN");
  if (m.userId === selfUserId) throw new ApiError("You cannot change your own access.", 403, "FORBIDDEN");
  return m;
}

export const PATCH = api<P>(async (req, { id }) => {
  const ctx = await requireCtx("staff");
  const v = z.object({ role: z.enum(["MANAGER", "CASHIER", "KITCHEN", "STAFF"]).optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() }).parse(await readJson(req));
  const m = await target(ctx.restaurantId, id, ctx.user.id);
  const [u] = await db.update(members).set(v).where(and(eq(members.id, id), eq(members.restaurantId, ctx.restaurantId))).returning();
  if (v.status === "DISABLED") await db.delete(sessions).where(eq(sessions.userId, m.userId));
  await logActivity(ctx, v.role && v.role !== m.role ? "staff.role_changed" : "staff.status_changed", "member", id, { role: m.role, status: m.status }, { role: u.role, status: u.status });
  return { member: u };
});

export const DELETE = api<P>(async (req, { id }) => {
  const ctx = await requireCtx("staff");
  if (new URL(req.url).searchParams.get("type") === "invite") {
    await db.update(invitations).set({ status: "REVOKED" }).where(and(eq(invitations.id, id), eq(invitations.restaurantId, ctx.restaurantId)));
    await logActivity(ctx, "staff.invite_revoked", "invitation", id);
    return { ok: true };
  }
  const m = await target(ctx.restaurantId, id, ctx.user.id);
  await db.delete(members).where(and(eq(members.id, id), eq(members.restaurantId, ctx.restaurantId)));
  await db.delete(sessions).where(eq(sessions.userId, m.userId));
  await logActivity(ctx, "staff.removed", "member", id, { role: m.role }, null);
  return { ok: true };
});
