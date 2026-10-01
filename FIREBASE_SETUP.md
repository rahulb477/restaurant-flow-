# Firebase setup

## 1. Create the project
1. [Firebase console](https://console.firebase.google.com) → create a project (or reuse yours).
2. **Authentication** → Sign-in method → enable **Email/Password**. Under *Settings → Authorized domains* add your production domain.
3. **Firestore Database** → create in production mode (rules are deployed below).
4. **Storage** → get started (same location as Firestore).
5. **Project settings → Your apps** → add a Web app; copy the config into the `NEXT_PUBLIC_FIREBASE_*` variables.
6. **Project settings → Service accounts** → *Generate new private key*. Put it in `.env` (never in source, never committed):
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (minified JSON) **or** `FIREBASE_SERVICE_ACCOUNT_BASE64`, **or**
   - `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` (keep `\n` escapes, wrap in double quotes). The aliases `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` are accepted too.
   - On Google Cloud hosts you can rely on Application Default Credentials instead.

`.env` is git-ignored; this repo only ships `.env.example`.

## 2. Deploy rules and indexes
```bash
npx firebase-tools login
npx firebase-tools use <your-project-id>
npm run firebase:deploy:rules      # firestore.rules + firestore.indexes.json + storage.rules
```
`firestore.indexes.json` is intentionally empty: every query is single-field or equality-plus-one-range.

**Storage rules read Firestore** (membership lookup). The first time you deploy Storage rules that call `firestore.get`, Firebase asks you to let the Cloud Storage service agent (`service-<PROJECT_NUMBER>@gcp-sa-firebasestorage.iam.gserviceaccount.com`) read Firestore — accept the prompt, or grant that account the *Firebase Rules Firestore Service Agent* role (`roles/firebaserules.firestoreServiceAgent`). Without it, uploads are denied.

The 5 MB limit in `storage.rules` cannot read env vars; keep it in sync with `MAX_UPLOAD_MB` / `NEXT_PUBLIC_MAX_UPLOAD_MB`.

## 3. Optional integrations
Email, AI and online payments are off until configured. Each shows an explicit "not configured" state in the UI. For online payments set `PAYMENT_PROVIDER`, `PAYMENT_KEY_ID`, `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET` and point the provider webhook at `{NEXT_PUBLIC_APP_URL}/api/payments/webhook` (event `payment_link.paid`, `…cancelled`, `…expired` for the Razorpay adapter).

## 4. Local development with the Emulator Suite
Requires Java 21+.
```bash
npm run emulators                       # Auth :9099, Firestore :8080, Storage :9199, UI :4000
# .env.local
NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
npm run dev
npm run test:rules                      # behavioural rules tests (emulators:exec)
```

## 5. First run
Open `/signup`, create an account, verify the e-mail, and complete onboarding. That creates `restaurants/{id}`, your `OWNER` member document, the slug reservation and the counters document in one transaction. Nothing is seeded automatically.

## Cloud Functions
None are required. All trusted operations run in the Next.js API routes with the Admin SDK (see `src/lib/firebase/functions.ts`). The service layer is framework-free, so scheduled jobs could be added as Functions later without duplicating logic.
