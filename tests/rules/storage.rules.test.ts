/**
 * Behavioural Storage rules tests (emulator required; skipped otherwise). See tests/rules/firestore.rules.test.ts.
 * Storage rules read membership from Firestore, so both emulators must run.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST);
const hp = (v?: string, d = "127.0.0.1:0") => (v ?? d).split(":");

describe.skipIf(!enabled)("storage.rules (emulator)", () => {
  let env: RulesTestEnvironment;
  const A = "restA";
  const B = "restB";
  const png = (n = 16) => new Uint8Array(n);

  beforeAll(async () => {
    const [fh, fp] = hp(process.env.FIRESTORE_EMULATOR_HOST);
    const [sh, sp] = hp(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
    env = await initializeTestEnvironment({
      projectId: "demo-cafepilot-rules",
      firestore: { rules: readFileSync("firestore.rules", "utf8"), host: fh, port: Number(fp) },
      storage: { rules: readFileSync("storage.rules", "utf8"), host: sh, port: Number(sp) },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const m = (rid: string, uid: string, role: string, status = "ACTIVE") => setDoc(doc(db, `restaurants/${rid}/members/${uid}`), { role, status });
      await m(A, "owner", "OWNER"); await m(A, "manager", "MANAGER"); await m(A, "cashier", "CASHIER"); await m(A, "kitchen", "KITCHEN"); await m(A, "off", "MANAGER", "DISABLED"); await m(B, "ownerB", "OWNER");
    });
  });
  afterAll(async () => env?.cleanup());

  const st = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
  const put = (uid: string | null, path: string, type = "image/png", bytes = png()) => uploadBytes(ref(st(uid), path), bytes, { contentType: type });

  it("allows owner/manager to upload valid images to their own tenant", async () => {
    await assertSucceeds(put("manager", `restaurants/${A}/products/a.png`));
    await assertSucceeds(put("owner", `restaurants/${A}/logo/l.png`));
  });
  it("blocks anonymous, cross-tenant, disabled and underprivileged writers", async () => {
    await assertFails(put(null, `restaurants/${A}/products/b.png`));
    await assertFails(put("ownerB", `restaurants/${A}/products/c.png`));
    await assertFails(put("off", `restaurants/${A}/products/d.png`));
    await assertFails(put("cashier", `restaurants/${A}/products/e.png`));
    await assertFails(put("manager", `restaurants/${A}/logo/m.png`)); // logo is owner-only
  });
  it("blocks wrong file types and oversize files", async () => {
    await assertFails(put("manager", `restaurants/${A}/products/f.pdf`, "application/pdf"));
    await assertFails(put("manager", `restaurants/${A}/products/g.svg`, "image/svg+xml"));
    await assertFails(put("manager", `restaurants/${A}/products/h.png`, "image/png", png(5 * 1024 * 1024 + 1)));
  });
  it("blocks writes to server-only and unknown folders", async () => {
    await assertFails(put("owner", `restaurants/${A}/invoices/i.png`));
    await assertFails(put("owner", `restaurants/${A}/secrets/i.png`));
    await assertFails(put("owner", `elsewhere/i.png`));
  });
  it("menu images are public; QR and invoices are not", async () => {
    await assertSucceeds(getBytes(ref(st(null), `restaurants/${A}/products/a.png`)));
    await env.withSecurityRulesDisabled(async (ctx) => { await uploadBytes(ref(ctx.storage(), `restaurants/${A}/invoices/x.pdf`), png(), { contentType: "application/pdf" }); });
    await assertFails(getBytes(ref(st(null), `restaurants/${A}/invoices/x.pdf`)));
    await assertFails(getBytes(ref(st("kitchen"), `restaurants/${A}/invoices/x.pdf`)));
    await assertSucceeds(getBytes(ref(st("cashier"), `restaurants/${A}/invoices/x.pdf`)));
  });
});
