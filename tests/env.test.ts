import { afterEach, describe, expect, it } from "vitest";
import { firebaseAdminCredentials, getServerEnv, integrations, resetServerEnvCache, serverEnv } from "@/config/env";

const KEYS = ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_BASE64", "FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY", "PLATFORM_FEE_MINOR", "SETTLEMENT_THRESHOLD_MINOR", "PAYMENT_PROVIDER", "PAYMENT_KEY_ID", "PAYMENT_SECRET_KEY", "AI_API_KEY"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const clear = () => KEYS.forEach((k) => delete process.env[k]);
afterEach(() => {
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  resetServerEnvCache();
});

describe("centralized env", () => {
  it("fee and threshold come from env with safe defaults", () => {
    clear(); resetServerEnvCache();
    expect(serverEnv.PLATFORM_FEE_MINOR).toBe(100);
    expect(serverEnv.SETTLEMENT_THRESHOLD_MINOR).toBe(50000);
    process.env.PLATFORM_FEE_MINOR = "250"; resetServerEnvCache();
    expect(serverEnv.PLATFORM_FEE_MINOR).toBe(250);
  });
  it("no credentials → null; integrations report not configured", () => {
    clear(); resetServerEnvCache();
    expect(firebaseAdminCredentials()).toBeNull();
    expect(integrations.onlinePayments()).toBe(false);
    expect(integrations.ai?.()).toBeFalsy();
  });
  it("accepts discrete variables and aliases, restoring escaped newlines and stripping quotes", () => {
    clear();
    process.env.FIREBASE_PROJECT_ID = "demo-proj";
    process.env.FIREBASE_CLIENT_EMAIL = "svc@demo-proj.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = '"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n"';
    resetServerEnvCache();
    expect(firebaseAdminCredentials()).toEqual({ projectId: "demo-proj", clientEmail: "svc@demo-proj.iam.gserviceaccount.com", privateKey: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n" });
  });
  it("accepts a service-account JSON or base64 blob", () => {
    clear();
    const j = { project_id: "p1", client_email: "e@p1.iam", private_key: "KEY" };
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from(JSON.stringify(j)).toString("base64");
    resetServerEnvCache();
    expect(firebaseAdminCredentials()).toEqual({ projectId: "p1", clientEmail: "e@p1.iam", privateKey: "KEY" });
    delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(j);
    resetServerEnvCache();
    expect(firebaseAdminCredentials()?.projectId).toBe("p1");
  });
  it("online payments need provider + key id + secret", () => {
    clear(); process.env.PAYMENT_PROVIDER = "razorpay"; process.env.PAYMENT_KEY_ID = "k"; resetServerEnvCache();
    expect(integrations.onlinePayments()).toBe(false);
    process.env.PAYMENT_SECRET_KEY = "s"; resetServerEnvCache();
    expect(integrations.onlinePayments()).toBe(true);
    expect(getServerEnv().PAYMENT_PROVIDER).toBe("razorpay");
  });
});
