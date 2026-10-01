import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined, auth: undefined as unknown as import("./helpers/fake-auth").FakeAdminAuth, set: vi.fn(), del: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "__session" && h.cookie ? { value: h.cookie } : undefined), set: h.set, delete: h.del }),
  headers: async () => new Headers({ "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/firebase/admin", async (orig) => ({ ...(await orig<typeof import("@/lib/firebase/admin")>()), getAdminAuth: () => h.auth }));

import { FakeAdminAuth } from "./helpers/fake-auth";
import { createSession, getCtx, requireCtx, sha256 } from "@/lib/server/auth";
import { newInviteToken, parseInviteToken } from "@/lib/server/services/staff";
import { POST as authPost } from "@/app/api/auth/[action]/route";
import { GET as inviteGet } from "@/app/api/invite/[token]/route";
import { createWorld, type World } from "./helpers/seed";
import { repos } from "@/lib/repositories";

let w: World;
beforeEach(async () => {
  h.auth = new FakeAdminAuth();
  h.cookie = undefined;
  h.set.mockClear();
  w = await createWorld();
  h.auth.addUser({ uid: w.ownerId, email: `${w.ownerId}@example.com`, emailVerified: true });
});

const post = (action: string, body: unknown) =>
  authPost(new Request(`http://x/api/auth/${action}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `9.9.9.${Math.floor(Math.random() * 250)}` } }), { params: Promise.resolve({ action }) });

async function invite(role: "MANAGER" | "CASHIER" | "KITCHEN" | "STAFF" = "CASHIER", email = "new@example.com", expiresAt = new Date(Date.now() + 86400_000)) {
  const id = w.T.staff.newId();
  const { token, tokenHash } = newInviteToken(w.rid, id);
  await w.T.staff.create(id, { restaurantId: w.rid, email, role, tokenHash, status: "PENDING", expiresAt, emailedAt: null, invitedBy: w.ownerId, createdAt: new Date() } as never);
  return { id, token };
}

describe("session bridge", () => {
  it("rejects an invalid ID token and sets no cookie", async () => {
    const r = await post("session", { idToken: "garbage-garbage-garbage-garbage" });
    expect(r.status).toBe(401);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("requires a recent sign-in", async () => {
    const t = h.auth.issueIdToken(w.ownerId, Math.floor(Date.now() / 1000) - 3600);
    await expect(createSession(t)).rejects.toMatchObject({ code: "RECENT_LOGIN_REQUIRED" });
  });

  it("mints an httpOnly cookie and creates the Firestore profile without any password field", async () => {
    const t = h.auth.issueIdToken(w.ownerId);
    const r = await post("session", { idToken: t, name: "Owner Name" });
    expect(r.status).toBe(200);
    const [name, , opts] = h.set.mock.calls[0];
    expect(name).toBe("__session");
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true });
    const profile = (await repos().users.get(w.ownerId))! as Record<string, unknown>;
    expect(JSON.stringify(Object.keys(profile))).not.toMatch(/pass/i);
  });
});

describe("tenant context comes from Firestore membership, never the client", () => {
  it("no cookie → no context, 401", async () => {
    expect(await getCtx()).toBeNull();
    await expect(requireCtx()).rejects.toMatchObject({ status: 401 });
  });

  it("resolves the owner's role and restaurant from the member document", async () => {
    h.cookie = h.auth.issueSession(w.ownerId);
    const ctx = await requireCtx();
    expect(ctx).toMatchObject({ role: "OWNER", restaurantId: w.rid });
  });

  it("enforces the permission matrix per module (CASHIER cannot reach staff or settings)", async () => {
    const uid = "cashier1";
    h.auth.addUser({ uid, email: "c@example.com" });
    await repos().users.ensure(uid, "c@example.com", "C");
    await repos().users.addRestaurant(uid, w.rid);
    await w.T.members.set(uid, { userId: uid, restaurantId: w.rid, role: "CASHIER", status: "ACTIVE", name: "C", email: "c@example.com", createdAt: new Date() });
    h.cookie = h.auth.issueSession(uid);
    await expect(requireCtx("staff")).rejects.toMatchObject({ status: 403 });
    await expect(requireCtx("settings")).rejects.toMatchObject({ status: 403 });
    await expect(requireCtx("bills")).resolves.toMatchObject({ role: "CASHIER" });
  });

  it("a disabled member loses access immediately", async () => {
    const uid = "m1";
    h.auth.addUser({ uid, email: "m@example.com" });
    await repos().users.ensure(uid, "m@example.com", "M");
    await repos().users.addRestaurant(uid, w.rid);
    await w.T.members.set(uid, { userId: uid, restaurantId: w.rid, role: "MANAGER", status: "DISABLED", name: "M", email: "m@example.com", createdAt: new Date() });
    h.cookie = h.auth.issueSession(uid);
    await expect(requireCtx()).rejects.toMatchObject({ status: 403, code: "NO_WORKSPACE" });
  });

  it("a user who lists a restaurant in their profile but has no member doc gets nothing", async () => {
    const uid = "intruder";
    h.auth.addUser({ uid, email: "i@example.com" });
    await repos().users.ensure(uid, "i@example.com", "I");
    await repos().users.addRestaurant(uid, w.rid);
    h.cookie = h.auth.issueSession(uid);
    expect(await getCtx()).toBeNull();
  });
});

describe("staff invitations", () => {
  it("tokens are self-locating, hash-only at rest, and malformed ones are rejected", () => {
    const { token, tokenHash } = newInviteToken("rest1234", "staff1234");
    const p = parseInviteToken(token)!;
    expect(p).toMatchObject({ restaurantId: "rest1234", staffId: "staff1234" });
    expect(sha256(p.secret)).toBe(tokenHash);
    expect(token).not.toContain(tokenHash);
    for (const bad of ["", "a.b", "a.b.c.d.e", "../x.y.zzzzzzzzzzzzzzzzzz", `rest1234.staff1234.${"G".repeat(20)}`]) expect(parseInviteToken(bad)).toBeNull();
  });

  it("accepting creates the account and a member with the role stored in the invitation — client-supplied role is ignored", async () => {
    const inv = await invite("KITCHEN");
    const r = await post("accept-invite", { token: inv.token, name: "Kit", password: "longenough1", role: "OWNER" });
    expect(r.status).toBe(200);
    const acct = await h.auth.getUserByEmail("new@example.com");
    const m = (await w.T.members.get(acct.uid))!;
    expect(m).toMatchObject({ role: "KITCHEN", status: "ACTIVE", restaurantId: w.rid });
    expect(JSON.stringify(m)).not.toMatch(/pass/i);
    expect((await w.T.staff.get(inv.id))!.status).toBe("ACCEPTED");
  });

  it("an invitation can be used only once", async () => {
    const inv = await invite();
    expect((await post("accept-invite", { token: inv.token, name: "A", password: "longenough1" })).status).toBe(200);
    expect((await post("accept-invite", { token: inv.token, name: "A", password: "longenough1" })).status).toBe(400);
  });

  it("expired, forged and wrong-secret tokens fail", async () => {
    const expired = await invite("STAFF", "e@example.com", new Date(Date.now() - 1000));
    expect((await post("accept-invite", { token: expired.token, name: "E", password: "longenough1" })).status).toBe(400);
    const ok = await invite();
    const forged = ok.token.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
    expect((await post("accept-invite", { token: forged, name: "F", password: "longenough1" })).status).toBe(400);
    expect(h.auth.users.size).toBe(1); // no account was created by failed attempts
  });

  it("an existing account must prove ownership with its own ID token", async () => {
    h.auth.addUser({ uid: "existing1", email: "ex@example.com" });
    const inv = await invite("MANAGER", "ex@example.com");
    expect((await post("accept-invite", { token: inv.token })).status).toBe(401);
    const other = h.auth.addUser({ uid: "other1", email: "o@example.com" });
    expect((await post("accept-invite", { token: inv.token, idToken: h.auth.issueIdToken(other.uid) })).status).toBe(401);
    expect((await post("accept-invite", { token: inv.token, idToken: h.auth.issueIdToken("existing1") })).status).toBe(200);
    expect((await w.T.members.get("existing1"))!.role).toBe("MANAGER");
  });

  it("public invite lookup reveals only email/role/restaurant name and 404s for bad tokens", async () => {
    const inv = await invite("CASHIER");
    const ok = await inviteGet(new Request("http://x"), { params: Promise.resolve({ token: inv.token }) });
    const body = await ok.json();
    expect(body).toMatchObject({ email: "new@example.com", role: "CASHIER", existingAccount: false });
    expect(JSON.stringify(body)).not.toContain(sha256(inv.token));
    const bad = await inviteGet(new Request("http://x"), { params: Promise.resolve({ token: "nope.nope.nope" }) });
    expect(bad.status).toBe(404);
  });
});
