import { db } from "@/db";
import { activityLogs, notifications } from "@/db/schema";
import type { Ctx } from "./auth";

type Tx = Pick<typeof db, "insert">;

const SECRET_KEYS = /password|secret|token|hash|key/i;
function scrub(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(scrub);
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !SECRET_KEYS.test(k))
      .map(([k, x]) => [k, scrub(x)]),
  );
}

export async function logActivity(
  ctx: Pick<Ctx, "user" | "restaurantId" | "role">,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  tx: Tx = db,
) {
  await tx.insert(activityLogs).values({
    restaurantId: ctx.restaurantId,
    actorId: ctx.user.id,
    actorName: ctx.user.name || ctx.user.email,
    actorRole: ctx.role,
    action,
    entityType,
    entityId,
    before: (scrub(before) ?? null) as never,
    after: (scrub(after) ?? null) as never,
  });
}

export async function notify(restaurantId: string, type: string, title: string, body = "", dedupeKey?: string, tx: Tx = db) {
  await tx.insert(notifications).values({ restaurantId, type, title, body, dedupeKey: dedupeKey ?? null }).onConflictDoNothing();
}
