import { z } from "zod";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { members, users, invitations } from "@/db/schema";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx, randomToken, sha256 } from "@/lib/server/auth";
import { emailProvider } from "@/lib/server/providers";
import { logActivity, notify } from "@/lib/server/audit";
import { publicEnv } from "@/config/env";

export const GET = api(async () => {
  const ctx = await requireCtx("staff");
  const active = await db
    .select({ id: members.id, userId: members.userId, role: members.role, status: members.status, name: users.name, email: users.email, createdAt: members.createdAt })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.restaurantId, ctx.restaurantId))
    .orderBy(members.createdAt);
  const pending = await db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, emailedAt: invitations.emailedAt })
    .from(invitations)
    .where(and(eq(invitations.restaurantId, ctx.restaurantId), eq(invitations.status, "PENDING"), gt(invitations.expiresAt, new Date())))
    .orderBy(desc(invitations.createdAt));
  return { members: active, pending, emailConfigured: emailProvider.isConfigured(), selfUserId: ctx.user.id };
});

export const POST = api(async (req) => {
  const ctx = await requireCtx("staff");
  const v = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), role: z.enum(["MANAGER", "CASHIER", "KITCHEN", "STAFF"]) }).parse(await readJson(req));
  const existing = await db.select({ id: members.id }).from(members).innerJoin(users, eq(users.id, members.userId)).where(and(eq(members.restaurantId, ctx.restaurantId), eq(users.email, v.email))).limit(1);
  if (existing.length) throw new ApiError("That person is already on your team.", 409, "EXISTS");
  await db.update(invitations).set({ status: "REVOKED" }).where(and(eq(invitations.restaurantId, ctx.restaurantId), eq(invitations.email, v.email), eq(invitations.status, "PENDING")));
  const token = randomToken();
  const [inv] = await db.insert(invitations).values({ restaurantId: ctx.restaurantId, email: v.email, role: v.role, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400_000) }).returning();
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const link = `${(publicEnv.appUrl || `${proto}://${host}`).replace(/\/$/, "")}/accept-invite?token=${token}`;
  let emailed = false;
  let emailError: string | null = null;
  try {
    await emailProvider.sendStaffInvitation(v.email, ctx.restaurant.name, link, v.role);
    await db.update(invitations).set({ emailedAt: new Date() }).where(eq(invitations.id, inv.id));
    emailed = true;
  } catch (e) {
    emailError = e instanceof ApiError ? e.message : "Email could not be sent.";
  }
  await logActivity(ctx, "staff.invited", "invitation", inv.id, null, { email: v.email, role: v.role });
  await notify(ctx.restaurantId, "STAFF_INVITE", `Invitation created for ${v.email}`, v.role);
  // The owner is authorised to share the link manually when email is unavailable.
  return { invitation: { id: inv.id, email: inv.email, role: inv.role }, emailed, emailError, link: emailed ? undefined : link };
});
