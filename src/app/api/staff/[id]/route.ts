import { z } from "zod";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { tenantRepos } from "@/lib/repositories";
import { logActivity } from "@/lib/server/audit";

type P = { id: string };

/** `id` is the member's Firebase uid. The OWNER and the caller themself can never be modified. */
async function target(restaurantId: string, id: string, selfUserId: string) {
  const m = await tenantRepos(restaurantId).members.get(id);
  if (!m) throw new ApiError("Team member not found", 404, "NOT_FOUND");
  if (m.role === "OWNER") throw new ApiError("The owner account cannot be changed.", 403, "FORBIDDEN");
  if (m.userId === selfUserId) throw new ApiError("You cannot change your own access.", 403, "FORBIDDEN");
  return m;
}

export const PATCH = api<P>(async (req, { id }) => {
  const ctx = await requireCtx("staff");
  const v = z.object({ role: z.enum(["MANAGER", "CASHIER", "KITCHEN", "STAFF"]).optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() }).parse(await readJson(req));
  const m = await target(ctx.restaurantId, id, ctx.user.id);
  const patch = { ...(v.role ? { role: v.role } : {}), ...(v.status ? { status: v.status } : {}) };
  if (Object.keys(patch).length) await tenantRepos(ctx.restaurantId).members.update(id, patch);
  const after = { role: v.role ?? m.role, status: v.status ?? m.status };
  await logActivity(ctx, v.role && v.role !== m.role ? "staff.role_changed" : "staff.status_changed", "member", id, { role: m.role, status: m.status }, after);
  return { member: { ...m, ...after } };
});

export const DELETE = api<P>(async (req, { id }) => {
  const ctx = await requireCtx("staff");
  const T = tenantRepos(ctx.restaurantId);
  if (new URL(req.url).searchParams.get("type") === "invite") {
    const inv = await T.staff.get(id);
    if (!inv) throw new ApiError("Invitation not found", 404, "NOT_FOUND");
    await T.staff.update(id, { status: "REVOKED" });
    await logActivity(ctx, "staff.invite_revoked", "invitation", id);
    return { ok: true };
  }
  const m = await target(ctx.restaurantId, id, ctx.user.id);
  await T.members.remove(id);
  await logActivity(ctx, "staff.removed", "member", id, { role: m.role }, null);
  return { ok: true };
});
