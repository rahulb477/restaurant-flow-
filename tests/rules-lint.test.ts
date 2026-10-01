import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fs = readFileSync("firestore.rules", "utf8");
const st = readFileSync("storage.rules", "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const F = code(fs);
const S = code(st);

/** Static guard-rails that run everywhere (no emulator needed). Behavioural rules tests live in tests/rules/ (emulator). */
describe("firestore.rules (static)", () => {
  it("is a v2 ruleset with a default deny", () => {
    expect(fs).toMatch(/rules_version\s*=\s*'2'/);
    expect(F).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  });

  it("never grants a write to clients and never opens anything with `if true` except the token-gated order view", () => {
    const allows = [...F.matchAll(/allow\s+([a-z, ]+):\s*if\s+([^;]+);/g)].map((m) => ({ ops: m[1].split(",").map((s) => s.trim()), cond: m[2].trim() }));
    expect(allows.length).toBeGreaterThan(20);
    for (const a of allows) {
      const writes = a.ops.some((o) => ["write", "create", "update", "delete"].includes(o));
      if (writes) expect(a.cond, `write rule must be denied: ${a.ops.join(",")}`).toBe("false");
      if (a.cond === "true") expect(a.ops).toEqual(["get"]);
    }
    expect(F.match(/if true/g)?.length).toBe(1); // only publicOrders/{token} get
    expect(F).toMatch(/match \/publicOrders\/\{token\}\s*\{\s*allow get: if true;\s*allow list, write: if false;/);
  });

  it("derives tenant access from the membership document, not from client-supplied values", () => {
    expect(F).toMatch(/restaurants\/\$\(rid\)\/members\/\$\(request\.auth\.uid\)/);
    expect(F).not.toMatch(/request\.resource\.data\.(role|restaurantId|ownerId)/);
    expect(F).not.toMatch(/request\.auth\.token\.(role|restaurantId)/);
  });

  it.each([
    "members", "staff", "categories", "products", "variantGroups", "addons", "ingredients", "recipes", "inventoryTransactions", "tables", "orders", "payments", "bills",
    "customers", "coupons", "loyalty", "scratchCampaigns", "scratchCards", "reviews", "usage", "settlements", "activityLogs", "notifications", "kitchenTickets",
  ])("covers tenant subcollection %s", (c) => {
    expect(F).toMatch(new RegExp(`match /${c}/\\{`));
  });

  it("restricts money, usage and audit data to the right roles", () => {
    for (const c of ["usage", "settlements", "activityLogs", "staff"]) expect(F).toMatch(new RegExp(`match /${c}/\\{id\\}\\s*\\{ allow read: if ownerOnly\\(rid\\)|match /${c}/\\{id\\}\\s*\\{\\s*allow read: if ownerOnly\\(rid\\)`));
    expect(F).toMatch(/match \/payments\/\{id\}\s*\{ allow read: if billingStaff\(rid\)/);
    expect(F).toMatch(/match \/ingredients\/\{id\}\s*\{ allow read: if managers\(rid\)/);
  });

  it("slug and QR lookup tables are fully private", () => {
    expect(F).toMatch(/match \/slugs\/\{slug\}\s*\{\s*allow read, write: if false;/);
    expect(F).toMatch(/match \/qrTokens\/\{token\}\s*\{\s*allow read, write: if false;/);
  });
});

describe("storage.rules (static)", () => {
  it("denies by default and checks auth, tenant membership, type and size on writes", () => {
    expect(S).toMatch(/match \/\{allPaths=\*\*\}\s*\{\s*allow read, write: if false;/);
    expect(S).toMatch(/request\.auth != null/);
    expect(S).toMatch(/firestore\.(get|exists)\(\/databases\/\(default\)\/documents\/restaurants\/\$\(rid\)\/members\/\$\(request\.auth\.uid\)\)/);
    expect(S).toMatch(/contentType\.matches\('image\/\(png\|jpeg\|webp\)'\)/);
    expect(S).toMatch(/size <= 5 \* 1024 \* 1024/);
  });
  it("every create/update/delete rule requires a role check", () => {
    const rules = [...S.matchAll(/allow\s+([a-z, ]+):\s*if\s+([^;]+);/g)].filter((m) => /create|update|delete|write/.test(m[1]));
    expect(rules.length).toBeGreaterThan(0);
    for (const m of rules) expect(m[2], m[0]).toMatch(/hasRole\(|^false$/);
  });
  it("invoices are server-written only and never public", () => {
    expect(S).toMatch(/match \/invoices\/\{file\}\s*\{[^}]*allow write: if false;/);
    expect(S).not.toMatch(/invoices[^}]*allow read: if true/);
  });
  it("the upload cap matches the app default", () => {
    expect(readFileSync(".env.example", "utf8")).toMatch(/MAX_UPLOAD_MB=5/);
  });
});
