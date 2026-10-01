import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Flat config export that runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  {
    // Logos / product photos are tenant-uploaded Firebase Storage URLs of arbitrary size and origin, so next/image
    // optimisation (which needs a fixed remote allow-list) is intentionally not used for them.
    rules: { "@next/next/no-img-element": "off" },
  },
  {
    // Secrets must never reach the browser bundle: client-side code may not import the server config or server modules.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/client/**/*.{ts,tsx}", "src/lib/firebase/{client,auth,storage,realtime,functions}.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@/config/env", "**/config/env"], message: "Client code must import @/config/public-env, never the server config." },
        { group: ["@/lib/server/*", "@/lib/repositories", "@/lib/repositories/*", "@/lib/firebase/admin", "firebase-admin", "firebase-admin/*"], message: "Server-only module." },
      ] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
