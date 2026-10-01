"use client";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { isFirebaseClientConfigured, publicEnv } from "@/config/public-env";

/** Firebase *client* SDK bootstrap. Only public (NEXT_PUBLIC_*) configuration is used here. */

export class FirebaseClientNotConfigured extends Error {
  constructor() {
    super("Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* variables in .env.");
  }
}

export const firebaseReady = () => isFirebaseClientConfigured();

let app: FirebaseApp | null = null;
let emulatorsWired = false;

export function getClientApp(): FirebaseApp {
  if (app) return app;
  if (!isFirebaseClientConfigured()) throw new FirebaseClientNotConfigured();
  const f = publicEnv.firebase;
  app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: f.apiKey,
        authDomain: f.authDomain,
        projectId: f.projectId,
        storageBucket: f.storageBucket,
        messagingSenderId: f.messagingSenderId,
        appId: f.appId,
        measurementId: f.measurementId,
      });
  return app;
}

function wireEmulators(auth: Auth, db: Firestore, storage: FirebaseStorage) {
  if (emulatorsWired || !publicEnv.firebase.useEmulators) return;
  emulatorsWired = true;
  const f = publicEnv.firebase;
  connectAuthEmulator(auth, f.authEmulatorUrl, { disableWarnings: true });
  const [fh, fp] = f.firestoreEmulatorHost.split(":");
  connectFirestoreEmulator(db, fh, Number(fp));
  const [sh, sp] = f.storageEmulatorHost.split(":");
  connectStorageEmulator(storage, sh, Number(sp));
}

let cached: { auth: Auth; db: Firestore; storage: FirebaseStorage } | null = null;
function services() {
  if (cached) return cached;
  const a = getClientApp();
  const auth = getAuth(a);
  const db = getFirestore(a);
  const storage = getStorage(a);
  wireEmulators(auth, db, storage);
  cached = { auth, db, storage };
  return cached;
}

export const getClientAuth = () => services().auth;
export const getClientDb = () => services().db;
export const getClientStorage = () => services().storage;
