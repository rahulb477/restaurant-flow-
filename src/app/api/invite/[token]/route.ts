import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { invitations, restaurants, users } from "@/db/schema";
import { api, ApiError } from "@/lib/server/http";
import { sha256 } from "@/lib/server/auth";

export const GET = api<{ token: string }>(async (_req, { token }) => {
  const inv = (await db.select().from(invitations).where(and(eq(invitations.tokenHash, sha256(token)), eq(invitations.status, "PENDING"), gt(invitations.expiresAt, new Date()))).limit(1))[0];
  if (!inv) throw new ApiError("This invitation is invalid or has expired.", 404, "TOKEN_INVALID");
  const r = (await db.select({ name: restaurants.name }).from(restaurants).where(eq(restaurants.id, inv.restaurantId)).limit(1))[0];
  const existing = (await db.select({ id: users.id }).from(users).where(eq(users.email, inv.email)).limit(1)).length > 0;
  return { email: inv.email, role: inv.role, restaurant: r?.name ?? "", existingAccount: existing };
});
