# CafePilot — Cafe & Restaurant Management SaaS

QR table ordering · staff POS · live kitchen display (KDS) · inventory & recipes · billing · coupons · loyalty · scratch cards · Google review assistant · analytics · usage billing. Multi-tenant, role-based, mobile-first for customers.

> **Backend note.** The master spec names Firebase as the backend. The sandbox this was built in provides **PostgreSQL + Drizzle ORM** and its `.env` contained only `DATABASE_URL` (no Firebase credentials), so the production backend here is Postgres. All domain logic lives behind service functions in `src/lib/server/services`, tenant isolation is enforced server-side, and `FIREBASE_SETUP.md` explains how to port the data layer to Firestore. Nothing is faked: missing providers (email, AI, online payments) show an explicit "not configured" state.

## Quick start
```bash
npm install
cp .env.example .env        # keep any values you already have; DATABASE_URL is required
npx drizzle-kit push --config drizzle.config.json
npm run dev                 # http://localhost:3000
npx vitest run              # business-logic tests
npm run build && npm start  # production
```

## Modes
- **Demo mode** — set `NEXT_PUBLIC_DEMO_MODE=true`: `/login` shows **Use Demo workspace**, which creates/logs into a seeded "CafePilot Demo Cafe" (6 products, tables T1–T5, ingredients, recipes, coupons, loyalty, scratch campaign, 14 days of orders). There is no backdoor when the flag is `false`/unset (the endpoint returns 403).
- **Production mode** — flag off. Real signup → onboarding → empty workspace. Nothing is seeded automatically.

## Configuration (all via environment, validated in `src/config/env.ts`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **Required.** Postgres connection |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_WHATSAPP` | Branding / absolute links / support link |
| `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_API_URL` | Resend-compatible email (invoices, invites, verify, reset) |
| `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | OpenAI-compatible API for menu digitization & review drafts |
| `PAYMENT_PROVIDER`, `PAYMENT_KEY_ID`, `PAYMENT_SECRET_KEY` | Online provider (Razorpay-compatible server adapter) |
| `PLATFORM_UPI_ID`, `PLATFORM_ADMIN_SECRET` | Where owners pay settlements / endpoint secret to confirm them |
| `PLATFORM_FEE_MINOR` (100), `SETTLEMENT_THRESHOLD_MINOR` (50000), `MAX_UPLOAD_MB` (5), `ORDER_ID_PREFIX` (CP) | Platform fee (₹1), threshold, upload limit, order-ID prefix |

Restaurant-specific UPI IDs are stored in the database per restaurant — never in `.env`.

## Feature map
Owner dashboard `/dashboard` (metrics, charts, alerts) · `/pos` · `/orders` · `/bills` · `/kds` · `/menu` (categories, products, variants, add-ons, AI digitization) · `/inventory` (ingredients, recipes, history) · `/tables` (+QR print sheet) · `/promotions` · `/loyalty` · `/scratch-cards` · `/reviews` · `/staff` · `/analytics` · `/usage` · `/settings`.
Customer: `/order/{slug}` and `/order/{slug}/table/{qrToken}` → cart → `/track/{token}` (live status, UPI QR, loyalty, scratch card, review assistant).

## Testing
`npx vitest run` covers pricing (variants/add-ons/coupon/fee/tax), order & payment state machines, geofence, inventory deduction + idempotency, loyalty, scratch probabilities, UPI URI, order IDs and the role/permission matrix.
