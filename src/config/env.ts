import { z } from "zod";

/**
 * Centralised environment configuration — the ONLY place `process.env` is read for app config.
 *
 *  - `publicEnv`  : browser-safe values (NEXT_PUBLIC_*), defined in ./public-env.ts and re-exported here. Client
 *                   code imports ONLY "@/config/public-env" so the secret schema below never ships to the browser.
 *  - `serverEnv`  : server-only secrets (Firebase Admin key, payment/AI/email secrets...). Lazy: reading a key
 *                   validates the whole schema. NEVER import `serverEnv` from a client component and never
 *                   prefix a secret with NEXT_PUBLIC_.
 *  - `integrations`: cheap "is this configured?" flags so the UI can show an honest "not configured" state.
 */

import { publicEnv, isFirebaseClientConfigured } from "./public-env";

export { publicEnv, isFirebaseClientConfigured };

/* ------------------------------ server (secrets) ------------------------------ */
const trimmed = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : def));

const opt = z.string().optional().transform(trimmed);

const serverSchema = z.object({
  NODE_ENV: z.string().default("development"),

  /* Firebase Admin — accept several common naming conventions so an existing .env keeps working */
  FIREBASE_PROJECT_ID: opt,
  FIREBASE_ADMIN_PROJECT_ID: opt,
  FIREBASE_CLIENT_EMAIL: opt,
  FIREBASE_ADMIN_CLIENT_EMAIL: opt,
  FIREBASE_PRIVATE_KEY: opt,
  FIREBASE_ADMIN_PRIVATE_KEY: opt,
  /** Whole service-account JSON (raw or base64). */
  FIREBASE_SERVICE_ACCOUNT_JSON: opt,
  FIREBASE_SERVICE_ACCOUNT_BASE64: opt,
  FIREBASE_STORAGE_BUCKET: opt,
  GOOGLE_APPLICATION_CREDENTIALS: opt,

  /* Session */
  SESSION_COOKIE_DAYS: int(5),

  /* AI (OpenAI-compatible chat completions API) */
  AI_API_KEY: opt,
  AI_MODEL: opt,
  AI_BASE_URL: opt,
  /* Email (Resend-compatible REST API) */
  EMAIL_API_KEY: opt,
  EMAIL_FROM: opt,
  EMAIL_API_URL: opt,
  /* Payments (provider chosen by PAYMENT_PROVIDER, e.g. "razorpay") */
  PAYMENT_PROVIDER: opt,
  PAYMENT_KEY_ID: opt,
  PAYMENT_SECRET_KEY: opt,
  PAYMENT_WEBHOOK_SECRET: opt,
  PLATFORM_UPI_ID: opt,
  PLATFORM_ADMIN_SECRET: opt,
  /* Fees & limits (platform level). Restaurant fee MODE lives in Firestore. */
  PLATFORM_FEE_MINOR: int(100),
  SETTLEMENT_THRESHOLD_MINOR: int(50000),
  MAX_UPLOAD_MB: int(5),
  ORDER_ID_PREFIX: opt,
  ENCRYPTION_SECRET: opt,
  SENTRY_DSN: opt,
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names + messages are reported — never values.
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}
/** Test helper: forget the memoised env after mutating process.env. */
export const resetServerEnvCache = () => {
  cached = null;
};

/** Lazy proxy so importing never throws during bundling; access validates. */
export const serverEnv = new Proxy({} as ServerEnv, {
  get: (_t, key: string) => getServerEnv()[key as keyof ServerEnv],
});

/** Normalised Firebase Admin credentials (or null when none are configured). */
export function firebaseAdminCredentials(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const e = getServerEnv();
  const json = e.FIREBASE_SERVICE_ACCOUNT_JSON ?? (e.FIREBASE_SERVICE_ACCOUNT_BASE64 ? Buffer.from(e.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8") : undefined);
  if (json) {
    try {
      const j = JSON.parse(json) as { project_id?: string; client_email?: string; private_key?: string };
      if (j.project_id && j.client_email && j.private_key) return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
    } catch {
      /* fall through to discrete variables */
    }
  }
  const projectId = e.FIREBASE_ADMIN_PROJECT_ID ?? e.FIREBASE_PROJECT_ID ?? publicEnv.firebase.projectId;
  const clientEmail = e.FIREBASE_ADMIN_CLIENT_EMAIL ?? e.FIREBASE_CLIENT_EMAIL;
  const rawKey = e.FIREBASE_ADMIN_PRIVATE_KEY ?? e.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !rawKey) return null;
  // .env files commonly store the key with literal "\n" sequences and optional wrapping quotes.
  const privateKey = rawKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

const usingEmulator = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST);

export const integrations = {
  /** Firebase Admin usable (service account, ADC file, or local emulator). */
  firebaseAdmin: () => {
    if (usingEmulator()) return true;
    try {
      return Boolean(firebaseAdminCredentials() || getServerEnv().GOOGLE_APPLICATION_CREDENTIALS);
    } catch {
      return false;
    }
  },
  firebaseClient: isFirebaseClientConfigured,
  ai: () => Boolean(serverEnv.AI_API_KEY && serverEnv.AI_MODEL),
  email: () => Boolean(serverEnv.EMAIL_API_KEY && serverEnv.EMAIL_FROM),
  onlinePayments: () => Boolean(serverEnv.PAYMENT_PROVIDER && serverEnv.PAYMENT_SECRET_KEY && serverEnv.PAYMENT_KEY_ID),
  platformUpi: () => Boolean(serverEnv.PLATFORM_UPI_ID),
  admin: () => Boolean(serverEnv.PLATFORM_ADMIN_SECRET),
};

export const isProd = () => process.env.NODE_ENV === "production";
