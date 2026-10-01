/**
 * Browser-safe configuration (NEXT_PUBLIC_* only). This file is the ONLY config module client code may import —
 * it contains no secret names, no server schema and no `process.env` reads other than NEXT_PUBLIC_* literals
 * (which Next.js inlines at build time). Server code should import from "@/config/env", which re-exports it.
 */

const trimmed = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const flag = (v: string | undefined) => v === "true" || v === "1";

export const publicEnv = {
  appName: trimmed(process.env.NEXT_PUBLIC_APP_NAME) ?? "CafePilot",
  appUrl: (trimmed(process.env.NEXT_PUBLIC_APP_URL) ?? "").replace(/\/$/, ""),
  supportWhatsapp: trimmed(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP) ?? "",
  mapProvider: trimmed(process.env.NEXT_PUBLIC_MAP_PROVIDER) ?? "",
  mapApiKey: trimmed(process.env.NEXT_PUBLIC_MAP_API_KEY) ?? "",
  /** UI-side hint only; storage.rules and the server enforce the real limit. */
  maxUploadMb: Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) > 0 ? Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) : 5,
  firebase: {
    apiKey: trimmed(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: trimmed(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: trimmed(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: trimmed(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: trimmed(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: trimmed(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    measurementId: trimmed(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID),
    useEmulators: flag(process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS),
    authEmulatorUrl: trimmed(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL) ?? "http://127.0.0.1:9099",
    firestoreEmulatorHost: trimmed(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST) ?? "127.0.0.1:8080",
    storageEmulatorHost: trimmed(process.env.NEXT_PUBLIC_STORAGE_EMULATOR_HOST) ?? "127.0.0.1:9199",
  },
};

/** True when every value the Firebase *client* SDK needs is present. */
export const isFirebaseClientConfigured = () => {
  const f = publicEnv.firebase;
  return Boolean(f.apiKey && f.projectId && f.appId && (f.authDomain || f.useEmulators));
};

