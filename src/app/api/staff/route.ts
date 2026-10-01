import { z } from "zod";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx } from "@/lib/server/auth";
import { tenantRepos } from "@/lib/repositories";
import { emailProvider } from "@/lib/server/providers";
import { logActivity, notify } from "@/lib/server/audit";
import { newInviteToken } from "@/lib/server/services/staff";
import { publicEnv } from "@/config/env";

export const GET = api(async () => {
  const ctx = await requireCtx("staff");
  const T = tenantRepos(ctx.restaurantId);
  const [members, pending] = await Promise.all([T.members.listAll(), T.staff.listPending(new Date())]);
  return {
    members: members.sort((a, b) => +a.createdAt - +b.createdAt).map((m) => ({ id: m.id, userId: m.userId, role: m.role, status: m.status, name: m.name, email: m.email, createdAt: m.createdAt })),
    pending: pending.map((p) => ({ id: p.id, email: p.email, role: p.role, expiresAt: p.expiresAt, emailedAt: p.emailedAt })),
    emailConfigured: emailProvider.isConfigured(),
    selfUserId: ctx.user.id,
  };
});

export const POST = api(async (req) => {
  const ctx = await requireCtx("staff");
  const v = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), role: z.enum(["MANAGER", "CASHIER", "KITCHEN", "STAFF"]) }).parse(await readJson(req));
  const T = tenantRepos(ctx.restaurantId);
  const members = await T.members.listAll();
  if (members.some((m) => m.email.toLowerCase() === v.email)) throw new ApiError("That person is already on your team.", 409, "EXISTS");
  await T.staff.revokePendingForEmail(v.email);
  const id = T.staff.newId();
  const { token, tokenHash } = newInviteToken(ctx.restaurantId, id);
  const now = new Date();
  await T.staff.create(id, { restaurantId: ctx.restaurantId, email: v.email, role: v.role, tokenHash, status: "PENDING", expiresAt: new Date(now.getTime() + 7 * 86400_000), emailedAt: null, invitedBy: ctx.user.id, createdAt: now });
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const link = `${(publicEnv.appUrl || `${proto}://${host}`).replace(/\/$/, "")}/accept-invite?token=${token}`;
  let emailed = false;
  let emailError: string | null = null;
  try {
    await emailProvider.sendStaffInvitation(v.email, ctx.restaurant.name, link, v.role);
    await T.staff.update(id, { emailedAt: new Date() });
    emailed = true;
  } catch (e) {
    emailError = e instanceof ApiError ? e.message : "Email could not be sent.";
  }
  await logActivity(ctx, "staff.invited", "invitation", id, null, { email: v.email, role: v.role });
  await notify(ctx.restaurantId, "STAFF_INVITE", `Invitation created for ${v.email}`, v.role, `staff-invite:${id}`);
  // The owner may share the link manually when e-mail is unavailable.
  return { invitation: { id, email: v.email, role: v.role }, emailed, emailError, link: emailed ? undefined : link };
});
