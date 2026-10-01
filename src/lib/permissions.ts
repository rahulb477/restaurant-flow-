export const ROLES = ["OWNER", "MANAGER", "CASHIER", "KITCHEN", "STAFF"] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = [
  "dashboard",
  "pos",
  "orders",
  "bills",
  "kds",
  "menu",
  "inventory",
  "tables",
  "promotions",
  "loyalty",
  "scratch",
  "reviews",
  "staff",
  "analytics",
  "usage",
  "settings",
] as const;
export type AppModule = (typeof MODULES)[number];

const MATRIX: Record<Role, readonly AppModule[]> = {
  OWNER: MODULES,
  MANAGER: ["dashboard", "pos", "orders", "bills", "kds", "menu", "inventory", "tables", "promotions", "loyalty", "scratch", "reviews", "analytics"],
  CASHIER: ["pos", "orders", "bills"],
  KITCHEN: ["kds"],
  STAFF: ["pos", "orders"],
};

const matrixFor = (role: string | undefined | null): readonly AppModule[] => (role && Object.prototype.hasOwnProperty.call(MATRIX, role) ? MATRIX[role as Role] : []);
export const can = (role: string | undefined | null, mod: AppModule) => matrixFor(role).includes(mod);
export const modulesFor = (role: string) => matrixFor(role);
export const homeFor = (role: string) => {
  const m = modulesFor(role)[0];
  return m === "dashboard" ? "/dashboard" : m ? `/dashboard/${m}` : "/login";
};
