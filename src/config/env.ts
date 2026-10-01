import { z } from "zod";

/**
 * Centralised environment configuration.
 * - `publicEnv`  : safe for the browser (NEXT_PUBLIC_*). Literal access so Next can inline them.
 * - `serverEnv`  : server only. Never import `serverEnv` from a client component.
 * - Optional integrations expose `isConfigured` helpers instead of throwing.
 */

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const publicSchema = z.object({
  appName: z.string().min(1).default("CafePilot"),
  appUrl: z.string().default(""),
  demoMode: bool,
  supportWhatsapp: z.string().default(""),
  mapProvider: z.string().default(""),
  mapApiKey: z.string().default(""),
});

export const publicEnv = publicSchema.parse({
  appName: process.env.NEXT_PUBLIC_APP_NAME || undefined,
  appUrl: process.env.NEXT_PUBLIC_APP_URL || undefined,
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE,
  supportWhatsapp: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || undefined,
  mapProvider: process.env.NEXT_PUBLIC_MAP_PROVIDER || undefined,
  mapApiKey: process.env.NEXT_PUBLIC_MAP_API_KEY || undefined,
});

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && !Number.isNaN(Number(v)) ? Number(v) : def));

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z.string().default("development"),
  // AI (OpenAI-compatible chat completions API)
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  // Email (Resend-compatible REST API)
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_API_URL: z.string().optional(),
  // Payments
  PAYMENT_PROVIDER: z.string().optional(),
  PAYMENT_KEY_ID: z.string().optional(),
  PAYMENT_SECRET_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  PLATFORM_UPI_ID: z.string().optional(),
  PLATFORM_ADMIN_SECRET: z.string().optional(),
  // Fees & limits
  PLATFORM_FEE_MINOR: int(100),
  SETTLEMENT_THRESHOLD_MINOR: int(50000),
  MAX_UPLOAD_MB: int(5),
  ORDER_ID_PREFIX: z.string().optional(),
  // Monitoring
  SENTRY_DSN: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** Lazy proxy so importing never throws during bundling; access validates. */
export const serverEnv = new Proxy({} as ServerEnv, {
  get: (_t, key: string) => getServerEnv()[key as keyof ServerEnv],
});

export const integrations = {
  ai: () => Boolean(serverEnv.AI_API_KEY && serverEnv.AI_MODEL),
  email: () => Boolean(serverEnv.EMAIL_API_KEY && serverEnv.EMAIL_FROM),
  onlinePayments: () => Boolean(serverEnv.PAYMENT_PROVIDER && serverEnv.PAYMENT_SECRET_KEY && serverEnv.PAYMENT_KEY_ID),
  platformUpi: () => Boolean(serverEnv.PLATFORM_UPI_ID),
  admin: () => Boolean(serverEnv.PLATFORM_ADMIN_SECRET),
};

export const isProd = () => process.env.NODE_ENV === "production";
