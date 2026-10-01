import { tenantRepos, type Tx } from "@/lib/repositories";
import type { Ctx } from "./auth";

const SECRET_KEYS = /password|secret|token|hash|key|credential/i;
/** Removes secret-looking keys (recursively) so they can never reach the audit log. */
export function scrub(v: unknown): unknown {
  if (v instanceof Date) return v;
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(scrub);
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !SECRET_KEYS.test(k))
      .map(([k, x]) => [k, scrub(x)]),
  );
}

/** Records Actor / Role / Action / Entity / EntityId / Before / After / Timestamp. */
export async function logActivity(
  ctx: Pick<Ctx, "user" | "restaurantId" | "role">,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  tx?: Tx,
) {
  await tenantRepos(ctx.restaurantId).activityLogs.append(
    {
      actorId: ctx.user.id,
      actorName: ctx.user.name || ctx.user.email,
      actorRole: ctx.role,
      action,
      entityType,
      entityId,
      before: scrub(before) ?? null,
      after: scrub(after) ?? null,
    },
    tx,
  );
}

export async function notify(restaurantId: string, type: string, title: string, body = "", key?: string, tx?: Tx) {
  await tenantRepos(restaurantId).notifications.push(key ?? `${type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, { type, title, body }, tx);
}
