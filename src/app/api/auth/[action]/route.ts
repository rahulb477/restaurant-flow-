import { z } from "zod";
import { getAdminAuth } from "@/lib/firebase/admin";
import { api, ApiError, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { createSession, destroySession, getCtx, getSessionUser, sha256 } from "@/lib/server/auth";
import { repos } from "@/lib/repositories";
import { logActivity } from "@/lib/server/audit";
import { parseInviteToken } from "@/lib/server/services/staff";

type P = { action: string };

const password = z.string().min(8, "Password must be at least 8 characters").max(128);

export const GET = api<P>(async (_req, { action }) => {
  if (action === "token") {
    // Lets the browser restore its Firebase client sign-in (needed for Firestore listeners) from the httpOnly session.
    const u = await getSessionUser();
    if (!u) throw new ApiError("Please sign in.", 401, "UNAUTHENTICATED");
    return { token: await getAdminAuth().createCustomToken(u.id) };
  }
  if (action !== "me") throw new ApiError("Not found", 404);
  const ctx = await getCtx();
  const user = ctx?.user ?? (await getSessionUser());
  if (!user) return { user: null };
  return { user, role: ctx?.role ?? null, hasWorkspace: !!ctx };
});

/**
 * Authentication itself (sign-up, sign-in, verification e-mails, password reset) is performed by Firebase
 * Authentication in the browser. These endpoints only bridge Firebase to the server:
 *   session  — verify a fresh ID token and mint an httpOnly session cookie (also creates the Firestore user profile)
 *   logout   — clear the cookie
 *   accept-invite — trusted staff onboarding (the role comes from the stored invitation, never from the client)
 */
export const POST = api<P>(async (req, { action }) => {
  const ip = clientIp(req);
  switch (action) {
    case "session": {
      rateLimit(`session:${ip}`, 40, 600_000);
      const body = z.object({ idToken: z.string().min(20), name: z.string().trim().max(80).optional() }).parse(await readJson(req));
      const user = await createSession(body.idToken);
      await repos().users.ensure(user.id, user.email, body.name || user.name);
      return { ok: true, emailVerified: user.emailVerified };
    }
    case "logout": {
      await destroySession();
      return { ok: true };
    }
    case "password-changed": {
      const ctx = await getCtx();
      if (ctx) await logActivity(ctx, "account.password_changed", "user", ctx.user.id);
      return { ok: true };
    }
    case "accept-invite": {
      rateLimit(`invite:${ip}`, 15, 3600_000);
      const body = z.object({ token: z.string().min(20), name: z.string().trim().max(80).optional(), password: password.optional(), idToken: z.string().optional() }).parse(await readJson(req));
      const parsed = parseInviteToken(body.token);
      if (!parsed) throw new ApiError("This invitation is invalid or has expired.", 400, "TOKEN_INVALID");
      const R = repos();
      const T = R.tenant(parsed.restaurantId);
      const inv = await T.staff.get(parsed.staffId);
      if (!inv || inv.status !== "PENDING" || inv.expiresAt < new Date() || inv.tokenHash !== sha256(parsed.secret)) throw new ApiError("This invitation is invalid or has expired.", 400, "TOKEN_INVALID");
      const auth = getAdminAuth();

      let uid: string;
      let name = body.name?.trim() ?? "";
      const existing = await auth.getUserByEmail(inv.email).catch(() => null);
      if (existing) {
        // The invitee must prove they own the existing account by presenting a fresh ID token for it.
        if (!body.idToken) throw new ApiError("An account with this email already exists. Sign in with it to join.", 401, "BAD_CREDENTIALS");
        const decoded = await auth.verifyIdToken(body.idToken, true).catch(() => null);
        if (!decoded || decoded.uid !== existing.uid) throw new ApiError("Sign in with the invited email address to join.", 401, "BAD_CREDENTIALS");
        uid = existing.uid;
        name = name || existing.displayName || "";
      } else {
        if (!name) throw new ApiError("Enter your name.", 400, "VALIDATION");
        if (!body.password) throw new ApiError("Choose a password.", 400, "VALIDATION");
        const created = await auth.createUser({ email: inv.email, password: body.password, displayName: name, emailVerified: true });
        uid = created.uid;
      }

      const profile = await R.users.ensure(uid, inv.email, name);
      if (profile.restaurantIds.length) {
        for (const rid of profile.restaurantIds) {
          const m = await R.tenant(rid).members.get(uid);
          if (m?.status === "ACTIVE" && rid !== parsed.restaurantId) throw new ApiError("This account already belongs to a workspace.", 409, "ALREADY_MEMBER");
        }
      }
      await R.transaction(async (tx) => {
        const fresh = await T.staff.get(inv.id, tx);
        if (!fresh || fresh.status !== "PENDING") throw new ApiError("This invitation is invalid or has expired.", 400, "TOKEN_INVALID");
        await R.users.addRestaurant(uid, parsed.restaurantId, tx);
        await T.members.set(uid, { userId: uid, restaurantId: parsed.restaurantId, role: inv.role, status: "ACTIVE", name: name || inv.email, email: inv.email, createdAt: new Date() }, tx);
        await T.staff.update(inv.id, { status: "ACCEPTED" }, tx);
      });
      return { ok: true, email: inv.email };
    }
    default:
      throw new ApiError("Not found", 404);
  }
});
