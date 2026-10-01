import { describe, expect, it } from "vitest";
import { MODULES, ROLES, can, homeFor, modulesFor } from "@/lib/permissions";

describe("role permission matrix", () => {
  it("OWNER can access every module", () => {
    for (const m of MODULES) expect(can("OWNER", m)).toBe(true);
  });
  it.each([
    ["MANAGER", ["staff", "usage", "settings"]],
    ["CASHIER", ["dashboard", "kds", "menu", "inventory", "tables", "promotions", "loyalty", "scratch", "reviews", "staff", "analytics", "usage", "settings"]],
    ["KITCHEN", MODULES.filter((m) => m !== "kds")],
    ["STAFF", MODULES.filter((m) => m !== "pos" && m !== "orders")],
  ] as const)("%s is denied sensitive modules", (role, denied) => {
    for (const m of denied) expect(can(role, m), `${role} → ${m}`).toBe(false);
  });
  it("only OWNER manages staff, usage and settings", () => {
    for (const m of ["staff", "usage", "settings"] as const) expect(ROLES.filter((r) => can(r, m))).toEqual(["OWNER"]);
  });
  it("kitchen sees only the KDS; cashier sees POS, orders and bills", () => {
    expect(modulesFor("KITCHEN")).toEqual(["kds"]);
    expect([...modulesFor("CASHIER")].sort()).toEqual(["bills", "orders", "pos"]);
  });
  it("unknown, empty and prototype-ish roles get nothing", () => {
    for (const r of ["", "ADMIN", "owner", "__proto__", "constructor", undefined, null]) {
      for (const m of MODULES) expect(can(r as string, m)).toBe(false);
    }
    expect(modulesFor("toString")).toEqual([]);
  });
  it("each role lands on a page it can open", () => {
    expect(homeFor("OWNER")).toBe("/dashboard");
    expect(homeFor("KITCHEN")).toBe("/dashboard/kds");
    expect(homeFor("nope")).toBe("/login");
  });
});
