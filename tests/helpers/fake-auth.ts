/** Minimal in-memory stand-in for the parts of firebase-admin/auth the server uses. */
export type FakeUser = { uid: string; email: string; displayName?: string; emailVerified?: boolean; password?: string };

export class FakeAdminAuth {
  users = new Map<string, FakeUser>();
  /** idToken -> claims */
  tokens = new Map<string, { uid: string; email?: string; auth_time: number; email_verified?: boolean; name?: string }>();
  /** session cookie -> uid */
  sessions = new Map<string, string>();
  private n = 0;

  addUser(u: FakeUser) {
    this.users.set(u.uid, u);
    return u;
  }
  issueIdToken(uid: string, authTime = Math.floor(Date.now() / 1000)) {
    const u = this.users.get(uid)!;
    const t = `idtoken-${uid}-${++this.n}-xxxxxxxxxxxxxxxxxxxx`;
    this.tokens.set(t, { uid, email: u.email, auth_time: authTime, email_verified: !!u.emailVerified, name: u.displayName });
    return t;
  }
  issueSession(uid: string) {
    const c = `session-${uid}-${++this.n}`;
    this.sessions.set(c, uid);
    return c;
  }
  async verifyIdToken(t: string) {
    const c = this.tokens.get(t);
    if (!c) throw new Error("invalid token");
    return c;
  }
  async createSessionCookie(t: string) {
    const c = await this.verifyIdToken(t);
    return this.issueSession(c.uid);
  }
  async verifySessionCookie(c: string) {
    const uid = this.sessions.get(c);
    if (!uid) throw new Error("invalid cookie");
    const u = this.users.get(uid)!;
    return { uid, email: u.email, email_verified: !!u.emailVerified, name: u.displayName };
  }
  async getUserByEmail(email: string) {
    const u = [...this.users.values()].find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
    return u;
  }
  async createUser(o: { email: string; password: string; displayName?: string; emailVerified?: boolean }) {
    return this.addUser({ uid: `u${++this.n}auth`, email: o.email, displayName: o.displayName, emailVerified: o.emailVerified, password: o.password });
  }
  async createCustomToken(uid: string) {
    return `custom-${uid}`;
  }
}
