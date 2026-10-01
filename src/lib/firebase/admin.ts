import { getApp, getApps, initializeApp, cert, applicationDefault, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { firebaseAdminCredentials, getServerEnv, publicEnv } from "@/config/env";
import { ApiError } from "@/lib/server/http";

/**
 * Firebase Admin SDK bootstrap (server only — never import from client components).
 * Credentials come exclusively from environment variables (see src/config/env.ts).
 */

export function firebaseNotConfigured(): ApiError {
  return new ApiError(
    "Firebase is not configured on this server. Set the Firebase Admin credentials in .env (see FIREBASE_SETUP.md).",
    503,
    "FIREBASE_NOT_CONFIGURED",
  );
}

export function getAdminApp(): App {
  if (getApps().length) return getApp();
  const env = getServerEnv();
  const bucket = env.FIREBASE_STORAGE_BUCKET ?? publicEnv.firebase.storageBucket;
  const creds = firebaseAdminCredentials();
  if (creds) return initializeApp({ credential: cert(creds), projectId: creds.projectId, storageBucket: bucket });
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    return initializeApp({ projectId: publicEnv.firebase.projectId ?? "demo-cafepilot", storageBucket: bucket });
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return initializeApp({ credential: applicationDefault(), storageBucket: bucket });
  throw firebaseNotConfigured();
}

let dbOverride: Firestore | null = null;
/** Tests inject an in-memory Firestore double here. Never used in production code paths. */
export function __setAdminDbForTests(db: Firestore | null) {
  dbOverride = db;
}

let dbConfigured = false;
export function getAdminDb(): Firestore {
  if (dbOverride) return dbOverride;
  const db = getFirestore(getAdminApp());
  if (!dbConfigured) {
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      /* settings() may only be called once per instance (hot reload) */
    }
    dbConfigured = true;
  }
  return db;
}

export const getAdminAuth = (): Auth => getAuth(getAdminApp());
export const getAdminBucket = () => getStorage(getAdminApp()).bucket();
