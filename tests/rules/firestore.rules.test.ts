/**
 * Behavioural Firestore rules tests. They need the Firestore emulator and are skipped otherwise:
 *   npm run test:rules      (firebase emulators:exec --only firestore,storage "vitest run tests/rules")
 * Requires Java (for the emulator) — see FIREBASE_SETUP.md.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");

describe.skipIf(!enabled)("firestore.rules (emulator)", () => {
  let env: RulesTestEnvironment;
  const A = "restA";
  const B = "restB";
  const roles = { owner: "uOwner", manager: "uManager", cashier: "uCashier", kitchen: "uKitchen", staff: "uStaff", otherOwner: "uOwnerB", disabled: "uDisabled", nobody: "uNobody" };

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: "demo-cafepilot-rules", firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) } });
  });
  afterAll(async () => env?.cleanup());
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const member = (rid: string, uid: string, role: string, status = "ACTIVE") => setDoc(doc(db, `restaurants/${rid}/members/${uid}`), { userId: uid, restaurantId: rid, role, status });
      await setDoc(doc(db, `restaurants/${A}`), { name: "A", ownerId: roles.owner });
      await setDoc(doc(db, `restaurants/${B}`), { name: "B", ownerId: roles.otherOwner });
      await member(A, roles.owner, "OWNER");
      await member(A, roles.manager, "MANAGER");
      await member(A, roles.cashier, "CASHIER");
      await member(A, roles.kitchen, "KITCHEN");
      await member(A, roles.staff, "STAFF");
      await member(A, roles.disabled, "MANAGER", "DISABLED");
      await member(B, roles.otherOwner, "OWNER");
      for (const p of ["orders", "payments", "usage", "settlements", "ingredients", "recipes", "products", "activityLogs", "loyalty", "scratchCards", "inventoryTransactions", "staff", "customers"]) {
        await setDoc(doc(db, `restaurants/${A}/${p}/x1`), { v: 1 });
      }
      await setDoc(doc(db, `restaurants/${A}/system/counters`), { usageBalance: 0 });
      await setDoc(doc(db, "publicOrders/tok12345"), { restaurantId: A, orderId: "x1", status: "PLACED" });
      await setDoc(doc(db, "slugs/a-cafe"), { restaurantId: A });
      await setDoc(doc(db, `users/${roles.owner}`), { email: "o@example.com", restaurantIds: [A] });
      await setDoc(doc(db, `users/${roles.manager}`), { email: "m@example.com", restaurantIds: [A] });
    });
  });

  const as = (uid: string | null) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
  const readOk = (uid: string, path: string) => assertSucceeds(getDoc(doc(as(uid), path)));
  const readNo = (uid: string | null, path: string) => assertFails(getDoc(doc(as(uid), path)));

  it("blocks cross-tenant reads for every role", async () => {
    for (const p of ["orders/x1", "payments/x1", "usage/x1", "products/x1", "members/uOwner"]) await readNo(roles.otherOwner, `restaurants/${A}/${p}`);
    await readNo(roles.nobody, `restaurants/${A}/products/x1`);
    await readNo(null, `restaurants/${A}/products/x1`);
    await readNo(roles.disabled, `restaurants/${A}/products/x1`);
  });

  it("enforces the role matrix on reads", async () => {
    await readOk(roles.owner, `restaurants/${A}/usage/x1`);
    await readNo(roles.manager, `restaurants/${A}/usage/x1`);
    await readNo(roles.manager, `restaurants/${A}/settlements/x1`);
    await readNo(roles.manager, `restaurants/${A}/activityLogs/x1`);
    await readNo(roles.manager, `restaurants/${A}/staff/x1`);
    await readOk(roles.manager, `restaurants/${A}/ingredients/x1`);
    await readOk(roles.cashier, `restaurants/${A}/payments/x1`);
    await readNo(roles.staff, `restaurants/${A}/payments/x1`);
    await readOk(roles.staff, `restaurants/${A}/orders/x1`);
    await readNo(roles.kitchen, `restaurants/${A}/orders/x1`);
    await readNo(roles.kitchen, `restaurants/${A}/payments/x1`);
    await readOk(roles.kitchen, `restaurants/${A}/recipes/x1`);
    await readNo(roles.cashier, `restaurants/${A}/customers/x1`);
  });

  it("allows no client writes at all — not even the owner", async () => {
    for (const uid of Object.values(roles)) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, `restaurants/${A}/orders/new1`), { total: 1 }));
      await assertFails(updateDoc(doc(db, `restaurants/${A}/orders/x1`), { paymentStatus: "SUCCESS" }));
      await assertFails(updateDoc(doc(db, `restaurants/${A}/system/counters`), { usageBalance: -1000 }));
      await assertFails(setDoc(doc(db, `restaurants/${A}/usage/forged`), { amount: 100 }));
      await assertFails(setDoc(doc(db, `restaurants/${A}/inventoryTransactions/forged`), { delta: 1 }));
      await assertFails(setDoc(doc(db, `restaurants/${A}/loyalty/forged`), { reward: "free" }));
      await assertFails(setDoc(doc(db, `restaurants/${A}/scratchCards/forged`), { reward: "jackpot" }));
      await assertFails(deleteDoc(doc(db, `restaurants/${A}/activityLogs/x1`)));
    }
  });

  it("prevents role escalation and changes to ownerId / restaurantId", async () => {
    const db = as(roles.manager);
    await assertFails(updateDoc(doc(db, `restaurants/${A}/members/${roles.manager}`), { role: "OWNER" }));
    await assertFails(setDoc(doc(db, `restaurants/${A}/members/${roles.nobody}`), { role: "OWNER", status: "ACTIVE" }));
    await assertFails(updateDoc(doc(as(roles.owner), `restaurants/${A}`), { ownerId: roles.manager }));
    await assertFails(updateDoc(doc(as(roles.owner), `restaurants/${A}`), { restaurantId: B }));
    await assertFails(setDoc(doc(as(roles.nobody), `users/${roles.nobody}`), { restaurantIds: [A] }));
  });

  it("lets a member read only their own member document unless owner", async () => {
    await readOk(roles.manager, `restaurants/${A}/members/${roles.manager}`);
    await readNo(roles.manager, `restaurants/${A}/members/${roles.owner}`);
    await readOk(roles.owner, `restaurants/${A}/members/${roles.manager}`);
    await assertFails(getDocs(collection(as(roles.manager), `restaurants/${A}/members`)));
    await assertSucceeds(getDocs(collection(as(roles.owner), `restaurants/${A}/members`)));
  });

  it("customers: can get one order by token, cannot list or read anything else", async () => {
    await assertSucceeds(getDoc(doc(as(null), "publicOrders/tok12345")));
    await assertFails(getDocs(collection(as(null), "publicOrders")));
    await assertFails(setDoc(doc(as(null), "publicOrders/tok12345"), { status: "COMPLETED" }));
    await readNo(null, `restaurants/${A}/orders/x1`);
    await readNo(null, `restaurants/${A}/customers/x1`);
    await readNo(null, "slugs/a-cafe");
    await readNo(roles.owner, "slugs/a-cafe");
    await readNo(roles.nobody, `users/${roles.owner}`);
    await readOk(roles.owner, `users/${roles.owner}`);
  });
});
