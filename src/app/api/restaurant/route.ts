import { z } from "zod";
import { api, ApiError, readJson } from "@/lib/server/http";
import { requireCtx, requireUser, getCtx } from "@/lib/server/auth";
import { repos } from "@/lib/repositories";
import { resolveSettings } from "@/lib/server/services/orders";
import { publicRestaurant } from "@/lib/server/services/restaurant";
import { logActivity } from "@/lib/server/audit";
import { integrations, publicEnv, serverEnv } from "@/config/env";
import { deepMerge, slugify } from "@/lib/calculations";
import { randomToken } from "@/lib/server/auth";

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const settingsPatch = z
  .object({
    paymentTiming: z.enum(["PAY_FIRST", "PAY_AT_END"]),
    customerOrdering: z.boolean(),
    tableOrdering: z.boolean(),
    payments: z.object({ cash: z.boolean(), upi: z.boolean(), online: z.boolean(), upiId: z.string().trim().max(80).regex(/^$|^[\w.\-]{2,}@[\w.\-]{2,}$/, "Enter a valid UPI ID like name@bank"), upiName: z.string().trim().max(80) }).partial(),
    fees: z.object({ mode: z.enum(["CUSTOMER_BASED", "STORE_BASED"]), blockOnThreshold: z.boolean() }).partial(),
    tax: z.object({ enabled: z.boolean(), name: z.string().trim().max(20), ratePct: z.number().min(0).max(100), mode: z.enum(["EXCLUSIVE", "INCLUSIVE"]) }).partial(),
    geofence: z.object({ enabled: z.boolean(), latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(), radiusMeters: z.number().min(10).max(5000) }).partial(),
    googleReviewUrl: z.string().trim().max(500).regex(/^$|^https?:\/\//, "Enter a full URL starting with https://"),
    whatsapp: z.string().trim().max(20).regex(/^[\d+ ]*$/, "Digits only"),
    orderPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "1-6 letters or numbers"),
    inventoryDeductOn: z.enum(["CONFIRMED", "PREPARING", "COMPLETED"]),
    allowNegativeStock: z.boolean(),
    invoiceFooter: z.string().max(200),
  })
  .partial();

const patch = z
  .object({
    name: z.string().trim().min(1).max(80),
    businessType: z.enum(["CAFE", "RESTAURANT", "HOTEL", "CLOUD_KITCHEN", "OTHER"]),
    phone: z.string().trim().max(30),
    email: z.union([z.string().trim().email(), z.literal("")]),
    address: z.string().trim().max(200),
    city: z.string().trim().max(80),
    state: z.string().trim().max(80),
    country: z.string().trim().max(80),
    pincode: z.string().trim().max(12),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    logoUrl: z.string().max(500),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    currency: z.string().trim().toUpperCase().length(3),
    timezone: z.string().refine(validTz, "Unknown timezone"),
    onboardingStep: z.number().int().min(1).max(7),
    onboardingDone: z.boolean(),
    settings: settingsPatch,
  })
  .partial();

export const GET = api(async () => {
  const ctx = await requireCtx();
  return {
    restaurant: publicRestaurant(ctx.restaurant),
    role: ctx.role,
    integrations: {
      email: integrations.email(),
      ai: integrations.ai(),
      onlinePayments: integrations.onlinePayments(),
      platformUpi: integrations.platformUpi(),
      maxUploadMb: serverEnv.MAX_UPLOAD_MB,
      platformFeeMinor: serverEnv.PLATFORM_FEE_MINOR,
      thresholdMinor: serverEnv.SETTLEMENT_THRESHOLD_MINOR,
      supportWhatsapp: publicEnv.supportWhatsapp,
    },
  };
});

export const POST = api(async (req) => {
  const user = await requireUser();
  if (await getCtx()) throw new ApiError("You already have a workspace.", 409, "EXISTS");
  const body = z.object({ name: z.string().trim().min(1, "Enter your business name").max(80), businessType: z.enum(["CAFE", "RESTAURANT", "HOTEL", "CLOUD_KITCHEN", "OTHER"]).default("CAFE") }).parse(await readJson(req));
  const R = repos();
  let slug = slugify(body.name);
  if (await R.restaurants.slugExists(slug)) slug = `${slug}-${randomToken(2)}`;
  const r = await R.restaurants.createWithOwner({
    slug,
    owner: { id: user.id, email: user.email, name: user.name },
    data: {
      name: body.name, businessType: body.businessType, phone: "", email: user.email, address: "", city: "", state: "", country: "India", pincode: "",
      latitude: null, longitude: null, logoUrl: "", accent: "#f59e0b", currency: "INR", timezone: "Asia/Kolkata", settings: {}, loyaltyProgram: null,
      onboardingStep: 2, onboardingDone: false,
    },
  });
  return { restaurant: publicRestaurant(r) };
});

export const PATCH = api(async (req) => {
  const ctx = await requireCtx("settings");
  const v = patch.parse(await readJson(req));
  const before = ctx.restaurant;
  const { settings: sPatch, ...profile } = v;
  const beforeSettings = resolveSettings(before.settings);
  let nextRaw = before.settings;
  if (sPatch) nextRaw = deepMerge((before.settings ?? {}) as Record<string, unknown>, sPatch);
  const update = { ...profile, ...(sPatch ? { settings: nextRaw } : {}) };
  await repos().restaurants.update(ctx.restaurantId, update as never);
  const after = { ...before, ...update, updatedAt: new Date() };
  const afterSettings = resolveSettings(after.settings);
  if (sPatch?.payments?.upiId !== undefined && beforeSettings.payments.upiId !== afterSettings.payments.upiId) {
    await logActivity(ctx, "settings.upi_changed", "settings", ctx.restaurantId, { upiId: beforeSettings.payments.upiId }, { upiId: afterSettings.payments.upiId });
  }
  if (sPatch?.fees?.mode && beforeSettings.fees.mode !== afterSettings.fees.mode) {
    await logActivity(ctx, "settings.fee_mode_changed", "settings", ctx.restaurantId, { mode: beforeSettings.fees.mode }, { mode: afterSettings.fees.mode });
  }
  if (Object.keys(profile).some((k) => !k.startsWith("onboarding")) || sPatch) {
    await logActivity(ctx, "settings.updated", "settings", ctx.restaurantId, { profile: pickKeys(before as unknown as Record<string, unknown>, Object.keys(profile)), settings: sPatch ? beforeSettings : undefined }, { profile, settings: sPatch ? afterSettings : undefined });
  }
  return { restaurant: publicRestaurant(after) };
});

function pickKeys(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
