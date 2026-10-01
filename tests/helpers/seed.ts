import { MemoryFirestore } from "./memory-firestore";
import { __setAdminDbForTests } from "@/lib/firebase/admin";
import { repos, tenantRepos, type TenantRepositories } from "@/lib/repositories";

export type World = {
  db: MemoryFirestore;
  rid: string;
  T: TenantRepositories;
  ownerId: string;
  tableId: string;
  tableToken: string;
  ids: { coffee: string; sandwich: string; hidden: string; size: string; large: string; small: string; cheese: string; milk: string; beans: string; sugar: string };
};

const D = () => new Date();

/** A fresh in-memory Firestore containing one restaurant with a small menu, recipes and one table. */
export async function createWorld(opts: { slug?: string; owner?: string; settings?: Record<string, unknown> } = {}): Promise<World> {
  const db = new MemoryFirestore();
  __setAdminDbForTests(db.asFirestore());
  return seedRestaurant(db, opts);
}

/** Adds another tenant to an existing in-memory database (for isolation tests). */
export async function seedRestaurant(db: MemoryFirestore, opts: { slug?: string; owner?: string; settings?: Record<string, unknown> } = {}): Promise<World> {
  const R = repos();
  const ownerId = opts.owner ?? `owner-${Math.random().toString(36).slice(2, 8)}`;
  const r = await R.restaurants.createWithOwner({
    slug: opts.slug ?? `cafe-${Math.random().toString(36).slice(2, 8)}`,
    owner: { id: ownerId, email: `${ownerId}@example.com`, name: "Owner" },
    data: {
      name: "Test Cafe", businessType: "CAFE", phone: "", email: "", address: "", city: "", state: "", country: "India", pincode: "", latitude: null, longitude: null,
      logoUrl: "", accent: "#f59e0b", currency: "INR", timezone: "Asia/Kolkata", settings: opts.settings ?? {}, loyaltyProgram: null, onboardingStep: 7, onboardingDone: true,
    },
  });
  const T = tenantRepos(r.id);
  const now = D();
  const cat = await T.categories.create(null, { name: "Drinks", imageUrl: "", sortOrder: 0, isActive: true, createdAt: now, updatedAt: now });
  const size = await T.variantGroups.create(null, {
    name: "Size", selectionType: "SINGLE", required: true, minSelections: 1, maxSelections: 1, isActive: true, createdAt: now, updatedAt: now,
    options: [
      { id: "small", name: "Small", priceAdjustment: 0, isAvailable: true, sortOrder: 0 },
      { id: "large", name: "Large", priceAdjustment: 3000, isAvailable: true, sortOrder: 1 },
    ],
  });
  const cheese = await T.addons.create(null, { name: "Extra Cheese", price: 2000, isAvailable: true, isActive: true, sortOrder: 0, createdAt: now, updatedAt: now });
  const base = { categoryId: cat.id, slug: "x", description: "", imageUrl: "", availability: "AVAILABLE" as const, isPopular: false, isRecommended: false, isVeg: true, sortOrder: 0, isActive: true, createdAt: now, updatedAt: now };
  const coffee = await T.products.create(null, { ...base, name: "Coffee", price: 10000, variantGroupIds: [size.id], addonIds: [cheese.id] });
  const sandwich = await T.products.create(null, { ...base, name: "Sandwich", price: 15000, variantGroupIds: [], addonIds: [] });
  const hidden = await T.products.create(null, { ...base, name: "Hidden", price: 100, variantGroupIds: [], addonIds: [], isActive: false });
  const ing = (name: string, unit: string, stock: number) => T.ingredients.create(null, { name, unit, currentStock: stock, lowStockThreshold: 10, costPerUnit: 0, isActive: true, createdAt: now, updatedAt: now });
  const [milk, beans, sugar] = await Promise.all([ing("Milk", "ml", 1000), ing("Coffee beans", "g", 500), ing("Sugar", "g", 300)]);
  await T.recipes.set(coffee.id, { productId: coffee.id, notes: "", updatedAt: now, items: [{ ingredientId: milk.id, quantity: 200 }, { ingredientId: beans.id, quantity: 15 }, { ingredientId: sugar.id, quantity: 10 }] });
  const table = await T.tables.createWithQr(r.id, { name: "T1", number: 1, qrToken: `qr${Math.random().toString(36).slice(2, 12)}tok`, status: "FREE", isActive: true, createdAt: now, updatedAt: now });
  return { db, rid: r.id, T, ownerId, tableId: table.id, tableToken: table.qrToken, ids: { coffee: coffee.id, sandwich: sandwich.id, hidden: hidden.id, size: size.id, large: "large", small: "small", cheese: cheese.id, milk: milk.id, beans: beans.id, sugar: sugar.id } };
}

export const setRestaurantSettings = (w: World, settings: Record<string, unknown>) => repos().restaurants.update(w.rid, { settings });
