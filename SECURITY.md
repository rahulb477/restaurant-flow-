# Security

## Tenancy and roles
- Tenant = `restaurants/{rid}` path. The caller's restaurant and role are read from `restaurants/{rid}/members/{uid}` (status `ACTIVE`) — never from a request body, query string, cookie value or token claim. A `DISABLED` or missing member gets nothing (`NO_WORKSPACE`).
- Roles: OWNER, MANAGER, CASHIER, KITCHEN, STAFF. The matrix in `src/lib/permissions.ts` is enforced in every API route (`requireCtx(module)`) and mirrored by Firestore/Storage rules. Unknown roles (including `__proto__`/`constructor`) get no modules.
- Only OWNER manages staff, usage/settlements and settings. Invitations can only grant MANAGER/CASHIER/KITCHEN/STAFF; the role is stored server-side and applied on acceptance. STAFF cannot be granted `manualDiscount`.

## Firestore rules (`firestore.rules`)
- Default deny. **No client writes anywhere**, which makes forging payment status, usage balance, platform-fee rows, inventory history, loyalty/scratch rewards, `role`, `restaurantId`, `ownerId` or staff records impossible from the client.
- Reads require an active membership plus the role group for that collection (e.g. payments: OWNER/MANAGER/CASHIER; usage, settlements, activity logs, invitations: OWNER; ingredients/customers/coupons/rewards: OWNER/MANAGER; kitchen tickets: OWNER/MANAGER/KITCHEN).
- Customers are anonymous: they can `get` exactly one `publicOrders/{token}` (unguessable 144-bit token, never listable) and nothing else. Slugs and QR tokens are resolved server-side.
- Checked by `tests/rules-lint.test.ts` (static, always runs) and `tests/rules/*.test.ts` (behavioural, emulator).

## Storage rules (`storage.rules`)
Signed-in + active member of **that** restaurant + allowed role + PNG/JPEG/WebP + ≤ 5 MB. Logo: OWNER only. Menu/product/scratch images: OWNER/MANAGER and public-read (shown to customers). QR: members read. Invoices: server-written, billing roles read. Everything else denied.

## Server trust
- Prices, variants, add-ons, discounts, tax, fees, totals, payment status, inventory, loyalty and scratch rewards are computed server-side from stored data. Custom items and manual discounts are staff-only; QR orders cannot use them.
- Idempotency: orders (key → deterministic id), inventory deduction, usage ledger row, coupon redemption, loyalty milestone, scratch card, review, bill.
- Payments: a UPI QR/link never marks an order paid — staff confirm receipt. Online webhooks require a valid HMAC (timing-safe) **and** an exact-amount match; a payment for an already-paid order is flagged for refund rather than applied twice. Settlement confirmation via `/api/admin/settlements/{id}` requires `PLATFORM_ADMIN_SECRET`.
- Sessions: Firebase ID token → httpOnly, `SameSite=Lax`, `Secure` (in production) `__session` cookie, requires a sign-in in the last 5 minutes, verified with revocation checks. Password changes are logged. No password or hash is ever stored in Firestore.
- Rate limits on session, invitations, public ordering/quotes/payments (in-memory, per instance — use a shared store when running multiple instances).

## Secrets
- Server-only values (Admin credentials, payment secret + webhook secret, AI/email keys, `PLATFORM_ADMIN_SECRET`, `ENCRYPTION_SECRET`) are read only in `src/config/env.ts`. Client code may import only `src/config/public-env.ts` (ESLint `no-restricted-imports`). The production bundle was grepped for these names: only the UI label "AI_API_KEY" (instructions text) appears — no values.
- `.env`, `.env.local`, `service-account*.json`, `*.pem`, `*.key` are git-ignored. The audit log removes keys matching `password|secret|token|hash|key|credential`.

## Privacy
Geofence coordinates are used for a single distance check and are not stored or logged. Customer pages never receive owner ids, restaurant coordinates or other customers' data.

## Known limits
Verified against an in-memory Firestore double and static rule checks; the behavioural rules tests need the emulator (Java). Run `npm run test:rules` before first production deploy.
