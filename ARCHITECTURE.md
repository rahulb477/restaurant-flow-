# Architecture

**Next.js 16 App Router (React 19, Tailwind 4) on Firebase** (Auth + Firestore + Storage). One deployable: the Next.js app.

## Layers
```
UI (src/app, src/components)            no Firestore logic — only hooks and fetch helpers
  ├─ src/lib/client/api.tsx             fetch + toasts for mutations
  └─ src/lib/client/realtime.ts         live hooks (Firestore listeners, always unsubscribed)
API routes (src/app/api/**)             zod validation → requireCtx(module) → service
Services (src/lib/server/services/**)   orders, payments, usage, crud, analytics, invoice, staff
Repositories (src/lib/repositories)     interfaces.ts + firebase/{base,root,tenant}.ts (Admin SDK)
Firebase helpers (src/lib/firebase)     admin, client, auth, firestore (codec), storage, functions, realtime
Pure rules (src/lib/calculations)       money, pricing, coupons, fees, tax, state machines, geofence, inventory, loyalty, scratch, UPI
Config (src/config)                     env.ts (server, zod), public-env.ts (NEXT_PUBLIC_* only)
```
Repository interfaces cover Restaurant, User, Membership, Category, Product, Variant, Addon, Ingredient, Recipe, Table, Order, Payment, Bill, Coupon, Loyalty, ScratchCard, Staff, Usage, Settlement, Review, ActivityLog and Analytics (analytics aggregates real order/payment/usage documents). Services never touch Firestore directly.

## Trust model
- Browsers **read** (listeners, permitted by rules) and **never write** Firestore. Every mutation is an API route that re-derives the tenant and role from `restaurants/{rid}/members/{uid}`, recomputes money server-side and writes through the Admin SDK. The only client-direct writes are image uploads to Storage, gated by `storage.rules`.
- Authentication is Firebase Auth in the browser (sign-up, verification, login, reset). `/api/auth/session` verifies a fresh ID token and issues an httpOnly session cookie; `/api/auth/token` lets the browser restore its Firebase sign-in from that cookie for listeners.
- Staff invitations: owner creates a token (`{rid}.{staffId}.{secret}`; only `sha256(secret)` stored); acceptance creates/links the Firebase user and writes the member with the *stored* role.

## Order flow
`createOrder` (one Firestore transaction): idempotency key → deterministic order id; load products, variants, add-ons; recompute subtotal, coupon, tax, platform fee (env amount, tenant mode); geofence check (coordinates never stored); usage blocking check; allocate display id; write order, `publicOrders/{token}`, kitchen ticket, usage ledger row (id = order id), coupon redemption (id = order id) and counters.
State machine: `PLACED/PAYMENT_PENDING → CONFIRMED → PREPARING → READY → SERVED → COMPLETED`, `CANCELLED` from any open state. Completion requires `paymentStatus = SUCCESS`. Cancel voids the usage row, restores the coupon, refunds/cancels the payment record, frees the table.
Inventory deducts exactly once at `PREPARING` (default) or `COMPLETED` using deterministic transaction ids `${orderId}_${ingredientId}_ORDER_DEDUCTION`; stock never goes negative (the whole transition rolls back).
Payments: CASH and UPI are confirmed by staff (a UPI QR with the exact amount never marks anything paid); ONLINE goes through the `PaymentProvider` selected by `PAYMENT_PROVIDER`, verified by HMAC webhook and exact-amount match, applied idempotently.
Rewards: loyalty (`${customerId}_${milestone}` ids) and scratch cards (id = order id, reward chosen server-side at reveal) are issued once on completion.

## Realtime
`src/lib/firebase/realtime.ts` exposes listeners for orders, KDS tickets, tables, payments, low-stock ingredients, notifications and the customer `publicOrders/{token}`; `src/lib/client/realtime.ts` wraps each in a hook that waits for sign-in and unsubscribes on unmount or key change. Customers listen to a sanitized `publicOrders/{token}` document, never to `orders`.

## Cloud Functions
Not used (see `src/lib/firebase/functions.ts`). Add them only for scheduled work; the services are framework-free.
