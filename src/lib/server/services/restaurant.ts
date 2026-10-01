import type { Restaurant } from "@/lib/repositories";
import { resolveSettings } from "./orders";

/** Tenant-member projection of a restaurant: resolved settings, platform fee values enforced from env. */
export function publicRestaurant(r: Restaurant) {
  const { settings, ...rest } = r;
  return { ...rest, settings: resolveSettings(settings) };
}

/** Customer-safe projection of a restaurant (no owner ids, no coordinates). */
export function customerRestaurant(r: Restaurant) {
  const s = resolveSettings(r.settings);
  return {
    name: r.name,
    slug: r.slug,
    logoUrl: r.logoUrl,
    accent: r.accent,
    currency: r.currency,
    phone: r.phone,
    address: [r.address, r.city].filter(Boolean).join(", "),
    googleReviewUrl: s.googleReviewUrl,
    settings: {
      paymentTiming: s.paymentTiming,
      customerOrdering: s.customerOrdering,
      tableOrdering: s.tableOrdering,
      payments: { cash: s.payments.cash, upi: s.payments.upi && !!s.payments.upiId },
      fees: { mode: s.fees.mode, amountMinor: s.fees.mode === "CUSTOMER_BASED" ? s.fees.amountMinor : 0 },
      tax: s.tax,
      geofence: { enabled: s.geofence.enabled, radiusMeters: s.geofence.radiusMeters },
    },
  };
}
