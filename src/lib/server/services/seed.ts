import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  restaurants,
  members,
  categories,
  products,
  variantGroups,
  addons,
  ingredients,
  recipes,
  diningTables,
  coupons,
  loyaltyPrograms,
  scratchCampaigns,
  customers,
  orders,
  payments,
  bills,
  usageLedger,
  type OrderLine,
} from "@/db/schema";
import { hashPassword, randomToken } from "../auth";
import { formatOrderId } from "@/lib/calculations";

const DEMO_EMAIL = "demo@cafepilot.demo";
const R = (n: number) => n * 100;

/** Seeds a demo workspace. Only reachable when NEXT_PUBLIC_DEMO_MODE=true. */
export async function seedDemoWorkspace(): Promise<{ ownerId: string; restaurantId: string }> {
  const existing = (await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1))[0];
  if (existing) {
    const m = (await db.select().from(members).where(eq(members.userId, existing.id)).limit(1))[0];
    if (m) return { ownerId: existing.id, restaurantId: m.restaurantId };
  }
  const owner =
    existing ?? (await db.insert(users).values({ email: DEMO_EMAIL, name: "Demo Owner", passwordHash: hashPassword(randomToken()), emailVerified: true }).returning())[0];

  const slug = "demo-cafe";
  const slugTaken = (await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.slug, slug)).limit(1)).length > 0;
  const [rest] = await db
    .insert(restaurants)
    .values({
      slug: slugTaken ? `demo-cafe-${randomToken(3)}` : slug,
      ownerId: owner.id,
      name: "CafePilot Demo Cafe",
      businessType: "CAFE",
      phone: "+91 98765 43210",
      email: "hello@demo-cafe.example",
      address: "12 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
      pincode: "560001",
      latitude: 12.9716,
      longitude: 77.5946,
      onboardingDone: true,
      onboardingStep: 7,
      isDemo: true,
      settings: { payments: { cash: true, upi: true, online: false, upiId: "democafe@upi", upiName: "CafePilot Demo Cafe" } },
    })
    .returning();
  const rid = rest.id;
  await db.insert(members).values({ restaurantId: rid, userId: owner.id, role: "OWNER" });

  for (const [email, name, role] of [
    ["manager@cafepilot.demo", "Meera Manager", "MANAGER"],
    ["cashier@cafepilot.demo", "Chirag Cashier", "CASHIER"],
    ["kitchen@cafepilot.demo", "Kabir Kitchen", "KITCHEN"],
  ] as const) {
    const u = (await db.insert(users).values({ email: `${rid.slice(0, 6)}.${email}`, name, passwordHash: hashPassword(randomToken()), emailVerified: true }).returning())[0];
    await db.insert(members).values({ restaurantId: rid, userId: u.id, role });
  }

  const cats = await db
    .insert(categories)
    .values(["Coffee", "Cold Drinks", "Fast Food", "Main Course", "Desserts"].map((name, i) => ({ restaurantId: rid, name, sortOrder: i })))
    .returning();
  const cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  const opt = (name: string, adj: number, i: number) => ({ id: crypto.randomUUID(), name, priceAdjustment: R(adj), isAvailable: true, sortOrder: i });
  const [size] = await db
    .insert(variantGroups)
    .values({ restaurantId: rid, name: "Size", selectionType: "SINGLE", required: true, minSelections: 1, maxSelections: 1, options: [opt("Small", 0, 0), opt("Medium", 20, 1), opt("Large", 40, 2)] })
    .returning();
  const ad = await db
    .insert(addons)
    .values([
      { restaurantId: rid, name: "Extra Cheese", price: R(20), sortOrder: 0 },
      { restaurantId: rid, name: "Butter", price: R(10), sortOrder: 1 },
      { restaurantId: rid, name: "Paneer", price: R(40), sortOrder: 2 },
      { restaurantId: rid, name: "Sauce", price: R(10), sortOrder: 3 },
    ])
    .returning();
  const addon = Object.fromEntries(ad.map((a) => [a.name, a.id]));

  const prods = await db
    .insert(products)
    .values([
      { restaurantId: rid, categoryId: cat["Coffee"], name: "Cappuccino", slug: "cappuccino", description: "Double-shot espresso with velvety steamed milk.", price: R(150), isPopular: true, variantGroupIds: [size.id], sortOrder: 0 },
      { restaurantId: rid, categoryId: cat["Cold Drinks"], name: "Cold Coffee", slug: "cold-coffee", description: "Chilled blended coffee with ice cream.", price: R(180), isPopular: true, variantGroupIds: [size.id], sortOrder: 1 },
      { restaurantId: rid, categoryId: cat["Fast Food"], name: "Veg Sandwich", slug: "veg-sandwich", description: "Grilled sandwich with fresh veggies and green chutney.", price: R(120), isRecommended: true, addonIds: [addon["Extra Cheese"], addon["Butter"], addon["Sauce"]], sortOrder: 2 },
      { restaurantId: rid, categoryId: cat["Main Course"], name: "Paneer Pizza", slug: "paneer-pizza", description: "Wood-fired base, mozzarella and tandoori paneer.", price: R(280), isPopular: true, isRecommended: true, addonIds: [addon["Extra Cheese"], addon["Paneer"]], sortOrder: 3 },
      { restaurantId: rid, categoryId: cat["Fast Food"], name: "French Fries", slug: "french-fries", description: "Crispy salted fries with a peri-peri dust.", price: R(100), addonIds: [addon["Sauce"]], sortOrder: 4 },
      { restaurantId: rid, categoryId: cat["Desserts"], name: "Brownie", slug: "brownie", description: "Warm fudge brownie with chocolate drizzle.", price: R(130), isRecommended: true, sortOrder: 5 },
    ])
    .returning();
  const pid = Object.fromEntries(prods.map((p) => [p.name, p.id]));

  const ings = await db
    .insert(ingredients)
    .values([
      { restaurantId: rid, name: "Milk", unit: "ml", currentStock: 20000, lowStockThreshold: 3000, costPerUnit: 6 },
      { restaurantId: rid, name: "Coffee Powder", unit: "g", currentStock: 2000, lowStockThreshold: 300, costPerUnit: 120 },
      { restaurantId: rid, name: "Sugar", unit: "g", currentStock: 5000, lowStockThreshold: 500, costPerUnit: 5 },
      { restaurantId: rid, name: "Cheese", unit: "g", currentStock: 3000, lowStockThreshold: 500, costPerUnit: 40 },
      { restaurantId: rid, name: "Paneer", unit: "g", currentStock: 2000, lowStockThreshold: 400, costPerUnit: 35 },
      { restaurantId: rid, name: "Bread", unit: "slice", currentStock: 100, lowStockThreshold: 20, costPerUnit: 300 },
      { restaurantId: rid, name: "Potato", unit: "g", currentStock: 8000, lowStockThreshold: 1000, costPerUnit: 3 },
    ])
    .returning();
  const ing = Object.fromEntries(ings.map((i) => [i.name, i.id]));
  await db.insert(recipes).values([
    { restaurantId: rid, productId: pid["Cappuccino"], items: [{ ingredientId: ing["Milk"], quantity: 200 }, { ingredientId: ing["Coffee Powder"], quantity: 15 }, { ingredientId: ing["Sugar"], quantity: 10 }], notes: "Pull a double shot, steam milk to 65°C." },
    { restaurantId: rid, productId: pid["Cold Coffee"], items: [{ ingredientId: ing["Milk"], quantity: 250 }, { ingredientId: ing["Coffee Powder"], quantity: 15 }, { ingredientId: ing["Sugar"], quantity: 15 }], notes: "Blend with ice until smooth." },
    { restaurantId: rid, productId: pid["Veg Sandwich"], items: [{ ingredientId: ing["Bread"], quantity: 2 }, { ingredientId: ing["Cheese"], quantity: 20 }], notes: "Grill 3 minutes each side." },
    { restaurantId: rid, productId: pid["Paneer Pizza"], items: [{ ingredientId: ing["Cheese"], quantity: 80 }, { ingredientId: ing["Paneer"], quantity: 60 }], notes: "Bake 8 minutes at 250°C." },
    { restaurantId: rid, productId: pid["French Fries"], items: [{ ingredientId: ing["Potato"], quantity: 200 }], notes: "Fry twice for crispness." },
  ]);

  const tbls = await db
    .insert(diningTables)
    .values([1, 2, 3, 4, 5].map((n) => ({ restaurantId: rid, name: `T${n}`, number: n, qrToken: randomToken(12) })))
    .returning();

  await db.insert(coupons).values([
    { restaurantId: rid, code: "WELCOME10", name: "Welcome 10%", discountType: "PERCENTAGE", discountValue: 10, maxDiscount: R(100), minOrderValue: R(200) },
    { restaurantId: rid, code: "FLAT50", name: "Flat ₹50 off", discountType: "FIXED", discountValue: R(50), minOrderValue: R(300), perCustomerLimit: 2 },
  ]);
  await db.insert(loyaltyPrograms).values({ restaurantId: rid, requiredVisits: 5, rewardTitle: "Free Cappuccino", rewardItem: "Cappuccino", isActive: true });
  await db.insert(scratchCampaigns).values({
    restaurantId: rid,
    name: "Thank-you scratch cards",
    rewards: [{ label: "Free cookie", probability: 15 }, { label: "5% off your next order", probability: 20 }, { label: "Free Cold Coffee", probability: 5 }],
    usageLimit: 0,
  });

  const custs = await db
    .insert(customers)
    .values([
      { restaurantId: rid, name: "Aarav Mehta", phone: "+919800000001", visits: 3, orders: 3, totalSpend: R(820) },
      { restaurantId: rid, name: "Isha Kapoor", phone: "+919800000002", visits: 4, orders: 4, totalSpend: R(1260) },
      { restaurantId: rid, name: "Rohan Das", phone: "+919800000003", visits: 1, orders: 1, totalSpend: R(300) },
    ])
    .returning();

  // historical orders (last 14 days) + live orders
  const catalog = prods.map((p) => ({ p, catName: cats.find((c) => c.id === p.categoryId)?.name ?? "" }));
  const mkLine = (idx: number, qty: number): OrderLine => {
    const { p, catName } = catalog[idx % catalog.length];
    return { lineId: crypto.randomUUID(), productId: p.id, name: p.name, custom: false, categoryId: p.categoryId, categoryName: catName, qty, unitPrice: p.price, variants: [], addons: [], notes: "", lineTotal: p.price * qty };
  };
  let seq = 0;
  const rows: (typeof orders.$inferInsert)[] = [];
  const pays: { idx: number; method: string }[] = [];
  const now = Date.now();
  for (let d = 13; d >= 0; d--) {
    const count = 3 + ((d * 7) % 5);
    for (let k = 0; k < count; k++) {
      seq++;
      const items = [mkLine(d + k, 1 + (k % 2)), mkLine(d + k * 2 + 1, 1)];
      const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
      const qr = k % 2 === 0;
      const t = new Date(now - d * 86400_000);
      t.setHours(9 + ((k * 3 + d) % 12), (k * 17) % 60, 0, 0);
      if (t.getTime() > now) t.setTime(now - 3600_000 * (k + 1));
      const c = custs[k % 3];
      rows.push({
        restaurantId: rid, displayId: formatOrderId("CP", seq), publicToken: randomToken(18), source: qr ? "QR" : "POS", status: "COMPLETED", paymentStatus: "SUCCESS",
        paymentMethod: k % 3 === 0 ? "CASH" : "UPI", tableId: tbls[k % 5].id, tableName: tbls[k % 5].name, customerId: k % 4 === 0 ? c.id : null, customerName: k % 4 === 0 ? c.name : "",
        customerPhone: k % 4 === 0 ? c.phone : "", items, subtotal, platformFee: qr ? 100 : 0, total: subtotal + (qr ? 100 : 0), inventoryProcessed: true, loyaltyProcessed: true,
        createdAt: t, updatedAt: t, completedAt: t,
      });
      pays.push({ idx: rows.length - 1, method: k % 3 === 0 ? "CASH" : "UPI" });
    }
  }
  const live: [string, string, number, string][] = [
    ["PLACED", "PENDING", 0, "QR"],
    ["CONFIRMED", "PENDING", 2, "POS"],
    ["PREPARING", "SUCCESS", 3, "QR"],
    ["READY", "SUCCESS", 1, "QR"],
  ];
  live.forEach(([status, pay, ti, source], i) => {
    seq++;
    const items = [mkLine(i * 2, 1 + (i % 2)), mkLine(i * 2 + 3, 1)];
    const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
    const t = new Date(now - (i + 1) * 4 * 60_000);
    rows.push({
      restaurantId: rid, displayId: formatOrderId("CP", seq), publicToken: randomToken(18), source, status, paymentStatus: pay, paymentMethod: pay === "SUCCESS" ? "UPI" : "",
      tableId: tbls[ti].id, tableName: tbls[ti].name, items, subtotal, platformFee: source === "QR" ? 100 : 0, total: subtotal + (source === "QR" ? 100 : 0), createdAt: t, updatedAt: t,
    });
    if (pay === "SUCCESS") pays.push({ idx: rows.length - 1, method: "UPI" });
  });
  const inserted = await db.insert(orders).values(rows).returning();
  await db.update(restaurants).set({ orderSeq: seq }).where(eq(restaurants.id, rid));
  await db.insert(payments).values(pays.map((p) => ({ restaurantId: rid, orderId: inserted[p.idx].id, method: p.method, status: "SUCCESS", amount: inserted[p.idx].total, createdAt: inserted[p.idx].createdAt })));
  await db.insert(bills).values(pays.map((p) => ({ restaurantId: rid, orderId: inserted[p.idx].id })));
  await db.insert(usageLedger).values(
    inserted.filter((o) => o.source === "QR").map((o) => ({ restaurantId: rid, orderId: o.id, orderDisplayId: o.displayId, amount: 100, mode: "CUSTOMER_BASED", createdAt: o.createdAt })),
  );
  return { ownerId: owner.id, restaurantId: rid };
}
