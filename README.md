# CafePilot — Cafe & Restaurant Management SaaS

QR table ordering · staff POS · live kitchen display (KDS) · inventory & recipes · billing · coupons · loyalty · scratch cards · Google review assistant · analytics · usage billing. Multi-tenant, role-based, mobile-first for customers.

**Backend: Firebase** — Firebase Authentication, Cloud Firestore and Cloud Storage. There is no SQL database and no ORM in this project. Trusted logic (order totals, platform fee, usage ledger, inventory, rewards, payment webhooks, staff invitations) runs in Next.js API routes through the Firebase Admin SDK; Firestore security rules deny every client write.

| Doc | What it covers |
|---|---|
| [FIREBASE_SETUP.md](FIREBASE_SETUP.md) | Create the Firebase project, configure `.env`, deploy rules, emulators |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, repositories, order flow, realtime |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Firestore collections, ids, access matrix |
| [SECURITY.md](SECURITY.md) | Threat model, rules, secrets |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production checklist |

## Quick start
```bash
npm install
cp .env.example .env      # fill in Firebase web + Admin values (see FIREBASE_SETUP.md). Never commit .env
npm run firebase:deploy:rules   # firestore.rules, firestore.indexes.json, storage.rules
npm run dev               # http://localhost:3000
```
Quality gates: `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`.
With Java installed, `npm run emulators` starts Auth/Firestore/Storage locally and `npm run test:rules` runs the security-rules tests.

Without Firebase credentials the app still builds and starts; pages and APIs that need Firebase respond with an explicit *"Firebase is not configured"* state instead of failing silently or faking data.

## Configuration
Everything is read through `src/config/env.ts` (server) and `src/config/public-env.ts` (browser). Only `NEXT_PUBLIC_*` values can reach client code (enforced by an ESLint `no-restricted-imports` rule). `.env.example` lists every variable.

| Group | Variables |
|---|---|
| Firebase web (public) | `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID` |
| Firebase Admin (secret) | `FIREBASE_SERVICE_ACCOUNT_JSON` / `_BASE64`, or `FIREBASE_ADMIN_PROJECT_ID` + `FIREBASE_ADMIN_CLIENT_EMAIL` + `FIREBASE_ADMIN_PRIVATE_KEY` (aliases `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`), or `GOOGLE_APPLICATION_CREDENTIALS` |
| Platform fee & usage | `PLATFORM_FEE_MINOR` (100 = ₹1), `SETTLEMENT_THRESHOLD_MINOR` (50000), `PLATFORM_UPI_ID`, `PLATFORM_ADMIN_SECRET` |
| Online payments (optional) | `PAYMENT_PROVIDER` (`razorpay` adapter included), `PAYMENT_KEY_ID`, `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET` |
| AI menu digitization (optional) | `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` |
| Email (optional) | `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_API_URL` |
| Misc | `SESSION_COOKIE_DAYS`, `MAX_UPLOAD_MB`, `ORDER_ID_PREFIX`, `ENCRYPTION_SECRET`, `NEXT_PUBLIC_APP_URL` |

The platform fee amount and settlement threshold come from the environment, never from code or tenant data. Each restaurant's fee **mode** (`CUSTOMER_BASED` / `STORE_BASED`), UPI ID, geofence, tax and payment toggles live in its Firestore `settings`.

## Feature map
Owner dashboard `/dashboard` (metrics, charts, alerts) · `/pos` · `/orders` · `/bills` · `/kds` · `/menu` (categories, products, variants, add-ons, AI digitization) · `/inventory` (ingredients, recipes, history) · `/tables` (+ QR preview/download/print) · `/promotions` · `/loyalty` · `/scratch-cards` · `/reviews` · `/staff` · `/analytics` · `/usage` · `/settings`.
Customer: `/order/{slug}` and `/order/{slug}/table/{qrToken}` → cart → `/track/{token}` (live status, UPI QR / online pay, loyalty, scratch card, review assistant).

Roles: `OWNER`, `MANAGER`, `CASHIER`, `KITCHEN`, `STAFF` — resolved from the Firestore membership document, never from client input.

## Tests
`npm test` runs 136 tests (plus 11 emulator-only rules tests that are skipped unless the emulator is running): pricing, variants, add-ons, coupons (including redemption races), platform fee modes, usage ledger and settlement, order state machine, inventory deduction and idempotency, loyalty, scratch cards, geofence, UPI URI, QR tokens, payments and webhook signatures, auth/session/invitations, tenant isolation, role matrix, env parsing, and static checks of both rules files.

Service-level tests run against an in-memory Firestore double (`tests/helpers/memory-firestore.ts`) that implements optimistic-concurrency transactions, so they exercise the real repositories and services. They do not replace emulator or live-project verification of the security rules.
