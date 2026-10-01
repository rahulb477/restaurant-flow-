# Architecture
- **Next.js App Router** (React 19, Tailwind 4). Marketing `(marketing)`, auth `(auth)`, `onboarding`, `dashboard/*`, customer `order/*` + `track/*`, JSON API under `src/app/api`.
- `src/config/env.ts` — single validated config (zod). Public vs server vars are separated; optional integrations expose `integrations.*()` flags.
- `src/lib/calculations` — **pure** business rules (money, pricing, coupons, fees, tax, order/payment state machines, geofence, inventory, loyalty, scratch, UPI). Used by services and unit tests.
- `src/lib/server/services` — transactional domain services: `orders` (create with idempotency, payments, inventory deduction, loyalty/scratch on completion, transitions), `crud` (zod-validated tenant-scoped CRUD for menu/inventory/tables/coupons/campaigns), `analytics`, `invoice`, `seed` (demo only).
- `src/lib/server/providers.ts` — `EmailProvider`, `AIProvider`, `PaymentProvider` (cash/UPI/online), `MapProvider`; each reports `isConfigured()`.
- `src/lib/server/auth.ts` — scrypt password hashing, hashed server-side session tokens in an httpOnly cookie, tenant resolved from DB membership (never from client input).
- Realtime: polling hooks (`useApi({poll})`) pause when the tab is hidden and clean up on unmount; KDS 3 s, orders 5 s, customer tracker 4 s, notifications 10 s.
- Money is stored as integer minor units. Order totals are always recomputed server-side.
